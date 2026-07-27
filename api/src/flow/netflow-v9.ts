import { readIpv4, readIpv6, readMac } from '../packet/addresses.js';
import { ipProtocolName } from '../packet/names.js';
import { IE, type Template, type TemplateField, templateFixedLength, VARIABLE_LENGTH } from './fields.js';
import type { TemplateCache } from './templates.js';
import { emptyResult, type FlowProtocol, type FlowRecord, type ParseResult } from './types.js';

/**
 * NetFlow v9 (RFC 3954) and IPFIX (RFC 7011).
 *
 * They are the same design — a header, then a sequence of sets, each either a
 * template definition or data records laid out per a template — so one walker
 * handles both. The differences are contained in `DIALECT` below: header size,
 * which set IDs mean "template", whether fields can be enterprise-scoped, and how
 * timestamps are expressed.
 *
 * Everything here treats the datagram as hostile. It arrives over unauthenticated
 * UDP from whatever can reach the socket, so every read is bounds-checked, every
 * declared length is validated against what is actually present, and a malformed
 * set ends parsing of that datagram rather than throwing.
 */

const V9_HEADER_LENGTH = 20;
const IPFIX_HEADER_LENGTH = 16;
const SET_HEADER_LENGTH = 4;
/** Set IDs below this are reserved for templates and options in both formats. */
const MIN_DATA_SET_ID = 256;
/** NTP epoch (1900-01-01) to Unix epoch (1970-01-01), in seconds. */
const NTP_EPOCH_OFFSET_SECONDS = 2_208_988_800;

interface Dialect {
  protocolVersion: FlowProtocol;
  headerLength: number;
  templateSetId: number;
  optionsTemplateSetId: number;
  /** IPFIX fields may carry an enterprise number; v9 fields never do. */
  enterpriseCapable: boolean;
}

const DIALECT: Record<'v9' | 'ipfix', Dialect> = {
  v9: {
    protocolVersion: 'netflow9',
    headerLength: V9_HEADER_LENGTH,
    templateSetId: 0,
    optionsTemplateSetId: 1,
    enterpriseCapable: false,
  },
  ipfix: {
    protocolVersion: 'ipfix',
    headerLength: IPFIX_HEADER_LENGTH,
    templateSetId: 2,
    optionsTemplateSetId: 3,
    enterpriseCapable: true,
  },
};

export function parseNetflowV9(
  datagram: Buffer,
  exporter: string,
  observedAt: Date,
  templates: TemplateCache,
): ParseResult {
  return parseTemplated(datagram, exporter, observedAt, templates, DIALECT.v9);
}

export function parseIpfix(
  datagram: Buffer,
  exporter: string,
  observedAt: Date,
  templates: TemplateCache,
): ParseResult {
  return parseTemplated(datagram, exporter, observedAt, templates, DIALECT.ipfix);
}

