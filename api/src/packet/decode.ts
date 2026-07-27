import { readIpv4, readIpv6, readMac, toHexStream } from './addresses.js';
import {
  ETHER_TYPE,
  formatArpOperation,
  formatEtherType,
  formatIpProtocol,
  formatLlcControl,
  formatLlcSap,
  IP_PROTOCOL,
  ipProtocolName,
} from './names.js';

/**
 * Hand-rolled replacement for Pcap4J's packet factory. Given a raw Ethernet
 * frame it produces the layers the old services queried via
 * `packet.get(XxxPacket.class)`.
 *
 * Every read is bounds-checked: truncated frames are routine when a snapshot
 * length smaller than the MTU is in use.
 */

export const ETHERNET_HEADER_LENGTH = 14;

export interface EthernetHeader {
  destinationAddress: string;
  sourceAddress: string;
  /** Pcap4J-style rendering, e.g. `0x0800 (IPv4)`. */
  type: string;
  typeValue: number;
}

export interface LlcHeader {
  dsap: string;
  ssap: string;
  control: string;
}

export interface VlanHeader {
  priority: number;
  cfi: number;
  vid: number;
  type: string;
}

export interface Ipv4Header {
  version: number;
  headerLength: number;
  tos: number;
  totalLength: number;
  identification: number;
  flags: { reserved: boolean; dontFragment: boolean; moreFragment: boolean };
  fragmentOffset: number;
  ttl: number;
  protocol: number;
  protocolName: string;
  headerChecksum: number;
  srcAddr: string;
  dstAddr: string;
}

export interface Ipv6Header {
  version: number;
  trafficClass: number;
  flowLabel: number;
  payloadLength: number;
  nextHeader: number;
  nextHeaderName: string;
  hopLimit: number;
  srcAddr: string;
  dstAddr: string;
}

export interface ArpHeader {
  hardwareType: number;
  protocolType: number;
  hardwareAddrLength: number;
  protocolAddrLength: number;
  operation: number;
  operationName: string;
  srcHardwareAddr: string;
  srcProtocolAddr: string;
  dstHardwareAddr: string;
  dstProtocolAddr: string;
}

export interface TcpHeader {
  srcPort: number;
  dstPort: number;
  sequenceNumber: number;
  acknowledgmentNumber: number;
  dataOffset: number;
  urg: boolean;
  ack: boolean;
  psh: boolean;
  rst: boolean;
  syn: boolean;
  fin: boolean;
  window: number;
  checksum: number;
  urgentPointer: number;
}

export interface UdpHeader {
  srcPort: number;
  dstPort: number;
  length: number;
  checksum: number;
}

/**
 * Link layers this decoder understands.
 *  - ETHERNET (DLT_EN10MB): ordinary network interfaces.
 *  - NULL (DLT_NULL) / LOOP: loopback, with a 4-byte address-family header and no
 *    MAC addresses. This is what Npcap's loopback adapter reports.
 *  - RAW: the IP packet with no link header at all, used by some tunnels.
 */
export const SUPPORTED_LINK_TYPES = ['ETHERNET', 'NULL', 'LOOP', 'RAW'] as const;
export type LinkType = (typeof SUPPORTED_LINK_TYPES)[number];

export function isSupportedLinkType(linkType: string | null): linkType is LinkType {
  return linkType !== null && (SUPPORTED_LINK_TYPES as readonly string[]).includes(linkType);
}

export interface DecodedPacket {
  timestamp: Date;
  /** Bytes actually captured for this frame. */
  frameLength: number;
  raw: Buffer;
  /** Link layer this frame arrived on; NULL and RAW frames have no Ethernet header. */
  linkType: LinkType;
  ethernet: EthernetHeader | null;
  llc: LlcHeader | null;
  vlan: VlanHeader | null;
  ipv4: Ipv4Header | null;
  ipv6: Ipv6Header | null;
  arp: ArpHeader | null;
  tcp: TcpHeader | null;
  udp: UdpHeader | null;
  /** Transport-layer payload, when a TCP/UDP header was parsed. */
  payload: Buffer | null;
  /** Trailing bytes past the length declared by the network layer. */
  ethernetPad: Buffer;
}

