import { IE, VARIABLE_LENGTH } from './fields.js';
import { TCP_FLAG } from './types.js';

/**
 * Builders for real NetFlow and IPFIX datagrams.
 *
 * The parsers are fed bytes laid out exactly as the RFCs specify, not fixtures
 * shaped like whatever the parser happens to read. A parser test that constructs
 * its input with the same assumptions as the code under test proves only that the
 * two agree, which is precisely the bug class — a misread offset — that matters
 * most here.
 */

export const EXPORT_TIME = Date.parse('2026-07-26T12:00:00Z');
/** Switch uptime at export, so uptime-relative flow times resolve to known dates. */
export const SYS_UPTIME_MS = 3_600_000;

export interface V5Flow {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol?: number;
  packets?: number;
  bytes?: number;
  tcpFlags?: number;
  /** Milliseconds of switch uptime at flow start/end. */
  firstUptimeMs?: number;
  lastUptimeMs?: number;
}

export function buildNetflowV5(flows: V5Flow[], options: { count?: number } = {}): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt16BE(5, 0);
  header.writeUInt16BE(options.count ?? flows.length, 2);
  header.writeUInt32BE(SYS_UPTIME_MS, 4);
  header.writeUInt32BE(Math.floor(EXPORT_TIME / 1000), 8);
  header.writeUInt32BE(0, 12);
  header.writeUInt32BE(1, 16);
  header.writeUInt8(0, 20);
  header.writeUInt8(7, 21); // engine_id, becomes observationDomain
  header.writeUInt16BE(0, 22);

  const records = flows.map((flow) => {
    const record = Buffer.alloc(48);
    writeIpv4(record, 0, flow.srcIp);
    writeIpv4(record, 4, flow.dstIp);
    writeIpv4(record, 8, '0.0.0.0');
    record.writeUInt16BE(3, 12); // input ifIndex
    record.writeUInt16BE(4, 14); // output ifIndex
    record.writeUInt32BE(flow.packets ?? 1, 16);
    record.writeUInt32BE(flow.bytes ?? 60, 20);
    record.writeUInt32BE(flow.firstUptimeMs ?? SYS_UPTIME_MS - 1000, 24);
    record.writeUInt32BE(flow.lastUptimeMs ?? SYS_UPTIME_MS - 500, 28);
    record.writeUInt16BE(flow.srcPort, 32);
    record.writeUInt16BE(flow.dstPort, 34);
    record.writeUInt8(0, 36);
    record.writeUInt8(flow.tcpFlags ?? TCP_FLAG.SYN, 37);
    record.writeUInt8(flow.protocol ?? 6, 38);
    record.writeUInt8(0, 39);
    return record;
  });

  return Buffer.concat([header, ...records]);
}

export interface FieldSpec {
  informationElement: number;
  length: number;
  enterprise?: number;
}

/** The field layout used by most of the IPFIX and v9 tests. */
export const STANDARD_FIELDS: FieldSpec[] = [
  { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
  { informationElement: IE.DESTINATION_IPV4_ADDRESS, length: 4 },
  { informationElement: IE.SOURCE_TRANSPORT_PORT, length: 2 },
  { informationElement: IE.DESTINATION_TRANSPORT_PORT, length: 2 },
  { informationElement: IE.PROTOCOL_IDENTIFIER, length: 1 },
  { informationElement: IE.TCP_CONTROL_BITS, length: 1 },
  { informationElement: IE.PACKET_DELTA_COUNT, length: 4 },
  { informationElement: IE.OCTET_DELTA_COUNT, length: 4 },
];

/** Values keyed by information element, written in template order. */
export type FieldValues = Map<number, Buffer>;

export function standardValues(flow: {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol?: number;
  tcpFlags?: number;
  packets?: number;
  bytes?: number;
}): FieldValues {
  const values: FieldValues = new Map();
  values.set(IE.SOURCE_IPV4_ADDRESS, ipv4(flow.srcIp));
  values.set(IE.DESTINATION_IPV4_ADDRESS, ipv4(flow.dstIp));
  values.set(IE.SOURCE_TRANSPORT_PORT, uint(flow.srcPort, 2));
  values.set(IE.DESTINATION_TRANSPORT_PORT, uint(flow.dstPort, 2));
  values.set(IE.PROTOCOL_IDENTIFIER, uint(flow.protocol ?? 6, 1));
  values.set(IE.TCP_CONTROL_BITS, uint(flow.tcpFlags ?? TCP_FLAG.SYN, 1));
  values.set(IE.PACKET_DELTA_COUNT, uint(flow.packets ?? 1, 4));
  values.set(IE.OCTET_DELTA_COUNT, uint(flow.bytes ?? 60, 4));
  return values;
}

/** A template set: set id 2 for IPFIX, 0 for NetFlow v9. */
export function buildTemplateSet(templateId: number, fields: FieldSpec[], dialect: 'ipfix' | 'v9'): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    if (field.enterprise !== undefined && dialect === 'ipfix') {
      // The top bit of the element id marks an enterprise-scoped field, whose
      // enterprise number follows the length.
      parts.push(
        uint(field.informationElement | 0x8000, 2),
        uint(field.length, 2),
        uint(field.enterprise, 4),
      );
    } else {
      parts.push(uint(field.informationElement, 2), uint(field.length, 2));
    }
  }

  const body = Buffer.concat([uint(templateId, 2), uint(fields.length, 2), ...parts]);
  const setId = dialect === 'ipfix' ? 2 : 0;
  return Buffer.concat([uint(setId, 2), uint(body.length + 4, 2), body]);
}