function parseTemplated(
  datagram: Buffer,
  exporter: string,
  observedAt: Date,
  templates: TemplateCache,
  dialect: Dialect,
): ParseResult {
  const result = emptyResult();
  if (datagram.length < dialect.headerLength) {
    result.malformed += 1;
    return result;
  }

  // v9: sysUptime(4) unixSecs(4) sequence(4) sourceId(4).
  // IPFIX: length(2) exportTime(4) sequence(4) observationDomain(4).
  let observationDomain: number;
  let bootMs = 0;
  let messageEnd = datagram.length;

  if (dialect.protocolVersion === 'netflow9') {
    const sysUptimeMs = datagram.readUInt32BE(4);
    const unixSeconds = datagram.readUInt32BE(8);
    observationDomain = datagram.readUInt32BE(16);
    // v9 flow times are switch uptime, so an absolute reference is needed.
    bootMs = unixSeconds * 1000 - sysUptimeMs;
  } else {
    const declaredLength = datagram.readUInt16BE(2);
    observationDomain = datagram.readUInt32BE(12);
    // Honour the declared length when it fits: a single UDP datagram may not have
    // trailing data, but a stream-framed message could.
    if (declaredLength >= dialect.headerLength && declaredLength <= datagram.length) {
      messageEnd = declaredLength;
    } else {
      result.malformed += 1;
    }
  }

  let offset = dialect.headerLength;

  while (offset + SET_HEADER_LENGTH <= messageEnd) {
    const setId = datagram.readUInt16BE(offset);
    const setLength = datagram.readUInt16BE(offset + 2);

    // A set shorter than its own header, or one claiming to run past the end of
    // the datagram, means the stream is desynchronised. Stepping forward by a
    // guess would decode garbage, so stop.
    if (setLength < SET_HEADER_LENGTH || offset + setLength > messageEnd) {
      result.malformed += 1;
      break;
    }

    const body = datagram.subarray(offset + SET_HEADER_LENGTH, offset + setLength);

    if (setId === dialect.templateSetId) {
      readTemplateSet(body, exporter, observationDomain, templates, dialect, result);
    } else if (setId === dialect.optionsTemplateSetId) {
      // Options templates describe exporter metadata (sampling rates, counters),
      // not flows. Nothing here consumes them, so they are skipped by length —
      // which is safe, unlike guessing at their contents.
    } else if (setId >= MIN_DATA_SET_ID) {
      const template = templates.get({ exporter, observationDomain, templateId: setId });
      if (template) {
        readDataSet(body, template, {
          exporter,
          observationDomain,
          protocolVersion: dialect.protocolVersion,
          bootMs,
          observedAt,
          result,
        });
      } else {
        // The template has not arrived yet. Exporters resend on an interval, so
        // this resolves itself; counting it lets status show that it is happening.
        result.pendingTemplates += 1;
      }
    } else {
      result.malformed += 1;
    }

    offset += setLength;
  }

  return result;
}

/** Reads one or more template definitions from a template set. */
function readTemplateSet(
  body: Buffer,
  exporter: string,
  observationDomain: number,
  templates: TemplateCache,
  dialect: Dialect,
  result: ParseResult,
): void {
  let offset = 0;

  while (offset + 4 <= body.length) {
    const templateId = body.readUInt16BE(offset);
    const fieldCount = body.readUInt16BE(offset + 2);
    offset += 4;

    // Withdrawal: IPFIX signals "this template is gone" with a zero field count.
    if (fieldCount === 0) continue;

    const fields: TemplateField[] = [];
    let truncated = false;

    for (let index = 0; index < fieldCount; index += 1) {
      if (offset + 4 > body.length) {
        truncated = true;
        break;
      }
      const rawElement = body.readUInt16BE(offset);
      const length = body.readUInt16BE(offset + 2);
      offset += 4;

      let enterprise: number | null = null;
      let informationElement = rawElement;

      // IPFIX marks enterprise-scoped elements with the top bit, and follows the
      // field with a 4-byte enterprise number.
      if (dialect.enterpriseCapable && (rawElement & 0x8000) !== 0) {
        informationElement = rawElement & 0x7fff;
        if (offset + 4 > body.length) {
          truncated = true;
          break;
        }
        enterprise = body.readUInt32BE(offset);
        offset += 4;
      }

      fields.push({ informationElement, length, enterprise });
    }

    if (truncated) {
      result.malformed += 1;
      return;
    }

    templates.set(
      { exporter, observationDomain, templateId },
      { id: templateId, fields, fixedLength: templateFixedLength(fields) },
    );
  }
}

interface DataSetContext {
  exporter: string;
  observationDomain: number;
  protocolVersion: FlowProtocol;
  bootMs: number;
  observedAt: Date;
  result: ParseResult;
}

/** Decodes every record in a data set using its template. */
function readDataSet(body: Buffer, template: Template, context: DataSetContext): void {
  let offset = 0;

  // A fixed-length template lets us stop cleanly: whatever is left over that is
  // smaller than one record is the set's 4-byte-alignment padding, not a record.
  while (offset < body.length) {
    if (template.fixedLength !== null) {
      if (body.length - offset < template.fixedLength) break;
    } else if (body.length - offset < template.fields.length) {
      // Variable-length records still need at least one byte per field.
      break;
    }

    const decoded = decodeRecord(body, offset, template, context);
    if (!decoded) {
      context.result.malformed += 1;
      break;
    }

    context.result.records.push(decoded.record);
    // Guard against a zero-length step, which would spin forever.
    if (decoded.consumed <= 0) {
      context.result.malformed += 1;
      break;
    }
    offset += decoded.consumed;
  }
}

interface RawTimes {
  startMs: number | null;
  endMs: number | null;
  startUptimeMs: number | null;
  endUptimeMs: number | null;
}