export function decodePacket(
  frame: Buffer,
  timestamp: Date = new Date(),
  linkType: LinkType = 'ETHERNET',
): DecodedPacket {
  const packet: DecodedPacket = {
    timestamp,
    frameLength: frame.length,
    raw: frame,
    linkType,
    ethernet: null,
    llc: null,
    vlan: null,
    ipv4: null,
    ipv6: null,
    arp: null,
    tcp: null,
    udp: null,
    payload: null,
    ethernetPad: Buffer.alloc(0),
  };

  // Loopback and raw link layers carry no MAC addresses: the IP header follows a
  // 4-byte address-family word (NULL/LOOP) or begins immediately (RAW).
  if (linkType !== 'ETHERNET') {
    const ipOffset = linkType === 'RAW' ? 0 : 4;
    if (frame.length <= ipOffset) return packet;
    // The address family word's byte order differs between NULL and LOOP and
    // across platforms, so read the IP version nibble instead of trusting it.
    const version = (frame[ipOffset]! & 0xf0) >> 4;
    if (version === 4) decodeNetworkLayer(packet, frame, ipOffset, ETHER_TYPE.IPV4);
    else if (version === 6) decodeNetworkLayer(packet, frame, ipOffset, ETHER_TYPE.IPV6);
    return packet;
  }

  if (frame.length < ETHERNET_HEADER_LENGTH) return packet;

  const typeOrLength = frame.readUInt16BE(12);
  packet.ethernet = {
    destinationAddress: readMac(frame, 0),
    sourceAddress: readMac(frame, 6),
    type: formatEtherType(typeOrLength),
    typeValue: typeOrLength,
  };

  let offset = ETHERNET_HEADER_LENGTH;
  let etherType = typeOrLength;

  // 802.3 frame: the field is a length and an LLC header follows.
  if (typeOrLength <= 0x05dc) {
    packet.llc = decodeLlc(frame, offset);
    // A SNAP header carries the real EtherType two bytes past the OUI.
    const snap = decodeSnapEtherType(frame, offset);
    if (snap) {
      etherType = snap.etherType;
      offset = snap.nextOffset;
    } else {
      return packet;
    }
  }

  // Unwrap any number of 802.1Q / 802.1ad tags to reach the network layer.
  let tagGuard = 0;
  while ((etherType === ETHER_TYPE.DOT1Q || etherType === ETHER_TYPE.QINQ) && tagGuard < 4) {
    if (offset + 4 > frame.length) return packet;
    const tag = frame.readUInt16BE(offset);
    const inner = frame.readUInt16BE(offset + 2);
    if (!packet.vlan) {
      packet.vlan = {
        priority: (tag >> 13) & 0x07,
        cfi: (tag >> 12) & 0x01,
        vid: tag & 0x0fff,
        type: formatEtherType(inner),
      };
    }
    etherType = inner;
    offset += 4;
    tagGuard += 1;
  }

  decodeNetworkLayer(packet, frame, offset, etherType);
  return packet;
}

/** Decodes IPv4/IPv6/ARP and the transport layer beneath, from `offset`. */
function decodeNetworkLayer(packet: DecodedPacket, frame: Buffer, offset: number, etherType: number): void {
  switch (etherType) {
    case ETHER_TYPE.IPV4: {
      packet.ipv4 = decodeIpv4(frame, offset);
      if (packet.ipv4) {
        const transportOffset = offset + packet.ipv4.headerLength;
        const declaredEnd = offset + packet.ipv4.totalLength;
        decodeTransport(packet, frame, transportOffset, packet.ipv4.protocol, declaredEnd);
        packet.ethernetPad = trailingBytes(frame, declaredEnd);
      }
      break;
    }
    case ETHER_TYPE.IPV6: {
      packet.ipv6 = decodeIpv6(frame, offset);
      if (packet.ipv6) {
        const transportOffset = offset + 40;
        const declaredEnd = transportOffset + packet.ipv6.payloadLength;
        decodeTransport(packet, frame, transportOffset, packet.ipv6.nextHeader, declaredEnd);
        packet.ethernetPad = trailingBytes(frame, declaredEnd);
      }
      break;
    }
    case ETHER_TYPE.ARP:
    case ETHER_TYPE.RARP: {
      packet.arp = decodeArp(frame, offset);
      // ARP is a fixed 28 bytes for Ethernet/IPv4; frames are padded to 60.
      if (packet.arp) packet.ethernetPad = trailingBytes(frame, offset + 28);
      break;
    }
    default:
      break;
  }
}

function trailingBytes(frame: Buffer, declaredEnd: number): Buffer {
  if (declaredEnd <= 0 || declaredEnd >= frame.length) return Buffer.alloc(0);
  return frame.subarray(declaredEnd);
}

