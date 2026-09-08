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
    // `A-Z` only: the `i` flag is on for the header name, so the class already
    // matches lowercase. Spelling `A-Za-z` as well claimed a case sensitivity
    // the flag had already removed, and made one class look like two.
    const basic = /^authorization:[ \t]*basic[ \t]+([A-Z0-9+/=]+)/im.exec(text);
    if (basic?.[1]) {
      const decoded = safeBase64(basic[1]);
      const separator = decoded.indexOf(':');
      const username = separator === -1 ? decoded : decoded.slice(0, separator);
      const secretLength = separator === -1 ? 0 : decoded.length - separator - 1;

      findings.push(
        this.finding(context, {
          severity: 'critical',
          service: 'HTTP Basic authentication',
          messageKey: 'plaintext_credentials.http_basic',
          messageParams: {
            username: sanitize(username),
            target: context.target,
            port: String(context.port),
          },
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
          messageKey: 'plaintext_credentials.http_form',
          messageParams: {
            target: context.target,
            port: String(context.port),
            fieldName: formField[1] ?? 'password',
          },
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
          messageKey: 'plaintext_credentials.http_cookie',
          messageParams: { target: context.target },
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
        messageKey: 'plaintext_credentials.ftp',
        messageParams: {
          target: context.target,
          username: user?.[1] ? sanitize(user[1]) : null,
          hasUsername: Boolean(user?.[1]),
          hasPassword: Boolean(pass),
        },
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
        messageKey: 'plaintext_credentials.telnet',
        messageParams: { target: context.target },
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
        messageKey: 'plaintext_credentials.mailbox',
        messageParams: {
          target: context.target,
          protocol,
          port: String(context.port),
          securePort: context.port === 110 ? '995' : '993',
          username: username ? sanitize(username) : null,
          hasUsername: Boolean(username),
        },
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
    const authPlain = /^AUTH[ \t]+PLAIN[ \t]+([A-Z0-9+/=]+)/im.exec(text);
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
        messageKey: 'plaintext_credentials.smtp',
        messageParams: {
          target: context.target,
          username: username ? sanitize(username) : null,
          hasUsername: Boolean(username),
        },
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
      messageKey: Finding['messageKey'];
      messageParams: Finding['messageParams'];
      evidence: Record<string, unknown>;
      dedupSuffix: string;
    },
  ): Finding {
    return {
      kind: this.name,
      severity: detail.severity,
      messageKey: detail.messageKey,
      messageParams: detail.messageParams,
      dedupKey: `plaintext_credentials|${detail.dedupSuffix}|${context.target}:${context.port}`,
      sourceIp: context.source,
      sourceMac: context.packet.ethernet?.sourceAddress ?? null,
      targetIp: context.target,
      targetMac: context.packet.ethernet?.destinationAddress ?? null,
      protocol: 'TCP',
      // Every finding from this detector is about one service on one port, so a
      // suppression rule may name it.
      port: context.port,
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
    // `charCodeAt`, not `codePointAt`. This compares against `buffer[i]`, a byte
    // in 0-255, and a UTF-16 code unit is the right unit for that. `codePointAt`
    // returns a full code point above 0xFFFF for a surrogate pair and is typed
    // `number | undefined` — identical for the ASCII prefixes passed here, but it
    // would make this look like it handles astral characters when the comparison
    // it performs cannot.
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

/**
 * The request line, with its query string removed.
 *
 * SECURITY: this reaches `alerts.evidence`, the UI evidence panel and — because
 * NOTIFY_INCLUDE_EVIDENCE is on by default — a third-party chat webhook. A form
 * login sent as GET puts the password in the query string, so storing the line
 * verbatim recorded the secret in all three places and broke this module's one
 * promise: username and length, never the value.
 *
 * The suite missed it because the credential test posts a body. `?` and `&` are
 * field separators for the form regex above, so the GET case was always in
 * scope for detection — just not for redaction.
 */
function firstLine(text: string): string {
  const line = sanitize(text.split(/\r?\n/, 1)[0] ?? '');
  const query = line.indexOf('?');
  if (query === -1) return line.slice(0, 200);

  // Keep the method and path; drop everything from `?` to the HTTP version.
  //
  // `tail` guards the case a capture ring actually produces: a truncated request
  // line with no space after the query string. `indexOf` returns -1 there, and
  // `slice(-1)` appends the LAST character rather than nothing — evidence read
  // `GET /login?<redacted>t`. Not a leak either way, but wrong in the branch
  // truncation makes common.
  const versionAt = line.indexOf(' ', query);
  const tail = versionAt === -1 ? '' : line.slice(versionAt);
  return `${line.slice(0, query)}?<redacted>${tail}`.slice(0, 200);
}

function firstHeader(text: string, header: string): string | null {
  const match = new RegExp(String.raw`^${header}:[ \t]*(.+)$`, 'im').exec(text);
  return match?.[1] ? sanitize(match[1].trim()) : null;
}

/** Best-effort username alongside a password field, for context in the alert. */
function extractFormUsername(text: string): string | null {
  const match = /(?:^|[&?\s])(?:username|user|email|login|uid)=([^&\s"']{1,128})/i.exec(text);
  return match?.[1] ? sanitize(decodeURIComponent(match[1].replaceAll('+', ' '))) : null;
}
