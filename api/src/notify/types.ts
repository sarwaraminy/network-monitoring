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
  kind: string;
  severity: Severity;
  title: string;
  description: string;
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
}

export interface DeliveryResult {
  channel: string;
  ok: boolean;
  detail: string;
}

/** Converts a stored finding plus its occurrence count into notifiable form. */
export function toNotifiable(
  finding: Finding,
  occurrences: number,
  firstSeen: Date,
  lastSeen: Date,
  includeEvidence: boolean,
): NotifiableFinding {
  return {
    kind: finding.kind,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    sourceIp: finding.sourceIp ?? null,
    targetIp: finding.targetIp ?? null,
    occurrences,
    firstSeen,
    lastSeen,
    evidence: includeEvidence ? finding.evidence : null,
  };
}

/** Lower index is more urgent, matching SEVERITY_RANK. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** True when `severity` is at least as urgent as `threshold`. */
export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold);
}

/** Accent colours for chat cards, matching the UI's severity ramp. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#b91c1c',
  high: '#c2410c',
  medium: '#a16207',
  low: '#0f766e',
  info: '#475569',
};