function decodeLlc(frame: Buffer, offset: number): LlcHeader | null {
  if (offset + 3 > frame.length) return null;
  const dsap = frame[offset]!;
  const ssap = frame[offset + 1]!;
  const control = frame[offset + 2]!;
  // Bits 0-1 == 11 marks an unnumbered frame, whose control field is one byte.
  const unnumbered = (control & 0x03) === 0x03;
  if (unnumbered) {
    return { dsap: formatLlcSap(dsap), ssap: formatLlcSap(ssap), control: formatLlcControl(control, false) };
  }
  if (offset + 4 > frame.length) return null;
  return {
    dsap: formatLlcSap(dsap),
    ssap: formatLlcSap(ssap),
    control: formatLlcControl(frame.readUInt16BE(offset + 2), true),
  };
}

function decodeSnapEtherType(
  frame: Buffer,
  llcOffset: number,
): { etherType: number; nextOffset: number } | null {
  // LLC (3 bytes, DSAP=SSAP=0xaa) + SNAP (3-byte OUI + 2-byte EtherType).
  if (llcOffset + 8 > frame.length) return null;
  if (frame[llcOffset] !== 0xaa || frame[llcOffset + 1] !== 0xaa) return null;
  return {
    etherType: frame.readUInt16BE(llcOffset + 6),
    nextOffset: llcOffset + 8,
  };
}

function decodeIpv4(frame: Buffer, offset: number): Ipv4Header | null {
  if (offset + 20 > frame.length) return null;

  const versionAndIhl = frame[offset]!;
  const version = versionAndIhl >> 4;
  const headerLength = (versionAndIhl & 0x0f) * 4;
  if (version !== 4 || headerLength < 20) return null;

  const flagsAndFragment = frame.readUInt16BE(offset + 6);
  const totalLength = frame.readUInt16BE(offset + 2);
  const protocol = frame[offset + 9]!;

  return {
    version,
    headerLength,
    tos: frame[offset + 1]!,
    // Some NICs offload segmentation and report 0 here; fall back to what we captured.
    totalLength: totalLength === 0 ? frame.length - offset : totalLength,
    identification: frame.readUInt16BE(offset + 4),
    flags: {
      reserved: (flagsAndFragment & 0x8000) !== 0,
      dontFragment: (flagsAndFragment & 0x4000) !== 0,
      moreFragment: (flagsAndFragment & 0x2000) !== 0,
    },
    fragmentOffset: (flagsAndFragment & 0x1fff) * 8,
    ttl: frame[offset + 8]!,
    protocol,
    protocolName: ipProtocolName(protocol),
    headerChecksum: frame.readUInt16BE(offset + 10),
    srcAddr: readIpv4(frame, offset + 12),
    dstAddr: readIpv4(frame, offset + 16),
  };
}

function decodeIpv6(frame: Buffer, offset: number): Ipv6Header | null {
  if (offset + 40 > frame.length) return null;

  const first = frame.readUInt32BE(offset);
  const version = first >>> 28;
  if (version !== 6) return null;

  const nextHeader = frame[offset + 6]!;
  const payloadLength = frame.readUInt16BE(offset + 4);

  return {
    version,
    trafficClass: (first >>> 20) & 0xff,
    flowLabel: first & 0x000fffff,
    payloadLength: payloadLength === 0 ? Math.max(0, frame.length - offset - 40) : payloadLength,
    nextHeader,
    nextHeaderName: ipProtocolName(nextHeader),
    hopLimit: frame[offset + 7]!,
    srcAddr: readIpv6(frame, offset + 8),
    dstAddr: readIpv6(frame, offset + 24),
  };
}

function decodeArp(frame: Buffer, offset: number): ArpHeader | null {
  if (offset + 28 > frame.length) return null;

  const hardwareAddrLength = frame[offset + 4]!;
  const protocolAddrLength = frame[offset + 5]!;
  const operation = frame.readUInt16BE(offset + 6);

  // Only Ethernet (hlen 6) + IPv4 (plen 4) is laid out at the offsets below.
  if (hardwareAddrLength !== 6 || protocolAddrLength !== 4) return null;

  return {
    hardwareType: frame.readUInt16BE(offset),
    protocolType: frame.readUInt16BE(offset + 2),
    hardwareAddrLength,
    protocolAddrLength,
    operation,
    operationName: formatArpOperation(operation),
    srcHardwareAddr: readMac(frame, offset + 8),
    srcProtocolAddr: readIpv4(frame, offset + 14),
    dstHardwareAddr: readMac(frame, offset + 18),
    dstProtocolAddr: readIpv4(frame, offset + 24),
  };
}

