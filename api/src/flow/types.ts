/**
 * Flow telemetry, normalised across NetFlow v5, NetFlow v9 and IPFIX.
 *
 * Why this exists at all: packet capture needs a kernel driver (Npcap on Windows,
 * CAP_NET_RAW on Linux) *and* a SPAN/mirror port, because a normal interface only
 * sees its own traffic plus broadcasts. Flow export inverts that — the switch,
 * router or firewall does the observing and sends us summaries over UDP. No
 * driver, no privileges, no mirror port, and the view covers the whole segment
 * rather than one host.
 *
 * The trade-off is that a flow has no payload. Detectors that need bytes on the
 * wire (cleartext credentials) cannot run on flow data; detectors that need
 * *aggregate* behaviour (scans, sweeps, floods) work better here than they ever
 * did from a single vantage point.
 *
 * A `FlowRecord` is deliberately not a `DecodedPacket`. A flow describes a
 * conversation over an interval, so "has the SYN flag" means "a SYN appeared
 * somewhere in this conversation", not "this packet is a SYN". Conflating the two
 * is how you end up flagging every established connection.
 */

/** TCP control bits, as carried in NetFlow field 6 / IPFIX tcpControlBits. */
export const TCP_FLAG = {
  FIN: 0x01,
  SYN: 0x02,
  RST: 0x04,
  PSH: 0x08,
  ACK: 0x10,
  URG: 0x20,
  ECE: 0x40,
  CWR: 0x80,
} as const;

/** Which protocol the exporter spoke. Recorded so status can show it. */
export const FLOW_PROTOCOLS = ['netflow5', 'netflow9', 'ipfix'] as const;
export type FlowProtocol = (typeof FLOW_PROTOCOLS)[number];

/**
 * One unidirectional conversation as reported by an exporter.
 *
 * Fields an exporter does not send are null rather than zero: "no MAC in the
 * template" and "MAC 00:00:00:00:00:00" are different facts, and a detector must
 * be able to tell them apart before drawing a conclusion.
 */
export interface FlowRecord {
  /** Address the datagram came from — the switch/router/firewall, not the host. */
  exporter: string;
  /** NetFlow source_id or IPFIX observation domain, distinguishing line cards. */
  observationDomain: number;
  protocolVersion: FlowProtocol;

  /** IP protocol number, e.g. 6 for TCP. */
  protocol: number;
  protocolName: string;
  srcIp: string | null;
  dstIp: string | null;
  srcPort: number;
  dstPort: number;

  packets: number;
  bytes: number;
  /**
   * Union of the TCP control bits seen across the flow, or null when the exporter
   * did not include the field. Null is common: tcpControlBits is optional in
   * IPFIX, and several vendors omit it.
   */
  tcpFlags: number | null;

  srcMac: string | null;
  dstMac: string | null;
  ingressInterface: number | null;
  egressInterface: number | null;

  /** Flow start and end, converted to absolute time. */
  start: Date;
  end: Date;
  /** When we received the datagram. Detection windows key off this. */
  observedAt: Date;
}

/** What a parser returns, including anything it had to skip. */
export interface ParseResult {
  records: FlowRecord[];
  /**
   * Records that referenced a template we have not been sent yet. Normal at
   * startup — exporters resend templates on an interval, typically every few
   * minutes — so this is reported rather than logged as an error.
   */
  pendingTemplates: number;
  /** Data that was malformed or used an unsupported encoding. */
  malformed: number;
}

export function emptyResult(): ParseResult {
  return { records: [], pendingTemplates: 0, malformed: 0 };
}

/** Raised for a datagram that cannot be parsed at all. Never escapes the socket. */
export class FlowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowParseError';
  }
}

/**
 * True when a TCP flow attempted a connection that never established.
 *
 * This is the discriminator the whole flow-based scan detector rests on, so it is
 * worth being precise. Flags accumulate over a flow: a successful client-side
 * conversation ends up with SYN, ACK, usually PSH and FIN. A scan does not —
 * the target either refuses (SYN out, RST back, so the outbound flow holds only
 * SYN) or drops silently (SYN retries, still no ACK).
 *
 * Requiring "SYN present and ACK absent" therefore means "this connection was
 * never answered", which is genuinely unusual. Contrast the packet-level rule
 * this replaces, which flagged any SYN-without-ACK *packet* — that is simply
 * every new connection, and it is why the original engine reported everything.
 *
 * When the exporter omits tcpControlBits we fall back to volume: a connection
 * that established and did anything useful carries more than a couple of packets.
 */
export function isUnansweredTcp(flow: FlowRecord): boolean {
  if (flow.protocol !== 6) return false;

  if (flow.tcpFlags !== null && flow.tcpFlags !== 0) {
    const hasSyn = (flow.tcpFlags & TCP_FLAG.SYN) !== 0;
    const hasAck = (flow.tcpFlags & TCP_FLAG.ACK) !== 0;
    return hasSyn && !hasAck;
  }

  // No flag data. A probe is a packet or two with no payload to speak of;
  // anything that carried real traffic is not a probe.
  return flow.packets > 0 && flow.packets <= 2 && flow.bytes <= 200;
}

/** Renders TCP flags as `SYN,ACK` for alert evidence. */
export function describeTcpFlags(flags: number | null): string | null {
  if (flags === null) return null;
  const names = Object.entries(TCP_FLAG)
    .filter(([, bit]) => (flags & bit) !== 0)
    .map(([name]) => name);
  return names.length > 0 ? names.join(',') : 'none';
}
