import type { DecodedPacket } from '../decode.js';
import type { Detector, Finding } from './types.js';

/**
 * Credentials and session data travelling without encryption.
 *
 * This is the most directly useful thing a passive network monitor can tell an
 * operator: it is unambiguous, it is always a real problem, and it is invisible
 * from the endpoint. Anything readable here is equally readable to every other
 * device on the path.
 *
 * PRIVACY CONTRACT — do not weaken:
 *   - Passwords, tokens and session cookies are NEVER recorded. Only the fact
 *     that a secret was present, plus its length, which is enough to prove the
 *     finding without storing the secret.
 *   - Usernames ARE recorded, because an alert nobody can act on is worthless.
 *   - Raw payload bytes are never put into evidence.
 */

/** Ports whose protocols carry credentials in the clear. */
const CLEARTEXT_SERVICE_PORTS = new Set([21, 23, 25, 110, 143, 389, 587, 1521, 3306]);
/** Ports commonly serving plain HTTP. Content sniffing covers anything else. */
const HTTP_PORTS = new Set([80, 591, 3000, 8000, 8008, 8080, 8081, 8888]);

/** Only the start of a payload is examined, to bound work per packet. */
const MAX_INSPECT_BYTES = 2048;

/** First bytes of an HTTP request line, checked before any string conversion. */
const HTTP_METHOD_PREFIXES = ['GET ', 'POST', 'PUT ', 'HEAD', 'OPTI', 'DELE', 'PATC', 'HTTP'];

export class PlaintextCredentialDetector implements Detector {
  readonly name = 'plaintext_credentials' as const;

  inspect(packet: DecodedPacket): Finding[] {
    const tcp = packet.tcp;
    const payload = packet.payload;
    if (!tcp || !payload || payload.length === 0) return [];

    const srcPort = tcp.srcPort;
    const dstPort = tcp.dstPort;
    const watched =
      CLEARTEXT_SERVICE_PORTS.has(dstPort) ||
      CLEARTEXT_SERVICE_PORTS.has(srcPort) ||
      HTTP_PORTS.has(dstPort) ||
      HTTP_PORTS.has(srcPort);

    const slice = payload.subarray(0, MAX_INSPECT_BYTES);
    const looksHttp = HTTP_METHOD_PREFIXES.some((prefix) => startsWith(slice, prefix));

    if (!watched && !looksHttp) return [];

    // latin1 keeps a 1:1 byte-to-char mapping, so offsets stay meaningful and no
    // multi-byte decoding cost is paid.
    const text = slice.toString('latin1');
    const source = packet.ipv4?.srcAddr ?? packet.ipv6?.srcAddr ?? null;
    const target = packet.ipv4?.dstAddr ?? packet.ipv6?.dstAddr ?? null;

    const findings: Finding[] = [];
    const context = { packet, source, target, port: dstPort };

    if (looksHttp || HTTP_PORTS.has(dstPort) || HTTP_PORTS.has(srcPort)) {
      findings.push(...this.inspectHttp(text, context));
    }
    if (dstPort === 21 || srcPort === 21) findings.push(...this.inspectFtp(text, context));
    if (dstPort === 23 || srcPort === 23) findings.push(...this.inspectTelnet(context));
    if ([110, 143].includes(dstPort) || [110, 143].includes(srcPort)) {
      findings.push(...this.inspectMailbox(text, context));
    }
    if ([25, 587].includes(dstPort) || [25, 587].includes(srcPort)) {
      findings.push(...this.inspectSmtp(text, context));
    }

    return findings;
  }

