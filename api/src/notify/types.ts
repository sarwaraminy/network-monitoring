import { renderFinding } from '../i18n/catalog/findings.js';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales.js';
import type { Finding, Severity } from '../packet/detect/types.js';

/**
 * Notification delivery.
 *
 * Before this, NMT detected a critical finding and wrote it to a table someone had
 * to remember to look at. That is the difference between a monitoring tool and a
 * monitoring product: nobody watches a dashboard at 2am.
 *
 * Three design rules, each learned from how alerting systems actually fail:
 *
 *  1. **Digest, never one message per finding.** A port scan produces a burst. Send
 *     forty emails and the recipient mutes the sender, and then misses the one that
 *     mattered. Findings are batched into a window and summarised.
 *  2. **Notification must never affect detection.** A dead webhook or a wrong SMTP
 *     password cannot be allowed to stop alerts being stored or capture running.
 *     Everything here fails quietly into the log.
 *  3. **Sending is disclosure.** Alert details include internal addresses, hostnames
 *     and usernames. Pushing them to a third-party chat service moves that data
 *     outside the network being protected — which is why evidence can be switched
 *     off independently of notifications.
 */

/** One finding, as it appears in a notification. */
export interface NotifiableFinding {
  /**
   * Which sensor observed this.
   *
   * Carried on every notification because the alert table gained it and a paged
   * administrator did not: with two sensors on one database and one shared
   * `delivery_settings` row, "New device aa:bb:cc:dd:ee:ff" named no segment at
   * all, while the table five feet away could.
   */
  sensorId: string;
  kind: string;
  severity: Severity;
  /**
   * Rendered in the installation's outbound language — see `OUTBOUND_LOCALE`.
   *
   * The human channels read these. The machine ones must not: see `messageKey`.
   */
  title: string;
  description: string;
  /**
   * The same two sentences in English, whatever the human channels are set to.
   *
   * A SIEM parses the syslog and CEF feeds and correlates on them, and a localised
   * event name breaks every rule written against it — the same argument that pins
   * `signatureId` to the detector kind, one field over. So "outbound is one
   * configured language" and "the machine feed is English" are two different
   * questions, and these are the fields that let them have two different answers.
   *
   * Rendered here rather than in the channel so the channels stay pure formatters
   * with nothing to look up: `cef.ts` is the format half of the export and its
   * escaping is the part worth testing on its own.
   */
  englishTitle: string;
  englishDescription: string;
  sourceIp: string | null;
  targetIp: string | null;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  /** Omitted entirely when NOTIFY_INCLUDE_EVIDENCE is off. */
  evidence: Record<string, unknown> | null;
}

/** A batch ready to send. */
export interface Notification {
  /** Highest severity in the batch — drives subject line and colour. */
  severity: Severity;
  findings: NotifiableFinding[];
  /** How many findings were dropped from the batch to keep the message readable. */
  omittedCount: number;
  countsBySeverity: Partial<Record<Severity, number>>;
  generatedAt: Date;
  /** Set when a dashboard URL is configured, so the message can link to it. */
  dashboardUrl: string | null;
  /** True for a deliberate test send, so recipients are not alarmed. */
  isTest: boolean;
  /**
   * True when this database has more than one sensor, so a human-facing message
   * should say which one saw the finding.
   *
   * On the notification rather than derived per finding, because it is a property
   * of the installation and not of the finding — and carrying it here keeps the
   * renderers pure functions of what they are handed. See notify/sensor-scope.ts.
   */
  namesSensors: boolean;
}

/** A delivery mechanism. Implementations must not throw. */
export interface NotificationChannel {
  readonly name: string;
  /**
   * True for a channel that must receive every finding, ungated.
   *
   * The severity threshold, throttle, hourly ceiling and digest all exist to
   * protect a human inbox. A machine consumer — a SIEM — needs the complete
   * stream instead: it correlates and deduplicates itself, and a gap makes every
   * rule that counts events over a window under-report. See notify/syslog.ts.
   */
  readonly deliversEveryFinding?: boolean;
  /** True when configured well enough to attempt a send. */
  isConfigured(): boolean;
  /** Resolves to a short description of what happened, for logging. */
  send(notification: Notification): Promise<DeliveryResult>;
  /**
   * Releases anything held between sends. Optional, because most channels hold
   * nothing — the syslog channel opens a socket per send and closes it, and the
   * webhook channel is a bare `fetch`. `EmailChannel` pools SMTP connections, so
   * replacing a notifier without calling this leaks a pool per settings change.
   */
  close?(): void;
}