/** A data set, padded to a 4-byte boundary as exporters do. */
export function buildDataSet(templateId: number, records: Buffer[]): Buffer {
  const body = Buffer.concat(records);
  const unpadded = body.length + 4;
  const padding = (4 - (unpadded % 4)) % 4;
  return Buffer.concat([uint(templateId, 2), uint(unpadded + padding, 2), body, Buffer.alloc(padding)]);
}

/** Serialises one record in the order the template declares. */
export function buildRecord(fields: FieldSpec[], values: FieldValues): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const value = values.get(field.informationElement);
    if (field.length === VARIABLE_LENGTH) {
      const payload = value ?? Buffer.alloc(0);
      parts.push(uint(payload.length, 1), payload);
      continue;
    }
    if (!value) {
      parts.push(Buffer.alloc(field.length));
      continue;
    }
    // Reduced-size encoding: the template's length wins over the value's.
    if (value.length === field.length) parts.push(value);
    else if (value.length > field.length) parts.push(value.subarray(value.length - field.length));
    else parts.push(Buffer.concat([Buffer.alloc(field.length - value.length), value]));
  }
  return Buffer.concat(parts);
}

export function buildIpfixMessage(sets: Buffer[], options: { observationDomain?: number } = {}): Buffer {
  const body = Buffer.concat(sets);
  const header = Buffer.alloc(16);
  header.writeUInt16BE(10, 0);
  header.writeUInt16BE(body.length + 16, 2);
  header.writeUInt32BE(Math.floor(EXPORT_TIME / 1000), 4);
  header.writeUInt32BE(1, 8);
  header.writeUInt32BE(options.observationDomain ?? 42, 12);
  return Buffer.concat([header, body]);
}

export function buildNetflowV9Message(sets: Buffer[], options: { sourceId?: number } = {}): Buffer {
  const body = Buffer.concat(sets);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(9, 0);
  header.writeUInt16BE(1, 2); // record count; the parser walks sets instead
  header.writeUInt32BE(SYS_UPTIME_MS, 4);
  header.writeUInt32BE(Math.floor(EXPORT_TIME / 1000), 8);
  header.writeUInt32BE(1, 12);
  header.writeUInt32BE(options.sourceId ?? 9, 16);
  return Buffer.concat([header, body]);
}

/** An sFlow v5 datagram header, for the "not NetFlow v5" discrimination test. */
export function buildSflowHeader(): Buffer {
  const buffer = Buffer.alloc(28);
  buffer.writeUInt32BE(5, 0); // version
  buffer.writeUInt32BE(1, 4); // agent address type: IPv4
  writeIpv4(buffer, 8, '10.0.0.1');
  buffer.writeUInt32BE(0, 12);
  return buffer;
}

export function uint(value: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  if (length === 1) buffer.writeUInt8(value, 0);
  else if (length === 2) buffer.writeUInt16BE(value, 0);
  else if (length === 4) buffer.writeUInt32BE(value, 0);
  else if (length === 8) buffer.writeBigUInt64BE(BigInt(value), 0);
  else buffer.writeUIntBE(value, 0, length);
  return buffer;
}

export function ipv4(address: string): Buffer {
  const buffer = Buffer.alloc(4);
  writeIpv4(buffer, 0, address);
  return buffer;
}

export function mac(address: string): Buffer {
  return Buffer.from(address.split(':').map((part) => Number.parseInt(part, 16)));
}

/** An NTP 64-bit timestamp, as dateTimeMicroseconds uses (RFC 7011 §6.1.9). */
export function ntpTimestamp(unixMs: number): Buffer {
  const buffer = Buffer.alloc(8);
  const seconds = Math.floor(unixMs / 1000) + 2_208_988_800;
  buffer.writeUInt32BE(seconds, 0);
  buffer.writeUInt32BE(Math.floor(((unixMs % 1000) / 1000) * 2 ** 32), 4);
  return buffer;
}

function writeIpv4(buffer: Buffer, offset: number, address: string): void {
  const octets = address.split('.').map(Number);
  for (let index = 0; index < 4; index += 1) {
    buffer.writeUInt8(octets[index] ?? 0, offset + index);
  }
}