  private inspectHttp(text: string, context: Context): Finding[] {
    const findings: Finding[] = [];

    // Authorization: Basic <base64(user:pass)>
    const basic = /^authorization:[ \t]*basic[ \t]+([A-Za-z0-9+/=]+)/im.exec(text);
    if (basic?.[1]) {
      const decoded = safeBase64(basic[1]);
      const separator = decoded.indexOf(':');
      const username = separator === -1 ? decoded : decoded.slice(0, separator);
      const secretLength = separator === -1 ? 0 : decoded.length - separator - 1;

      findings.push(
        this.finding(context, {
          severity: 'critical',
          service: 'HTTP Basic authentication',
          title: `Cleartext HTTP credentials for "${sanitize(username)}" to ${context.target}`,
          description:
            `An HTTP Basic "Authorization" header was captured in the clear on port ${context.port}. ` +
            `The username is "${sanitize(username)}" and the password was recovered from the same header ` +
            '(it is deliberately not recorded here). Anyone positioned on this network path — including ' +
            'the operator of any intermediate switch, router or Wi-Fi access point — can read this ' +
            'password directly. Move the service to HTTPS and rotate the credential.',
          evidence: {
            username: sanitize(username),
            passwordLength: secretLength,
            passwordRecorded: false,
            host: firstHeader(text, 'host'),
            requestLine: firstLine(text),
          },
          dedupSuffix: `http-basic|${sanitize(username)}`,
        }),
      );
    }

    // A password field in a form body sent over plain HTTP.
    const formField = /(?:^|[&?\s])(password|passwd|pwd|pass)=([^&\s"']{1,256})/i.exec(text);
    if (formField?.[2]) {
      findings.push(
        this.finding(context, {
          severity: 'critical',
          service: 'HTTP form submission',
          title: `Password submitted over unencrypted HTTP to ${context.target}`,
          description:
            `A form field named "${formField[1]}" was sent over plain HTTP on port ${context.port}. ` +
            'The value is readable by anyone on the network path and is not recorded here. Any login ' +
            'form must be served and submitted over HTTPS.',
          evidence: {
            fieldName: formField[1]?.toLowerCase() ?? 'password',
            valueLength: formField[2].length,
            valueRecorded: false,
            host: firstHeader(text, 'host'),
            requestLine: firstLine(text),
            username: extractFormUsername(text),
          },
          dedupSuffix: `http-form|${firstHeader(text, 'host') ?? context.target}`,
        }),
      );
    }

    // A session cookie in the clear is as good as the password to an attacker.
    if (/^cookie:/im.test(text) && /(session|sessid|sid|auth|token|jwt)/i.test(text)) {
      findings.push(
        this.finding(context, {
          severity: 'high',
          service: 'HTTP session cookie',
          title: `Session cookie sent over unencrypted HTTP to ${context.target}`,
          description:
            'A cookie that looks like a session identifier was sent over plain HTTP. Capturing it allows ' +
            'an attacker to hijack the session without ever knowing the password. The cookie value is not ' +
            'recorded here. Serve the site over HTTPS and set the Secure and HttpOnly flags.',
          evidence: {
            host: firstHeader(text, 'host'),
            requestLine: firstLine(text),
            cookieValueRecorded: false,
          },
          dedupSuffix: `http-cookie|${firstHeader(text, 'host') ?? context.target}`,
        }),
      );
    }

    return findings;
  }

  private inspectFtp(text: string, context: Context): Finding[] {
    const user = /^USER[ \t]+(\S{1,128})/im.exec(text);
    const pass = /^PASS[ \t]+(\S{1,128})/im.exec(text);
    if (!user && !pass) return [];

    return [
      this.finding(context, {
        severity: 'critical',
        service: 'FTP',
        title: user?.[1]
          ? `Cleartext FTP login for "${sanitize(user[1])}" to ${context.target}`
          : `Cleartext FTP password sent to ${context.target}`,
        description:
          'FTP transmits its credentials as plain text by design. ' +
          (pass ? 'A PASS command was captured; the value is not recorded here. ' : '') +
          'Replace this service with SFTP or FTPS, and treat the credential as compromised.',
        evidence: {
          username: user?.[1] ? sanitize(user[1]) : null,
          passwordObserved: Boolean(pass),
          passwordLength: pass?.[1]?.length ?? 0,
          passwordRecorded: false,
        },
        dedupSuffix: `ftp|${user?.[1] ? sanitize(user[1]) : 'unknown'}`,
      }),
    ];
  }

  private inspectTelnet(context: Context): Finding[] {
    return [
      this.finding(context, {
        severity: 'high',
        service: 'Telnet',
        title: `Unencrypted Telnet session to ${context.target}`,
        description:
          'Telnet sends everything — credentials, commands and output — as plain text. Any device on the ' +
          'path can read and modify the session. Replace it with SSH; there is no configuration that ' +
          'makes Telnet safe.',
        evidence: { port: context.port, protocol: 'Telnet', contentRecorded: false },
        dedupSuffix: 'telnet',
      }),
    ];
  }

  private inspectMailbox(text: string, context: Context): Finding[] {
    // POP3: "USER bob" / "PASS secret". IMAP: "a1 LOGIN bob secret".
    const pop3User = /^USER[ \t]+(\S{1,128})/im.exec(text);
    const pop3Pass = /^PASS[ \t]+\S{1,128}/im.test(text);
    const imapLogin = /^\S+[ \t]+LOGIN[ \t]+"?([^"\s]{1,128})"?[ \t]+\S/im.exec(text);

    const username = pop3User?.[1] ?? imapLogin?.[1];
    if (!username && !pop3Pass) return [];

    const protocol = context.port === 110 ? 'POP3' : 'IMAP';
    return [
      this.finding(context, {
        severity: 'critical',
        service: protocol,
        title: username
          ? `Cleartext ${protocol} login for "${sanitize(username)}" to ${context.target}`
          : `Cleartext ${protocol} password sent to ${context.target}`,
        description:
          `A ${protocol} login was sent without encryption on port ${context.port}. Mail passwords are ` +
          'high value because mailbox access enables password resets on other services. The password is ' +
          `not recorded here. Use ${protocol} over TLS (port ${context.port === 110 ? '995' : '993'}) instead.`,
        evidence: {
          username: username ? sanitize(username) : null,
          protocol,
          passwordRecorded: false,
        },
        dedupSuffix: `${protocol.toLowerCase()}|${username ? sanitize(username) : 'unknown'}`,
      }),
    ];
  }

