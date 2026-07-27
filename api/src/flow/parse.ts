import { parseNetflowV5 } from './netflow-v5.js';
import { parseIpfix, parseNetflowV9 } from './netflow-v9.js';
import type { TemplateCache } from './templates.js';
import { emptyResult, type ParseResult } from './types.js';

/**
 * Dispatches a datagram to the right parser on its version word.
 *
 * All three formats begin with a 16-bit version, so one socket can serve a mixed
 * estate — which is the normal case, since the version is dictated by whatever
 * firmware each switch happens to run and is rarely uniform.
 */

export const FLOW_VERSION = {
  NETFLOW_V5: 5,
  NETFLOW_V9: 9,
  IPFIX: 10,
} as const;

/** Versions we do not implement, named so the log can say why it was ignored. */
const KNOWN_UNSUPPORTED: Record<number, string> = {
  1: 'NetFlow v1',
  7: 'NetFlow v7',
  8: 'NetFlow v8 (aggregated)',
};

export interface DispatchResult extends ParseResult {
  version: number;
  /** Set when the version is recognised but not implemented. */
  unsupported: string | null;
}

export function parseFlowDatagram(
  datagram: Buffer,
  exporter: string,
  observedAt: Date,
  templates: TemplateCache,
): DispatchResult {
  if (datagram.length < 4) {
    return { ...emptyResult(), malformed: 1, version: 0, unsupported: null };
  }

  const version = datagram.readUInt16BE(0);

  switch (version) {
    case FLOW_VERSION.NETFLOW_V5:
      return { ...parseNetflowV5(datagram, exporter, observedAt), version, unsupported: null };
    case FLOW_VERSION.NETFLOW_V9:
      return { ...parseNetflowV9(datagram, exporter, observedAt, templates), version, unsupported: null };
    case FLOW_VERSION.IPFIX:
      return { ...parseIpfix(datagram, exporter, observedAt, templates), version, unsupported: null };
    default: {
      const named = KNOWN_UNSUPPORTED[version];
      return {
        ...emptyResult(),
        // Only count it as malformed if it is not a version we knowingly skip;
        // a v8 exporter is misconfigured, not sending corrupt data.
        malformed: named ? 0 : 1,
        version,
        unsupported: named ?? null,
      };
    }
  }
}

/**
 * sFlow shares the "UDP telemetry" role but is a different protocol: XDR-encoded
 * samples rather than templated records, and its datagrams begin with version 5 —
 * the same value as NetFlow v5, distinguishable only by what follows.
 *
 * Detected purely so the log can say "this is sFlow, which is not supported"
 * rather than reporting a stream of malformed NetFlow. Worth adding later: sFlow
 * flow samples carry a truncated raw packet header, which the existing packet
 * decoders could parse directly.
 */
export function looksLikeSflow(datagram: Buffer): boolean {
  // sFlow v5: version(4) = 5, then agent address type(4) which is 1 (IPv4) or 2.
  // NetFlow v5's first four bytes are version(2)=0x0005 then a record count, so a
  // NetFlow v5 datagram has a non-zero count where sFlow has 0x0000.
  if (datagram.length < 12) return false;
  return datagram.readUInt32BE(0) === 5 && [1, 2].includes(datagram.readUInt32BE(4));
}
