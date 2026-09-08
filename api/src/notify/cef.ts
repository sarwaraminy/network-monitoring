import type { Severity } from '../packet/detect/types.js';
import type { NotifiableFinding } from './types.js';

/**
 * CEF and RFC 5424, for shipping findings to a SIEM.
 *
 * This is the format half; `syslog.ts` is the transport. They are separate
 * because the escaping rules below are the part that actually breaks
 * integrations, and they are worth testing without opening a socket.
 *
 * CEF is ArcSight's Common Event Format and is what Splunk, QRadar, Sentinel,
 * Graylog and every SIEM connector guide assumes when they say "send us syslog".
 * A JSON line is easier to produce and much harder for the person on the other
 * end to onboard, which is why CEF is the default here.
 */

/** Written into every CEF header. Fixed, so a SIEM can key rules on them. */
export const CEF_VERSION = 0;
export const CEF_VENDOR = 'NetworkMonitoring';
export const CEF_PRODUCT = 'NMT';

/**
 * CEF severity is 0-10; ours is five named levels.
 *
 * Mapped so `critical` lands at 10 and `info` at 1 rather than 0 — a 0 reads as
 * "unknown" to several SIEMs and gets filtered out of default dashboards, which
 * is a poor fate for an event we chose to send.
 */
export const CEF_SEVERITY: Record<Severity, number> = {
  critical: 10,
  high: 8,
  medium: 5,
  low: 3,
  info: 1,
};

/**
 * Syslog severity per RFC 5424, for the PRI calculation.
 *
 * Deliberately not a 1:1 walk down the scale: our `info` is a real security
 * observation, so it maps to Notice (5) rather than Informational (6), keeping
 * it above the noise floor on collectors that drop `info` by default.
 */
export const SYSLOG_SEVERITY: Record<Severity, number> = {
  critical: 2, // Critical
  high: 3, // Error
  medium: 4, // Warning
  low: 5, // Notice
  info: 5, // Notice
};

/**
 * Escape the CEF header.
 *
 * `|` ends a header field and `\` escapes, so both must be escaped or the
 * receiver mis-splits the event. A finding title such as
 * `Port scan: 10.0.0.5 probed 22 ports` is safe, but titles are prose and one
 * pipe would silently shift every later field by one.
 *
 * Newlines go for the same reason they go from the extension: a syslog record is
 * one line, so a newline in a title splits one event into two on the wire, and
 * the second arrives at the SIEM as a record shaped by whatever produced the
 * text. Not reachable today — every title is a template around a normalised
 * address or domain — but this module exists because escaping is where these
 * integrations break, and structural beats depending on every future detector
 * keeping its titles clean.
 */
export function escapeHeader(value: string): string {
  // The backslash pair stays a plain literal: a String.raw template may not END
  // in a backslash, because it escapes the closing backtick.
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', String.raw`\|`)
    .replaceAll(/[\r\n]/g, ' ');
}

/**
 * Escape a CEF extension value.
 *
 * Different rules from the header, which is the usual source of mistakes: here
 * `=` must be escaped because it separates key from value, `|` must NOT be, and
 * a newline has to go because the extension is a single line by definition.
 */
export function escapeExtension(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('=', String.raw`\=`)
    .replaceAll('\r\n', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ');
}

/** The CEF limit for a custom string value. */
const CEF_STRING_MAX = 1023;

/** CEF wants milliseconds since the epoch, or a specific date format. Epoch is unambiguous. */
const asEpoch = (date: Date) => String(date.getTime());

/**
 * One evidence value as a CEF string.
 *
 * Objects and arrays go through JSON rather than `String()`, which would render
 * them `[object Object]` — the analyst would see a field name and learn nothing
 * from it, which is worse than the field being absent.
 *
 * 1023 is the CEF limit for a custom string.
 */
function stringifyEvidence(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object') return JSON.stringify(raw) ?? '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
    return String(raw);
  }
  // A symbol or a function has no CEF representation worth sending, and neither
  // belongs in evidence. Narrowed explicitly rather than left to String(unknown),
  // which cannot be read as safe at a glance.
  return '';
}

/**
 * Flatten evidence into CEF custom-string slots.
 *
 * CEF only defines six (`cs1`-`cs6`), each with a label, so evidence has to be
 * truncated rather than fully represented. The keys are sorted for stability —
 * a SIEM rule written against `cs3Label` should not start matching a different
 * field because a detector changed its property order.
 *
 * Evidence never contains a password or a payload; the detectors guarantee it
 * and the tests assert it. It does contain internal addresses and usernames,
 * which is why the caller decides whether to pass it at all.
 */
