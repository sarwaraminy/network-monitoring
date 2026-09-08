/**
 * The wrapper an outbound notification is written in, in English.
 *
 * A third catalogue rather than more keys in the error one, for the reason
 * `errors.ts` gives about the first two: these have a different reader and a
 * different lifetime. An error is rendered once in a browser that knows the
 * operator's language; this text goes into an email or a chat message, and the
 * language it is written in is an installation setting — see `OUTBOUND_LOCALE`.
 *
 * **What this catalogue is for.** `toNotifiable` already renders the finding
 * itself through the locale it is handed, so the seam looked finished. It was
 * not: everything *around* the finding — the subject line, the field labels
 * under it, the "and N more" line, the button — was hardcoded here in English.
 * Pointing `OUTBOUND_LOCALE` at German would have produced a German finding
 * inside an English subject, with English labels and an English button. These
 * are the strings that close that gap.
 *
 * Deliberately not covering syslog or CEF. Those are machine formats read by a
 * collector, and their vocabulary is defined by the protocol rather than chosen
 * here; `notify/types.ts` says the same where it excludes them.
 *
 * Identifiers interpolate as strings, counts as numbers — the convention
 * `message.ts` sets out, and the reason the plural forms below take `{count}`.
 */
export const NOTIFY_EN = {
  'notify.subject_one': '{prefix}[{severity}] {title}',
  'notify.subject_many': '{prefix}{count} network findings — {breakdown}',
  'notify.subject_fallback': 'Network finding',
  'notify.severity_count': '{count} {severity}',
  'notify.test_banner_text': 'This is a test notification from Network Monitoring. No findings are involved.',
  'notify.test_banner_html': 'This is a test notification. No findings are involved.',
  'notify.meta_sensor': 'sensor {sensor}',
  'notify.meta_source': 'source {source}',
  'notify.meta_target': 'target {target}',
  'notify.meta_occurrences': '{count, plural, one {# occurrence} other {# occurrences}}',
  'notify.meta_last_seen': 'last seen {at} UTC',
  'notify.evidence_prefix': 'evidence: {evidence}',
  'notify.and_more_text': '…and {count} more. Open the dashboard for the full list.',
  'notify.and_more': '…and {count} more.',
  'notify.open_dashboard': 'Open the dashboard',
  'notify.open_dashboard_short': 'Open dashboard',
} as const;

export type NotifyMessageKey = keyof typeof NOTIFY_EN;

/** A locale other than English. Partial for the reason findings.ts gives. */
export type PartialNotifyCatalog = Readonly<Partial<Record<NotifyMessageKey, string>>>;