  private inspectSmtp(text: string, context: Context): Finding[] {
    const authPlain = /^AUTH[ \t]+PLAIN[ \t]+([A-Za-z0-9+/=]+)/im.exec(text);
    const authLogin = /^AUTH[ \t]+LOGIN/im.test(text);
    if (!authPlain && !authLogin) return [];

    let username: string | null = null;
    if (authPlain?.[1]) {
      // AUTH PLAIN is base64 of "\0username\0password".
      const parts = safeBase64(authPlain[1]).split('\0');
      username = parts[1] ?? null;
    }

    return [
      this.finding(context, {
        severity: 'critical',
        service: 'SMTP AUTH',
        title: username
          ? `Cleartext SMTP login for "${sanitize(username)}" to ${context.target}`
          : `Cleartext SMTP authentication to ${context.target}`,
        description:
          'SMTP authentication was sent without STARTTLS, so the credential crossed the network in a ' +
          'trivially decodable form (base64 is encoding, not encryption). A stolen SMTP credential is ' +
          'typically used to send phishing mail from your domain. The password is not recorded here.',
        evidence: {
          username: username ? sanitize(username) : null,
          mechanism: authPlain ? 'PLAIN' : 'LOGIN',
          passwordRecorded: false,
        },
        dedupSuffix: `smtp|${username ? sanitize(username) : 'unknown'}`,
      }),
    ];
  }

  private finding(
    context: Context,
    detail: {
      severity: Finding['severity'];
      service: string;
      title: string;
      description: string;
      evidence: Record<string, unknown>;
      dedupSuffix: string;
    },
  ): Finding {
    return {
      kind: this.name,
      severity: detail.severity,
      title: detail.title,
      description: detail.description,
      dedupKey: `plaintext_credentials|${detail.dedupSuffix}|${context.target}:${context.port}`,
      sourceIp: context.source,
      sourceMac: context.packet.ethernet?.sourceAddress ?? null,
      targetIp: context.target,
      targetMac: context.packet.ethernet?.destinationAddress ?? null,
      protocol: 'TCP',
      evidence: { service: detail.service, port: context.port, ...detail.evidence },
      timestamp: context.packet.timestamp,
    };
  }

  reset(): void {
    // Stateless: each packet is judged on its own contents.
  }
}

interface Context {
  packet: DecodedPacket;
  source: string | null;
  target: string | null;
  port: number;
}

function startsWith(buffer: Buffer, prefix: string): boolean {
  if (buffer.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (buffer[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function safeBase64(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('latin1');
  } catch {
    return '';
  }
}

/** Strips control characters and caps length before a value is stored or shown. */
function sanitize(value: string): string {
  let out = '';
  for (const char of value.slice(0, 128)) {
    const code = char.codePointAt(0) ?? 0;
    // Drop C0 control characters and DEL: not printable, and they corrupt
    // logs and terminal output when echoed back.
    if (code >= 0x20 && code !== 0x7f) out += char;
  }
  return out;
}

function firstLine(text: string): string {
  return sanitize(text.split(/\r?\n/, 1)[0] ?? '').slice(0, 200);
}

function firstHeader(text: string, header: string): string | null {
  const match = new RegExp(`^${header}:[ \\t]*(.+)$`, 'im').exec(text);
  return match?.[1] ? sanitize(match[1].trim()) : null;
}

/** Best-effort username alongside a password field, for context in the alert. */
function extractFormUsername(text: string): string | null {
  const match = /(?:^|[&?\s])(?:username|user|email|login|uid)=([^&\s"']{1,128})/i.exec(text);
  return match?.[1] ? sanitize(decodeURIComponent(match[1].replace(/\+/g, ' '))) : null;
}