function decodeRecord(
  body: Buffer,
  start: number,
  template: Template,
  context: DataSetContext,
): { record: FlowRecord; consumed: number } | null {
  let offset = start;

  let protocol = 0;
  let srcIp: string | null = null;
  let dstIp: string | null = null;
  let srcPort = 0;
  let dstPort = 0;
  let packets = 0;
  let bytes = 0;
  let tcpFlags: number | null = null;
  let srcMac: string | null = null;
  let dstMac: string | null = null;
  let ingressInterface: number | null = null;
  let egressInterface: number | null = null;
  const times: RawTimes = { startMs: null, endMs: null, startUptimeMs: null, endUptimeMs: null };

  for (const field of template.fields) {
    let length = field.length;

    if (length === VARIABLE_LENGTH) {
      // RFC 7011 §7: a 1-byte length, or 255 followed by a 2-byte length.
      if (offset >= body.length) return null;
      length = body.readUInt8(offset);
      offset += 1;
      if (length === 255) {
        if (offset + 2 > body.length) return null;
        length = body.readUInt16BE(offset);
        offset += 2;
      }
    }

    if (length < 0 || offset + length > body.length) return null;

    // Enterprise-scoped elements share numbers with the IANA registry but mean
    // something entirely different, so they are stepped over, never interpreted.
    if (field.enterprise !== null) {
      offset += length;
      continue;
    }

    switch (field.informationElement) {
      case IE.PROTOCOL_IDENTIFIER:
        protocol = readUnsigned(body, offset, length);
        break;
      case IE.SOURCE_IPV4_ADDRESS:
        if (length >= 4) srcIp = readIpv4(body, offset);
        break;
      case IE.DESTINATION_IPV4_ADDRESS:
        if (length >= 4) dstIp = readIpv4(body, offset);
        break;
      case IE.SOURCE_IPV6_ADDRESS:
        if (length >= 16) srcIp = readIpv6(body, offset);
        break;
      case IE.DESTINATION_IPV6_ADDRESS:
        if (length >= 16) dstIp = readIpv6(body, offset);
        break;
      case IE.SOURCE_TRANSPORT_PORT:
        srcPort = readUnsigned(body, offset, length);
        break;
      case IE.DESTINATION_TRANSPORT_PORT:
        dstPort = readUnsigned(body, offset, length);
        break;
      case IE.PACKET_DELTA_COUNT:
      case IE.PACKET_TOTAL_COUNT:
        packets = readUnsigned(body, offset, length);
        break;
      case IE.OCTET_DELTA_COUNT:
      case IE.OCTET_TOTAL_COUNT:
        bytes = readUnsigned(body, offset, length);
        break;
      case IE.TCP_CONTROL_BITS:
        tcpFlags = readUnsigned(body, offset, length);
        break;
      case IE.SOURCE_MAC_ADDRESS:
        if (length >= 6) srcMac = readMac(body, offset);
        break;
      case IE.DESTINATION_MAC_ADDRESS:
        if (length >= 6) dstMac = readMac(body, offset);
        break;
      case IE.INGRESS_INTERFACE:
        ingressInterface = readUnsigned(body, offset, length);
        break;
      case IE.EGRESS_INTERFACE:
        egressInterface = readUnsigned(body, offset, length);
        break;
      case IE.FLOW_START_SYS_UP_TIME:
        times.startUptimeMs = readUnsigned(body, offset, length);
        break;
      case IE.FLOW_END_SYS_UP_TIME:
        times.endUptimeMs = readUnsigned(body, offset, length);
        break;
      case IE.FLOW_START_SECONDS:
        times.startMs = readUnsigned(body, offset, length) * 1000;
        break;
      case IE.FLOW_END_SECONDS:
        times.endMs = readUnsigned(body, offset, length) * 1000;
        break;
      case IE.FLOW_START_MILLISECONDS:
        times.startMs = readUnsigned(body, offset, length);
        break;
      case IE.FLOW_END_MILLISECONDS:
        times.endMs = readUnsigned(body, offset, length);
        break;
      case IE.FLOW_START_MICROSECONDS:
        times.startMs = ntpToUnixMs(body, offset, length);
        break;
      case IE.FLOW_END_MICROSECONDS:
        times.endMs = ntpToUnixMs(body, offset, length);
        break;
      default:
        // A field we have no use for. Skipping by length is why this decoder
        // works against vendor templates it has never seen.
        break;
    }

    offset += length;
  }

  const { start: flowStart, end: flowEnd } = resolveTimes(times, context);

  return {
    record: {
      exporter: context.exporter,
      observationDomain: context.observationDomain,
      protocolVersion: context.protocolVersion,
      protocol,
      protocolName: ipProtocolName(protocol),
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      packets,
      bytes,
      tcpFlags,
      srcMac,
      dstMac,
      ingressInterface,
      egressInterface,
      start: flowStart,
      end: flowEnd,
      observedAt: context.observedAt,
    },
    consumed: offset - start,
  };
}

