import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodePacket, describePacket, ipAddresses, protocolOf } from './decode.js';
import { toPacketDTO } from './mapping.js';

/**
 * Tests for the hand-written decoders that replaced Pcap4J — the part of the port
 * with the most room for silent error. Detector behaviour lives in detect.test.ts.
 *
 * The IPv4/TCP frame below is rebuilt byte-for-byte from a row the Java app wrote
 * to the database, so the expectations are Pcap4J's own output rather than this
 * implementation's.
 */

const frame = (hex: string): Buffer => Buffer.from(hex.replace(/\s+/g, ''), 'hex');

/** Ethernet + IPv4 (total length 40) + TCP ACK/FIN, padded to the 60-byte minimum. */
const IPV4_TCP = frame(`
  38 f7 cd c4 a0 6f  10 56 ca 05 3c 14  08 00
  45 00 00 28 aa 2c 40 00 34 06 b5 59  17 ce c5 23  0a 00 00 59
  01 bb dc 96  ef 5c 27 27  d9 df 8c 8c  50 11 01 f5  8f 45 00 00
  00 00 00 00 00 00
`);

describe('Ethernet + IPv4 + TCP', () => {
  const packet = decodePacket(IPV4_TCP);

  it('reads the Ethernet header', () => {
    assert.equal(packet.frameLength, 60);
    assert.equal(packet.ethernet?.destinationAddress, '38:f7:cd:c4:a0:6f');
    assert.equal(packet.ethernet?.sourceAddress, '10:56:ca:05:3c:14');
    // Pcap4J's exact rendering — the logs.ipversion column holds this string.
    assert.equal(packet.ethernet?.type, '0x0800 (IPv4)');
  });

  it('reads the IPv4 header', () => {
    assert.equal(packet.ipv4?.srcAddr, '23.206.197.35');
    assert.equal(packet.ipv4?.dstAddr, '10.0.0.89');
    assert.equal(packet.ipv4?.totalLength, 40);
    assert.equal(packet.ipv4?.headerLength, 20);
    assert.equal(packet.ipv4?.ttl, 52);
    assert.equal(packet.ipv4?.flags.dontFragment, true);
    assert.equal(packet.ipv4?.flags.moreFragment, false);
    assert.equal(protocolOf(packet), 'TCP');
  });

  it('reads the TCP header and flags', () => {
    assert.equal(packet.tcp?.srcPort, 443);
    assert.equal(packet.tcp?.dstPort, 56470);
    assert.equal(packet.tcp?.dataOffset, 20);
    assert.equal(packet.tcp?.window, 501);
    assert.equal(packet.tcp?.ack, true);
    assert.equal(packet.tcp?.fin, true);
    assert.equal(packet.tcp?.syn, false);
    assert.equal(packet.tcp?.psh, false);
    assert.equal(packet.payload?.length, 0);
  });

  it('computes Ethernet padding from the declared IP length', () => {
    // 60-byte frame - (14 Ethernet + 40 IPv4 total length) = 6 bytes.
    // Pcap4J reported exactly this; the Java app's own extractEthernetPad(),
    // which assumed fixed 14+20+20 offsets, did not.
    assert.equal(packet.ethernetPad.length, 6);
    assert.equal(toPacketDTO(packet).ethernetPadHexStream, '00 00 00 00 00 00');
  });

  it('renders a Pcap4J-style detail dump', () => {
    const details = describePacket(packet);
    assert.match(details, /^\[Ethernet Header \(14 bytes\)\]/);
    assert.match(details, /Type: 0x0800 \(IPv4\)/);
    assert.match(details, /Protocol: 6 \(TCP\)/);
    assert.match(details, /Source address: 23\.206\.197\.35/);
    assert.match(details, /\[Ethernet Pad \(6 bytes\)\]/);
  });
});

describe('PacketDTO', () => {
  const packet = decodePacket(IPV4_TCP);

  it('exposes the hex streams by default', () => {
    const dto = toPacketDTO(packet);
    assert.equal(dto.payloadRedacted, false);
    assert.equal(dto.frameLength, 60);
    assert.ok(dto.dataHexStream.startsWith('38 f7 cd'));
  });

  it('blanks hex streams when payload redaction is on', () => {
    // REDACT_PACKET_PAYLOAD, for deployments where captured content is sensitive.
    const dto = toPacketDTO(packet, { redactPayload: true });
    assert.equal(dto.payloadRedacted, true);
    assert.equal(dto.dataHexStream, '');
    assert.equal(dto.ethernetPadHexStream, '');
    // Metadata still present, so the row remains useful.
    assert.equal(dto.frameLength, 60);
    assert.equal(dto.sourceIpAddress, '23.206.197.35');
    assert.equal(dto.ethernetHeader.type, '0x0800 (IPv4)');
  });
});

