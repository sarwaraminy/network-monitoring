/** Buffer -> address string helpers, replacing Pcap4J's MacAddress / InetAddress use. */

/** Lowercase colon-separated MAC, e.g. `00:1a:2b:3c:4d:5e` — same as Pcap4J. */
export function readMac(buffer: Buffer, offset: number): string {
  const bytes: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    bytes.push((buffer[offset + i] ?? 0).toString(16).padStart(2, '0'));
  }
  return bytes.join(':');
}

/** Dotted-quad IPv4, e.g. `192.168.1.10`. */
export function readIpv4(buffer: Buffer, offset: number): string {
  return [
    buffer[offset] ?? 0,
    buffer[offset + 1] ?? 0,
    buffer[offset + 2] ?? 0,
    buffer[offset + 3] ?? 0,
  ].join('.');
}

/**
 * IPv6 in the canonical short form of RFC 5952 (`2001:db8::1`).
 *
 * Java's Inet6Address.getHostAddress() emitted every group uncompressed
 * (`2001:db8:0:0:0:0:0:1`); the compressed form is what users expect to see and
 * is what the geolocation/WHOIS lookups accept.
 */
export function readIpv6(buffer: Buffer, offset: number): string {
  const groups: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    groups.push(((buffer[offset + i * 2] ?? 0) << 8) | (buffer[offset + i * 2 + 1] ?? 0));
  }

  // Longest run of two or more zero groups gets replaced by "::".
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let i = 0; i <= groups.length; i += 1) {
    if (i < groups.length && groups[i] === 0) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLength = i - runStart;
      if (runLength > bestLength) {
        bestStart = runStart;
        bestLength = runLength;
      }
      runStart = -1;
    }
  }

  const hexGroups = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hexGroups.join(':');

  const head = hexGroups.slice(0, bestStart).join(':');
  const tail = hexGroups.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/** Space-separated lowercase hex, matching the old toHexStream(byte[]). */
export function toHexStream(data: Buffer): string {
  if (data.length === 0) return '';
  const parts: string[] = [];
  for (const byte of data) parts.push(byte.toString(16).padStart(2, '0'));
  return parts.join(' ');
}

/** Printable ASCII passed through, everything else as \xNN — was HexConverter.formatAsReadable. */
export function formatAsReadable(data: Buffer): string {
  let out = '';
  for (const byte of data) {
    out +=
      byte >= 32 && byte <= 126
        ? String.fromCharCode(byte)
        : `\\x${byte.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  return out;
}

/** Was HexConverter.hexStringToByteArray. */
export function hexStreamToBuffer(hexString: string): Buffer {
  const compact = hexString.replace(/\s+/g, '');
  if (compact.length % 2 !== 0) {
    throw new Error(`Invalid hex string: ${hexString}`);
  }
  if (!/^[0-9a-fA-F]*$/.test(compact)) {
    throw new Error(`Invalid hex string: ${hexString}`);
  }
  return Buffer.from(compact, 'hex');
}
