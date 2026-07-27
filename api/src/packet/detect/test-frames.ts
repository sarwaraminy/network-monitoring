/**
 * Frame builders for the detector tests.
 *
 * Real Ethernet/IP/TCP/UDP frames are assembled here rather than mocking the
 * decoder, so the tests exercise decode.ts and the detectors together — the same
 * path a captured packet takes.
 *
 * Test-only, but it lives in src/ so it is typechecked with everything else.
 */

const DEFAULT_SRC_MAC = '38:f7:cd:c4:a0:6f';
const DEFAULT_DST_MAC = '10:56:ca:05:3c:14';

function mac(value: string): Buffer {
  return Buffer.from(value.replace(/:/g, ''), 'hex');
}

function ipv4(value: string): Buffer {
  return Buffer.from(value.split('.').map(Number));
}

function ethernet(srcMac: string, dstMac: string, etherType: number): Buffer {
  const header = Buffer.alloc(14);
  mac(dstMac).copy(header, 0);
  mac(srcMac).copy(header, 6);
  header.writeUInt16BE(etherType, 12);
  return header;
}

/** IPv4 header with a correct total length; checksum is left zero (unchecked). */
function ipv4Header(srcIp: string, dstIp: string, protocol: number, payloadLength: number): Buffer {
  const header = Buffer.alloc(20);
  header[0] = 0x45; // version 4, IHL 5
  header[1] = 0x00; // TOS
  header.writeUInt16BE(20 + payloadLength, 2); // total length
  header.writeUInt16BE(0x1234, 4); // identification
  header.writeUInt16BE(0x4000, 6); // don't fragment
  header[8] = 64; // TTL
  header[9] = protocol;
  header.writeUInt16BE(0, 10); // checksum
  ipv4(srcIp).copy(header, 12);
  ipv4(dstIp).copy(header, 16);
  return header;
}

export interface TcpFrameOptions {
  srcIp: string;
  dstIp: string;
  srcPort?: number;
  dstPort: number;
  srcMac?: string;
  dstMac?: string;
  flags?: { syn?: boolean; ack?: boolean; psh?: boolean; fin?: boolean; rst?: boolean; urg?: boolean };
  payload?: string | Buffer;
}

export function buildTcp(options: TcpFrameOptions): Buffer {
  const payload =
    options.payload === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(options.payload)
        ? options.payload
        : Buffer.from(options.payload, 'latin1');

  const tcp = Buffer.alloc(20);
  tcp.writeUInt16BE(options.srcPort ?? 51_000, 0);
  tcp.writeUInt16BE(options.dstPort, 2);
  tcp.writeUInt32BE(0x1000, 4); // sequence
  tcp.writeUInt32BE(0x2000, 8); // acknowledgment
  tcp[12] = 5 << 4; // data offset 5 words = 20 bytes

  const flags = options.flags ?? {};
  tcp[13] =
    (flags.urg ? 0x20 : 0) |
    (flags.ack ? 0x10 : 0) |
    (flags.psh ? 0x08 : 0) |
    (flags.rst ? 0x04 : 0) |
    (flags.syn ? 0x02 : 0) |
    (flags.fin ? 0x01 : 0);

  tcp.writeUInt16BE(64_240, 14); // window
  tcp.writeUInt16BE(0, 16); // checksum
  tcp.writeUInt16BE(0, 18); // urgent pointer

  return pad(
    Buffer.concat([
      ethernet(options.srcMac ?? DEFAULT_SRC_MAC, options.dstMac ?? DEFAULT_DST_MAC, 0x0800),
      ipv4Header(options.srcIp, options.dstIp, 6, tcp.length + payload.length),
      tcp,
      payload,
    ]),
  );
}

export interface UdpFrameOptions {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  srcMac?: string;
  dstMac?: string;
  payload?: string | Buffer;
}

export function buildUdp(options: UdpFrameOptions): Buffer {
  const payload =
    options.payload === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(options.payload)
        ? options.payload
        : Buffer.from(options.payload, 'latin1');

  const udp = Buffer.alloc(8);
  udp.writeUInt16BE(options.srcPort, 0);
  udp.writeUInt16BE(options.dstPort, 2);
  udp.writeUInt16BE(8 + payload.length, 4);
  udp.writeUInt16BE(0, 6);

  return pad(
    Buffer.concat([
      ethernet(options.srcMac ?? DEFAULT_SRC_MAC, options.dstMac ?? DEFAULT_DST_MAC, 0x0800),
      ipv4Header(options.srcIp, options.dstIp, 17, udp.length + payload.length),
      udp,
      payload,
    ]),
  );
}

export interface DnsFrameOptions {
  srcIp: string;
  dstIp: string;
  queryName: string;
  srcMac?: string;
}

/** A DNS query for `queryName`, as a UDP datagram to port 53. */
export function buildDns(options: DnsFrameOptions): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0); // transaction id
  header.writeUInt16BE(0x0100, 2); // standard query, recursion desired
  header.writeUInt16BE(1, 4); // one question

  // QNAME: each label length-prefixed, terminated by a zero byte.
  const labels: Buffer[] = [];
  for (const label of options.queryName.split('.')) {
    const bytes = Buffer.from(label, 'latin1');
    labels.push(Buffer.from([bytes.length]), bytes);
  }
  labels.push(Buffer.from([0]));

  const trailer = Buffer.alloc(4);
  trailer.writeUInt16BE(1, 0); // QTYPE A
  trailer.writeUInt16BE(1, 2); // QCLASS IN

  return buildUdp({
    srcIp: options.srcIp,
    dstIp: options.dstIp,
    srcPort: 53_535,
    dstPort: 53,
    ...(options.srcMac ? { srcMac: options.srcMac } : {}),
    payload: Buffer.concat([header, ...labels, trailer]),
  });
}

export interface ArpFrameOptions {
  senderIp: string;
  senderMac: string;
  targetIp?: string;
  /** 1 = request, 2 = reply. */
  operation?: number;
}

export function buildArp(options: ArpFrameOptions): Buffer {
  const body = Buffer.alloc(28);
  body.writeUInt16BE(1, 0); // hardware type: Ethernet
  body.writeUInt16BE(0x0800, 2); // protocol type: IPv4
  body[4] = 6; // hardware address length
  body[5] = 4; // protocol address length
  body.writeUInt16BE(options.operation ?? 1, 6);
  mac(options.senderMac).copy(body, 8);
  ipv4(options.senderIp).copy(body, 14);
  // Target hardware address stays zero for a request.
  ipv4(options.targetIp ?? '10.0.0.89').copy(body, 24);

  return pad(Buffer.concat([ethernet(options.senderMac, 'ff:ff:ff:ff:ff:ff', 0x0806), body]));
}

/** Pads to the 60-byte Ethernet minimum, as a real NIC would. */
function pad(frame: Buffer): Buffer {
  if (frame.length >= 60) return frame;
  return Buffer.concat([frame, Buffer.alloc(60 - frame.length)]);
}