function decodeTransport(
  packet: DecodedPacket,
  frame: Buffer,
  offset: number,
  protocol: number,
  declaredEnd: number,
): void {
  const limit = Math.min(declaredEnd > offset ? declaredEnd : frame.length, frame.length);

  if (protocol === IP_PROTOCOL.TCP) {
    if (offset + 20 > frame.length) return;
    const flags = frame[offset + 13]!;
    const dataOffset = (frame[offset + 12]! >> 4) * 4;
    packet.tcp = {
      srcPort: frame.readUInt16BE(offset),
      dstPort: frame.readUInt16BE(offset + 2),
      sequenceNumber: frame.readUInt32BE(offset + 4),
      acknowledgmentNumber: frame.readUInt32BE(offset + 8),
      dataOffset,
      urg: (flags & 0x20) !== 0,
      ack: (flags & 0x10) !== 0,
      psh: (flags & 0x08) !== 0,
      rst: (flags & 0x04) !== 0,
      syn: (flags & 0x02) !== 0,
      fin: (flags & 0x01) !== 0,
      window: frame.readUInt16BE(offset + 14),
      checksum: frame.readUInt16BE(offset + 16),
      urgentPointer: frame.readUInt16BE(offset + 18),
    };
    const payloadStart = offset + Math.max(20, dataOffset);
    packet.payload = payloadStart < limit ? frame.subarray(payloadStart, limit) : Buffer.alloc(0);
    return;
  }

  if (protocol === IP_PROTOCOL.UDP) {
    if (offset + 8 > frame.length) return;
    packet.udp = {
      srcPort: frame.readUInt16BE(offset),
      dstPort: frame.readUInt16BE(offset + 2),
      length: frame.readUInt16BE(offset + 4),
      checksum: frame.readUInt16BE(offset + 6),
    };
    const payloadStart = offset + 8;
    packet.payload = payloadStart < limit ? frame.subarray(payloadStart, limit) : Buffer.alloc(0);
  }
}

/** Source/destination IP from whichever network layer was present. */
export function ipAddresses(packet: DecodedPacket): { src: string | null; dst: string | null } {
  if (packet.ipv4) return { src: packet.ipv4.srcAddr, dst: packet.ipv4.dstAddr };
  if (packet.ipv6) return { src: packet.ipv6.srcAddr, dst: packet.ipv6.dstAddr };
  return { src: null, dst: null };
}

/** Was PacketCaptureService.getProtocol(Packet). */
export function protocolOf(packet: DecodedPacket): string {
  if (packet.ipv4) return packet.ipv4.protocolName;
  if (packet.ipv6) return packet.ipv6.nextHeaderName;
  return 'Unknown Protocol';
}

/**
 * Multi-line dump equivalent to Pcap4J's `packet.toString()`, used for the
 * `details` column on anomaly logs.
 */