describe('ARP', () => {
  // 28-byte ARP body in a 60-byte frame -> 18 bytes of padding.
  const packet = decodePacket(
    frame(`
      ff ff ff ff ff ff  10 56 ca 05 3c 14  08 06
      00 01 08 00 06 04 00 01
      10 56 ca 05 3c 14  0a 00 00 4d
      00 00 00 00 00 00  0a 00 00 59
      00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    `),
  );

  it('reads the ARP header', () => {
    assert.equal(packet.frameLength, 60);
    assert.equal(packet.arp?.operationName, '1 (REQUEST)');
    assert.equal(packet.arp?.srcProtocolAddr, '10.0.0.77');
    assert.equal(packet.arp?.srcHardwareAddr, '10:56:ca:05:3c:14');
    assert.equal(packet.arp?.dstProtocolAddr, '10.0.0.89');
    assert.equal(packet.ethernet?.type, '0x0806 (ARP)');
  });

  it('treats the bytes past the 28-byte ARP body as padding', () => {
    assert.equal(packet.ethernetPad.length, 18);
  });

  it('has no IP layer', () => {
    assert.equal(ipAddresses(packet).src, null);
    assert.equal(ipAddresses(packet).dst, null);
  });
});

describe('IPv6 + UDP', () => {
  const packet = decodePacket(
    frame(`
      33 33 00 00 00 fb  10 56 ca 05 3c 14  86 dd
      60 00 00 00 00 10 11 ff
      20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 01
      fe 80 00 00 00 00 00 00 00 00 00 00 00 00 00 02
      14 e9 14 e9 00 10 00 00  de ad be ef 00 00 00 00
    `),
  );

  it('compresses addresses per RFC 5952', () => {
    assert.equal(packet.ipv6?.srcAddr, '2001:db8::1');
    assert.equal(packet.ipv6?.dstAddr, 'fe80::2');
    assert.equal(packet.ethernet?.type, '0x86dd (IPv6)');
  });

  it('reads the UDP header', () => {
    assert.equal(protocolOf(packet), 'UDP');
    assert.equal(packet.udp?.srcPort, 5353);
    assert.equal(packet.udp?.dstPort, 5353);
    assert.equal(packet.payload?.length, 8);
  });
});

describe('802.1Q VLAN tag', () => {
  it('unwraps the tag to reach the network layer', () => {
    const tagged = Buffer.concat([
      IPV4_TCP.subarray(0, 12),
      frame('81 00 20 64 08 00'), // VLAN tag, VID 100, inner type IPv4
      IPV4_TCP.subarray(14),
    ]);
    const packet = decodePacket(tagged);
    assert.equal(packet.vlan?.vid, 100);
    assert.equal(packet.ipv4?.srcAddr, '23.206.197.35');
    assert.equal(packet.tcp?.dstPort, 56470);
  });
});

describe('loopback and raw link layers', () => {
  // Npcap's loopback adapter reports DLT_NULL, not Ethernet: a 4-byte address
  // family word replaces the MAC header. Without this, loopback capture silently
  // produced nothing.
  const ipAndTcp = IPV4_TCP.subarray(14, 54);

  it('decodes a DLT_NULL frame', () => {
    // Address family 2 (AF_INET) in little-endian, as BSD/Windows emit it.
    const nullFrame = Buffer.concat([Buffer.from([0x02, 0x00, 0x00, 0x00]), ipAndTcp]);
    const packet = decodePacket(nullFrame, new Date(), 'NULL');

    assert.equal(packet.linkType, 'NULL');
    assert.equal(packet.ethernet, null, 'loopback frames carry no MAC addresses');
    assert.equal(packet.ipv4?.srcAddr, '23.206.197.35');
    assert.equal(packet.ipv4?.dstAddr, '10.0.0.89');
    assert.equal(packet.tcp?.dstPort, 56470);
  });

  it('decodes a DLT_NULL frame whose family word is big-endian', () => {
    // DLT_LOOP writes the family in network order; the version nibble is read
    // instead of trusting the word, so both work.
    const loopFrame = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x02]), ipAndTcp]);
    const packet = decodePacket(loopFrame, new Date(), 'LOOP');
    assert.equal(packet.ipv4?.srcAddr, '23.206.197.35');
  });

  it('decodes a DLT_RAW frame, which has no link header', () => {
    const packet = decodePacket(ipAndTcp, new Date(), 'RAW');
    assert.equal(packet.ethernet, null);
    assert.equal(packet.ipv4?.dstAddr, '10.0.0.89');
    assert.equal(packet.tcp?.srcPort, 443);
  });

  it('survives a NULL frame with nothing after the family word', () => {
    const packet = decodePacket(Buffer.from([0x02, 0x00, 0x00, 0x00]), new Date(), 'NULL');
    assert.equal(packet.ipv4, null);
    assert.equal(packet.ethernet, null);
  });
});

describe('malformed input', () => {
  it('survives an empty buffer', () => {
    assert.equal(decodePacket(Buffer.alloc(0)).ethernet, null);
  });

  it('survives a frame shorter than the Ethernet header', () => {
    assert.equal(decodePacket(Buffer.alloc(10)).ethernet, null);
  });

  it('keeps the Ethernet header when the IP header is truncated', () => {
    const truncated = decodePacket(IPV4_TCP.subarray(0, 20));
    assert.equal(truncated.ethernet?.type, '0x0800 (IPv4)');
    assert.equal(truncated.ipv4, null);
    assert.equal(truncated.ethernetPad.length, 0);
  });

  it('survives a frame that claims to be IPv4 but is not', () => {
    const bogus = Buffer.from(IPV4_TCP);
    bogus[14] = 0x00; // version nibble 0
    assert.equal(decodePacket(bogus).ipv4, null);
  });
});
