import net from 'node:net';
import { componentLogger } from '../logger.js';

const log = componentLogger('whois');

/**
 * Replaces cyber.wissen.networkservice.IPWhoisService: opens a WHOIS (RFC 3912)
 * connection to whois.iana.org:43, writes the query, and reads until close.
 *
 * Returns null on failure, as the Java version did. Adds a timeout and a response
 * size cap so a slow or chatty server cannot hang or flood the request.
 */
const WHOIS_HOST = 'whois.iana.org';
const WHOIS_PORT = 43;
const TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export async function getWhoisData(ipAddress: string): Promise<string | null> {
  // The query is written straight onto the socket, so reject anything with CRLF
  // or other control characters that could inject a second command.
  if (!/^[\w.:@-]{1,255}$/.test(ipAddress)) return null;

  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    const socket = net.createConnection({ host: WHOIS_HOST, port: WHOIS_PORT });
    socket.setTimeout(TIMEOUT_MS);

    socket.on('connect', () => {
      socket.write(`${ipAddress}\r\n`);
    });

    socket.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_RESPONSE_BYTES) {
        finish(Buffer.concat(chunks).toString('utf8'));
        return;
      }
      chunks.push(chunk);
    });

    socket.on('end', () => finish(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null));
    socket.on('timeout', () => finish(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null));
    socket.on('error', (error) => {
      log.warn({ ipAddress, err: error }, 'WHOIS lookup failed');
      finish(null);
    });
  });
}
