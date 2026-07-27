/**
 * Number -> name tables that Pcap4J supplied via its EtherType / IpNumber /
 * LlcNumber / ArpOperation enums.
 *
 * `formatEtherType` reproduces Pcap4J's `0x0800 (IPv4)` rendering so the UI's
 * "Type" and "IP Version" columns look exactly as they did before.
 */

export const ETHER_TYPE = {
  IPV4: 0x0800,
  ARP: 0x0806,
  RARP: 0x8035,
  DOT1Q: 0x8100,
  IPV6: 0x86dd,
  QINQ: 0x88a8,
} as const;

const ETHER_TYPE_NAMES = new Map<number, string>([
  [0x0800, 'IPv4'],
  [0x0805, 'X.25'],
  [0x0806, 'ARP'],
  [0x22f3, 'TRILL'],
  [0x6003, 'DECnet Phase IV'],
  [0x8035, 'RARP'],
  [0x809b, 'AppleTalk'],
  [0x80f3, 'AppleTalk ARP'],
  [0x8100, 'IEEE 802.1Q VLAN-tagged frames'],
  [0x8137, 'IPX'],
  [0x8204, 'QNX Qnet'],
  [0x86dd, 'IPv6'],
  [0x8808, 'Ethernet flow control'],
  [0x8809, 'Slow Protocols'],
  [0x8819, 'CobraNet'],
  [0x8847, 'MPLS unicast'],
  [0x8848, 'MPLS multicast'],
  [0x8863, 'PPPoE Discovery Stage'],
  [0x8864, 'PPPoE Session Stage'],
  [0x887b, 'HomePlug 1.0 MME'],
  [0x888e, 'IEEE 802.1X'],
  [0x8892, 'PROFINET'],
  [0x889a, 'HyperSCSI'],
  [0x88a2, 'ATA over Ethernet'],
  [0x88a4, 'EtherCAT'],
  [0x88a8, 'IEEE 802.1ad Provider Bridging'],
  [0x88ab, 'Ethernet Powerlink'],
  [0x88cc, 'LLDP'],
  [0x88cd, 'SERCOS III'],
  [0x88e1, 'HomePlug AV MME'],
  [0x88e3, 'IEEE 802.1ag MRP'],
  [0x88e5, 'IEEE 802.1AE MACsec'],
  [0x88f7, 'IEEE 1588 PTP'],
  [0x8902, 'IEEE 802.1ag CFM'],
  [0x8906, 'FCoE'],
  [0x8914, 'FCoE Initialization Protocol'],
  [0x8915, 'RoCE'],
  [0x891d, 'TTEthernet'],
  [0x892f, 'HSR'],
  [0x9000, 'Ethernet Configuration Testing Protocol'],
]);

/** IP protocol numbers. Names match Pcap4J's IpNumber constants. */
export const IP_PROTOCOL = {
  ICMPV4: 1,
  IGMP: 2,
  TCP: 6,
  UDP: 17,
  ICMPV6: 58,
} as const;

const IP_PROTOCOL_NAMES = new Map<number, string>([
  [0, 'HOPOPT'],
  [1, 'ICMPv4'],
  [2, 'IGMP'],
  [3, 'GGP'],
  [4, 'IPv4'],
  [6, 'TCP'],
  [8, 'EGP'],
  [9, 'IGP'],
  [17, 'UDP'],
  [27, 'RDP'],
  [41, 'IPv6'],
  [43, 'IPv6-Route'],
  [44, 'IPv6-Frag'],
  [46, 'RSVP'],
  [47, 'GRE'],
  [50, 'ESP'],
  [51, 'AH'],
  [58, 'ICMPv6'],
  [59, 'IPv6-NoNxt'],
  [60, 'IPv6-Opts'],
  [88, 'EIGRP'],
  [89, 'OSPFIGP'],
  [103, 'PIM'],
  [112, 'VRRP'],
  [115, 'L2TP'],
  [132, 'SCTP'],
  [136, 'UDPLite'],
  [137, 'MPLS-in-IP'],
]);

const LLC_SAP_NAMES = new Map<number, string>([
  [0x00, 'Null LSAP'],
  [0x02, 'Individual LLC Sublayer Management Function'],
  [0x03, 'Group LLC Sublayer Management Function'],
  [0x04, 'SNA Path Control (individual)'],
  [0x05, 'SNA Path Control (group)'],
  [0x06, 'TCP/IP'],
  [0x0e, 'PROWAY-LAN'],
  [0x42, 'STP'],
  [0x4e, 'RS 511'],
  [0x5e, 'ISI IP'],
  [0x7e, 'X.25 PLP'],
  [0x8e, 'PROWAY-LAN active station list maintenance'],
  [0xaa, 'SNAP'],
  [0xe0, 'IPX'],
  [0xf0, 'NetBIOS'],
  [0xf4, 'LAN Management (individual)'],
  [0xf5, 'LAN Management (group)'],
  [0xfe, 'ISO Network Layer Protocol'],
  [0xff, 'Global DSAP'],
]);

const ARP_OPERATION_NAMES = new Map<number, string>([
  [1, 'REQUEST'],
  [2, 'REPLY'],
  [3, 'RARP REQUEST'],
  [4, 'RARP REPLY'],
  [8, 'InARP REQUEST'],
  [9, 'InARP REPLY'],
]);

function hex(value: number, digits: number): string {
  return `0x${value.toString(16).padStart(digits, '0')}`;
}

/**
 * Pcap4J rendered named numbers as `<value> (<name>)` — for example
 * `0x0800 (IPv4)`. The spacing is reproduced exactly, because rows written by
 * the Java app and rows written now share the `logs.ipversion` column.
 */
function named(valueAsString: string, name: string | undefined): string {
  return `${valueAsString} (${name ?? 'unknown'})`;
}

export function formatEtherType(value: number): string {
  const name = ETHER_TYPE_NAMES.get(value);
  // Values <= 1500 are an 802.3 length field, not an EtherType.
  if (!name && value <= 0x05dc) return named(hex(value, 4), 'LLC length');
  return named(hex(value, 4), name);
}

export function ipProtocolName(value: number): string {
  return IP_PROTOCOL_NAMES.get(value) ?? 'unknown';
}

export function formatIpProtocol(value: number): string {
  return named(String(value), IP_PROTOCOL_NAMES.get(value));
}

export function formatLlcSap(value: number): string {
  return named(hex(value, 2), LLC_SAP_NAMES.get(value));
}

/**
 * LLC control field. Bits 0-1 = 11 means an unnumbered (1-byte) frame; anything
 * else is an information or supervisory frame with a 2-byte control field.
 */
export function formatLlcControl(value: number, twoBytes: boolean): string {
  if (twoBytes) return named(hex(value, 4), (value & 0x0001) === 0 ? 'Information' : 'Supervisory');
  return named(hex(value, 2), 'Unnumbered');
}

export function formatArpOperation(value: number): string {
  return named(String(value), ARP_OPERATION_NAMES.get(value));
}