/**
 * Picks the best available notion of when the flow happened.
 *
 * Absolute fields win. Uptime-relative fields (all v9 has) need the exporter's
 * boot time, which is only meaningful if its clock was sane. Failing both, the
 * arrival time is used — less precise, but a flow with a plausible timestamp is
 * far more useful than one dated 1970, which would silently fall outside every
 * detection window and every dashboard period.
 */
function resolveTimes(times: RawTimes, context: DataSetContext): { start: Date; end: Date } {
  const observed = context.observedAt.getTime();

  const startMs =
    times.startMs ??
    (times.startUptimeMs !== null && context.bootMs > 0 ? context.bootMs + times.startUptimeMs : null);
  const endMs =
    times.endMs ??
    (times.endUptimeMs !== null && context.bootMs > 0 ? context.bootMs + times.endUptimeMs : null);

  const start = isPlausible(startMs) ? (startMs as number) : null;
  const end = isPlausible(endMs) ? (endMs as number) : null;

  // Half-known times are common: plenty of templates carry an end but no start.
  // Substituting arrival time for the missing half and then clamping would throw
  // away the half we actually have — an end of 11:59:58 clamped up to a 12:00:05
  // arrival is worse than no clamp at all. So a lone timestamp defines both ends,
  // and the clamp only applies when both are real.
  if (start !== null && end !== null) {
    return { start: new Date(start), end: new Date(Math.max(start, end)) };
  }
  if (end !== null) return { start: new Date(end), end: new Date(end) };
  if (start !== null) return { start: new Date(start), end: new Date(start) };
  return { start: new Date(observed), end: new Date(observed) };
}

/** Rejects epoch-zero and other nonsense from a misconfigured exporter clock. */
function isPlausible(ms: number | null): boolean {
  // 2000-01-01 as the floor: any flow timestamp before that is a broken clock.
  return ms !== null && Number.isFinite(ms) && ms > 946_684_800_000;
}

/**
 * Reads an unsigned integer of any width the formats allow.
 *
 * Widths are not fixed by the IE: IPFIX reduced-size encoding lets an exporter
 * send a 4-byte counter in 1, 2 or 3 bytes when the value fits, so the length
 * comes from the template rather than from what the field "should" be.
 */
export function readUnsigned(buffer: Buffer, offset: number, length: number): number {
  if (length <= 0) return 0;
  if (length <= 6) return buffer.readUIntBE(offset, length);
  if (length === 8) {
    // Number loses precision above 2^53, which for a byte counter is ~9 PB in a
    // single flow. Not a case worth carrying BigInt through the detectors for.
    return Number(buffer.readBigUInt64BE(offset));
  }
  // An odd width (7, or padded wider): take the low 6 bytes, which is where any
  // realistic value lives.
  return buffer.readUIntBE(offset + length - 6, 6);
}

/**
 * dateTimeMicroseconds and dateTimeNanoseconds are NTP 64-bit timestamps
 * (RFC 7011 §6.1.9), not plain integers — seconds since 1900 in the high word, a
 * binary fraction in the low word. Reading one as an integer yields a date around
 * the year 5 million, which is why this needs its own path.
 */
function ntpToUnixMs(buffer: Buffer, offset: number, length: number): number | null {
  if (length < 8) return null;
  const seconds = buffer.readUInt32BE(offset);
  const fraction = buffer.readUInt32BE(offset + 4);
  if (seconds === 0) return null;
  return (seconds - NTP_EPOCH_OFFSET_SECONDS) * 1000 + Math.floor((fraction / 2 ** 32) * 1000);
}
