import { readIpv4 } from '../packet/addresses.js';
import { ipProtocolName } from '../packet/names.js';
import { emptyResult, type FlowRecord, type ParseResult } from './types.js';

/**
 * NetFlow v5 (Cisco). The simplest of the three: a fixed 24-byte header followed
 * by up to 30 fixed 48-byte records, no templates to negotiate.
 *
 * Still widely emitted — MikroTik, older Cisco, and most "NetFlow" checkboxes in
 * consumer-grade firmware mean v5 — so it is worth supporting even though IPFIX
 * supersedes it. It is IPv4-only and carries no MAC addresses, which is a real
 * limitation: new-device detection cannot run on v5 data.
 */

export const V5_HEADER_LENGTH = 24;
export const V5_RECORD_LENGTH = 48;
/** The count field is 16-bit but the format allows at most 30 records. */
const V5_MAX_RECORDS = 30;

export function parseNetflowV5(datagram: Buffer, exporter: string, observedAt: Date): ParseResult {
  const result = emptyResult();
  if (datagram.length < V5_HEADER_LENGTH) {
    result.malformed += 1;
    return result;
  }

  const claimed = datagram.readUInt16BE(2);
  const sysUptimeMs = datagram.readUInt32BE(4);
  const unixSeconds = datagram.readUInt32BE(8);
  const unixNanos = datagram.readUInt32BE(12);
  const engineId = datagram.readUInt8(21);

  // Trust the buffer over the header: a truncated datagram must yield the records
  // that are actually present, not read past the end.
  const available = Math.floor((datagram.length - V5_HEADER_LENGTH) / V5_RECORD_LENGTH);
  const count = Math.min(claimed, available, V5_MAX_RECORDS);
  if (count < claimed) result.malformed += 1;

  // v5 timestamps are switch uptime in milliseconds. Absolute time is the
  // export wall clock minus how long the switch had been up, plus the offset.
  const exportMs = unixSeconds * 1000 + Math.floor(unixNanos / 1_000_000);
  const bootMs = exportMs - sysUptimeMs;

  for (let index = 0; index < count; index += 1) {
    const offset = V5_HEADER_LENGTH + index * V5_RECORD_LENGTH;
    const protocol = datagram.readUInt8(offset + 38);

    const record: FlowRecord = {
      exporter,
      observationDomain: engineId,
      protocolVersion: 'netflow5',
      protocol,
      protocolName: ipProtocolName(protocol),
      srcIp: readIpv4(datagram, offset),
      dstIp: readIpv4(datagram, offset + 4),
      srcPort: datagram.readUInt16BE(offset + 32),
      dstPort: datagram.readUInt16BE(offset + 34),
      packets: datagram.readUInt32BE(offset + 16),
      bytes: datagram.readUInt32BE(offset + 20),
      tcpFlags: datagram.readUInt8(offset + 37),
      // v5 has no MAC fields at all.
      srcMac: null,
      dstMac: null,
      ingressInterface: datagram.readUInt16BE(offset + 12),
      egressInterface: datagram.readUInt16BE(offset + 14),
      start: new Date(bootMs + datagram.readUInt32BE(offset + 24)),
      end: new Date(bootMs + datagram.readUInt32BE(offset + 28)),
      observedAt,
    };

    result.records.push(record);
  }

  return result;
}