export interface DeliveryResult {
  channel: string;
  ok: boolean;
  detail: string;
}

/**
 * The language outbound notifications are written in.
 *
 * An installation setting rather than a per-user one, and there is nowhere else
 * for it to come from: an alert email goes to a team address and a webhook has no
 * account at all, so there is no `lang_code` to read. English for now, which is
 * what every existing installation already receives — the seam is here so that
 * making it configurable alongside the other delivery settings is a change to one
 * value rather than to every channel.
 *
 * Does not reach syslog or CEF, which are English whatever this says.
 */
export const OUTBOUND_LOCALE: Locale = DEFAULT_LOCALE;

/** Converts a stored finding plus its occurrence count into notifiable form. */
export function toNotifiable(
  finding: Finding,
  occurrences: number,
  firstSeen: Date,
  lastSeen: Date,
  includeEvidence: boolean,
  sensorId: string,
  locale: Locale = OUTBOUND_LOCALE,
): NotifiableFinding {
  const text = renderFinding(finding.messageKey, finding.messageParams, locale);
  // Rendered twice only when the two differ, which today they never do.
  const english =
    locale === DEFAULT_LOCALE
      ? text
      : renderFinding(finding.messageKey, finding.messageParams, DEFAULT_LOCALE);
  return {
    sensorId,
    kind: finding.kind,
    severity: finding.severity,
    title: text.title,
    description: text.description,
    englishTitle: english.title,
    englishDescription: english.description,
    sourceIp: finding.sourceIp ?? null,
    targetIp: finding.targetIp ?? null,
    occurrences,
    firstSeen,
    lastSeen,
    evidence: includeEvidence ? finding.evidence : null,
  };
}

/**
 * The sensor's name when it is worth showing a person, else null.
 *
 * "Worth showing" means *this installation has more than one sensor*, which the
 * notification carries as `namesSensors` — see notify/sensor-scope.ts for where
 * that comes from and why it is not inferred from the name.
 *
 * It used to be inferred from the name: any `sensorId` other than the literal
 * `default` got a line, on the theory that naming a sensor is what an operator
 * does when they have two. But `SENSOR_ID=default` is what ships, and V16
 * backfills to it, so the busiest sensor of a real multi-sensor install is
 * usually the one called `default` — and it was the one whose messages carried no
 * sensor line. The rule now matches the one the interface uses for the same
 * decision, so a reader is never left inferring a segment from an absence.
 *
 * The SIEM renderers deliberately do NOT use this: a collector wants the field
 * present on every event so a correlation rule can pin the producer, and it does
 * its own filtering. Human channels are the ones that pay for noise.
 */
export function sensorLabel(notification: Notification, finding: NotifiableFinding): string | null {
  return notification.namesSensors ? finding.sensorId : null;
}

/** Lower index is more urgent, matching SEVERITY_RANK. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** True when `severity` is at least as urgent as `threshold`. */
export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold);
}

/** Accent colours for chat cards, matching the UI's severity ramp. */
/**
 * Webhook payload shapes.
 *
 * Declared here rather than in webhook.ts because env.ts validates
 * `NOTIFY_WEBHOOK_FORMAT` against the same set, and the two had drifted into
 * separate literals — the config-drift pattern this repo has been bitten by three
 * times already. One list now, imported by both, so adding a format cannot be
 * half-done.
 *
 * `teams` is the *current* Teams format: a Power Automate Workflows webhook, which
 * expects an Adaptive Card. `teams-connector` is the retired Office 365 connector
 * MessageCard, kept reachable for an installation still running a live connector and
 * named so that choosing it has to be deliberate. See notify/format.ts.
 */
export const WEBHOOK_FORMATS = ['auto', 'slack', 'teams', 'teams-connector', 'discord', 'generic'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#b91c1c',
  high: '#c2410c',
  medium: '#a16207',
  low: '#0f766e',
  info: '#475569',
};