function evidenceExtensions(evidence: Record<string, unknown> | null): string[] {
  if (!evidence) return [];

  const parts: string[] = [];
  const keys = Object.keys(evidence)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 6);

  for (const [index, key] of keys.entries()) {
    const slot = index + 1;
    // Truncated AFTER escaping. Cutting first let a value dense in `=` or `\`
    // exceed the 1023-character limit once the escapes were added.
    const value = escapeExtension(stringifyEvidence(evidence[key])).slice(0, CEF_STRING_MAX);
    parts.push(`cs${slot}Label=${escapeExtension(key)}`, `cs${slot}=${value}`);
  }

  return parts;
}

/**
 * One finding as a CEF event.
 *
 * The header is `CEF:0|vendor|product|version|signatureId|name|severity|` and
 * everything after it is `key=value` pairs. `signatureId` is the detector kind,
 * which is what a SIEM rule keys on, so it must stay stable — renaming a
 * detector breaks every downstream rule written against it.
 */
export function renderCef(finding: NotifiableFinding, productVersion: string): string {
  const header = [
    `CEF:${CEF_VERSION}`,
    escapeHeader(CEF_VENDOR),
    escapeHeader(CEF_PRODUCT),
    escapeHeader(productVersion),
    escapeHeader(finding.kind),
    escapeHeader(finding.englishTitle),
    String(CEF_SEVERITY[finding.severity]),
  ].join('|');

  const extensions = [
    `rt=${asEpoch(finding.lastSeen)}`,
    `start=${asEpoch(finding.firstSeen)}`,
    `end=${asEpoch(finding.lastSeen)}`,
    `cnt=${finding.occurrences}`,
    `cat=${escapeExtension(finding.kind)}`,
    // The producing sensor. `dvchost` is the CEF-standard field for "the device
    // that observed this", which is exactly what a sensor is, so a SIEM maps it
    // without a custom rule. Sent unconditionally, unlike the human channels: a
    // correlation rule counting events per segment needs the field on every
    // event, including the ones from an installation that never named itself.
    `dvchost=${escapeExtension(finding.sensorId)}`,
    `msg=${escapeExtension(finding.englishDescription)}`,
  ];

  // `src`/`dst` are the CEF-standard address fields every SIEM already maps.
  if (finding.sourceIp) extensions.push(`src=${escapeExtension(finding.sourceIp)}`);
  if (finding.targetIp) extensions.push(`dst=${escapeExtension(finding.targetIp)}`);

  extensions.push(...evidenceExtensions(finding.evidence));

  return `${header}|${extensions.join(' ')}`;
}

/** One finding as a single JSON object, for collectors that prefer it to CEF. */
export function renderJsonLine(finding: NotifiableFinding, productVersion: string): string {
  return JSON.stringify({
    vendor: CEF_VENDOR,
    product: CEF_PRODUCT,
    version: productVersion,
    sensorId: finding.sensorId,
    kind: finding.kind,
    severity: finding.severity,
    title: finding.englishTitle,
    description: finding.englishDescription,
    sourceIp: finding.sourceIp,
    targetIp: finding.targetIp,
    occurrences: finding.occurrences,
    firstSeen: finding.firstSeen.toISOString(),
    lastSeen: finding.lastSeen.toISOString(),
    evidence: finding.evidence,
  });
}

export interface SyslogFrameOptions {
  facility: number;
  hostname: string;
  appName: string;
  /** RFC 5424 adds a version, ISO timestamp and structured-data slot; 3164 is the older BSD shape. */
  rfc: '5424' | '3164';
}

/** Two-digit padding, for the BSD timestamp that insists on it. */
const pad = (value: number) => String(value).padStart(2, '0');

const BSD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Wrap a message in a syslog frame.
 *
 * PRI is `facility * 8 + severity`, and getting it wrong is the single most
 * common reason a collector silently files everything under `user.notice`.
 *
 * RFC 3164 is offered because plenty of appliances still only parse that, and
 * its timestamp has no year and no timezone — a genuine deficiency, which is why
 * 5424 is the default.
 */
export function frameSyslog(
  message: string,
  severity: Severity,
  at: Date,
  options: SyslogFrameOptions,
): string {
  const priority = options.facility * 8 + SYSLOG_SEVERITY[severity];

  if (options.rfc === '3164') {
    const day = String(at.getDate()).padStart(2, ' ');
    const stamp = `${BSD_MONTHS[at.getMonth()]} ${day} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
    return `<${priority}>${stamp} ${options.hostname} ${options.appName}: ${message}`;
  }

  // VERSION=1, and `-` for the message id and structured data we do not use.
  return `<${priority}>1 ${at.toISOString()} ${options.hostname} ${options.appName} ${process.pid} - - ${message}`;
}