export function describePacket(packet: DecodedPacket): string {
  const lines: string[] = [];

  if (packet.ethernet) {
    lines.push(`[Ethernet Header (${ETHERNET_HEADER_LENGTH} bytes)]`);
    lines.push(`  Destination address: ${packet.ethernet.destinationAddress}`);
    lines.push(`  Source address: ${packet.ethernet.sourceAddress}`);
    lines.push(`  Type: ${packet.ethernet.type}`);
  }

  if (packet.llc) {
    lines.push('[LLC Header]');
    lines.push(`  DSAP: ${packet.llc.dsap}`);
    lines.push(`  SSAP: ${packet.llc.ssap}`);
    lines.push(`  Control: ${packet.llc.control}`);
  }

  if (packet.vlan) {
    lines.push('[IEEE802.1Q Tag]');
    lines.push(`  Priority: ${packet.vlan.priority}`);
    lines.push(`  CFI: ${packet.vlan.cfi}`);
    lines.push(`  VID: ${packet.vlan.vid}`);
    lines.push(`  Type: ${packet.vlan.type}`);
  }

  if (packet.ipv4) {
    const ip = packet.ipv4;
    lines.push(`[IPv4 Header (${ip.headerLength} bytes)]`);
    lines.push(`  Version: ${ip.version} (IPv4)`);
    lines.push(`  IHL: ${ip.headerLength / 4} (${ip.headerLength} [bytes])`);
    lines.push(`  TOS: ${ip.tos}`);
    lines.push(`  Total length: ${ip.totalLength} [bytes]`);
    lines.push(`  Identification: ${ip.identification}`);
    lines.push(
      `  Flags: (Reserved, Don't Fragment, More Fragment) = ` +
        `(${ip.flags.reserved}, ${ip.flags.dontFragment}, ${ip.flags.moreFragment})`,
    );
    lines.push(`  Fragment offset: ${ip.fragmentOffset / 8} (${ip.fragmentOffset} [bytes])`);
    lines.push(`  TTL: ${ip.ttl}`);
    lines.push(`  Protocol: ${formatIpProtocol(ip.protocol)}`);
    lines.push(`  Header checksum: 0x${ip.headerChecksum.toString(16).padStart(4, '0')}`);
    lines.push(`  Source address: ${ip.srcAddr}`);
    lines.push(`  Destination address: ${ip.dstAddr}`);
  }

  if (packet.ipv6) {
    const ip = packet.ipv6;
    lines.push('[IPv6 Header (40 bytes)]');
    lines.push(`  Version: ${ip.version} (IPv6)`);
    lines.push(`  Traffic class: ${ip.trafficClass}`);
    lines.push(`  Flow label: ${ip.flowLabel}`);
    lines.push(`  Payload length: ${ip.payloadLength} [bytes]`);
    lines.push(`  Next header: ${formatIpProtocol(ip.nextHeader)}`);
    lines.push(`  Hop limit: ${ip.hopLimit}`);
    lines.push(`  Source address: ${ip.srcAddr}`);
    lines.push(`  Destination address: ${ip.dstAddr}`);
  }

  if (packet.arp) {
    const arp = packet.arp;
    lines.push('[ARP Header (28 bytes)]');
    lines.push(`  Hardware type: ${arp.hardwareType}`);
    lines.push(`  Protocol type: ${arp.protocolType}`);
    lines.push(`  Operation: ${arp.operationName}`);
    lines.push(`  Source hardware address: ${arp.srcHardwareAddr}`);
    lines.push(`  Source protocol address: ${arp.srcProtocolAddr}`);
    lines.push(`  Destination hardware address: ${arp.dstHardwareAddr}`);
    lines.push(`  Destination protocol address: ${arp.dstProtocolAddr}`);
  }

  if (packet.tcp) {
    const tcp = packet.tcp;
    lines.push(`[TCP Header (${tcp.dataOffset} bytes)]`);
    lines.push(`  Source port: ${tcp.srcPort}`);
    lines.push(`  Destination port: ${tcp.dstPort}`);
    lines.push(`  Sequence Number: ${tcp.sequenceNumber}`);
    lines.push(`  Acknowledgment Number: ${tcp.acknowledgmentNumber}`);
    lines.push(`  Data Offset: ${tcp.dataOffset / 4} (${tcp.dataOffset} [bytes])`);
    lines.push(`  URG: ${tcp.urg}`);
    lines.push(`  ACK: ${tcp.ack}`);
    lines.push(`  PSH: ${tcp.psh}`);
    lines.push(`  RST: ${tcp.rst}`);
    lines.push(`  SYN: ${tcp.syn}`);
    lines.push(`  FIN: ${tcp.fin}`);
    lines.push(`  Window: ${tcp.window}`);
    lines.push(`  Checksum: 0x${tcp.checksum.toString(16).padStart(4, '0')}`);
    lines.push(`  Urgent Pointer: ${tcp.urgentPointer}`);
  }

  if (packet.udp) {
    lines.push('[UDP Header (8 bytes)]');
    lines.push(`  Source port: ${packet.udp.srcPort}`);
    lines.push(`  Destination port: ${packet.udp.dstPort}`);
    lines.push(`  Length: ${packet.udp.length} [bytes]`);
    lines.push(`  Checksum: 0x${packet.udp.checksum.toString(16).padStart(4, '0')}`);
  }

  if (packet.payload && packet.payload.length > 0) {
    lines.push(`[data (${packet.payload.length} bytes)]`);
    lines.push(`  Hex stream: ${toHexStream(packet.payload)}`);
  }

  if (packet.ethernetPad.length > 0) {
    lines.push(`[Ethernet Pad (${packet.ethernetPad.length} bytes)]`);
    lines.push(`  Hex stream: ${toHexStream(packet.ethernetPad)}`);
  }

  if (lines.length === 0) {
    lines.push(`[Unparsed frame (${packet.frameLength} bytes)]`);
  }

  return lines.join('\n');
}
