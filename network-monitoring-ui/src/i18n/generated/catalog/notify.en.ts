// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
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
  'notify.subject_many': '{prefix}{count, number} network findings — {breakdown}',
  'notify.subject_fallback': 'Network finding',
  'notify.severity_count': '{count, number} {severity}',

  /*
   * The first line of every outbound message, and the last of it still written
   * in English.
   *
   * `summaryLine()` built this by hand — "Network Monitoring raised 3 findings:
   * 2 high, 1 critical." — and it is the most prominent text in all three places
   * it appears: the opening line of the plain-text body, the bold header section
   * of a Slack message, and the headline TextBlock of a Teams card. Pointing
   * OUTBOUND_LOCALE at German produced a German subject, a German finding,
   * German labels and a German button, with this sitting in bold above all of
   * it.
   */
  'notify.summary_one': 'Network Monitoring raised 1 {severity} finding.',
  'notify.summary_many': 'Network Monitoring raised {count, number} findings: {breakdown}.',

  /*
   * The severity words, so the counts above and `notify.severity_count` stop
   * interpolating the raw key. `SEVERITY_STYLE[…].labelKey` is the equivalent on
   * the interface side; this is the outbound half, which did not exist — so even
   * a translated subject line embedded `high` and `critical` in English.
   */
  'notify.severity.critical': 'critical',
  'notify.severity.high': 'high',
  'notify.severity.medium': 'medium',
  'notify.severity.low': 'low',
  'notify.severity.info': 'info',

  /*
   * Bare labels, beside the phrase keys below.
   *
   * The structured payloads — the Teams Adaptive Card, the retired connector,
   * Discord — label a fact rather than write a line, so `sensor {sensor}` is the
   * wrong shape for them and they went on using English literals when the text
   * renderers were converted. The comment above the Teams facts predicted
   * exactly this and then did it anyway; these are the words all six renderers
   * can share.
   */
  'notify.label_sensor': 'Sensor',
  'notify.label_source': 'Source',
  'notify.label_target': 'Target',
  'notify.label_occurrences': 'Occurrences',
  'notify.label_last_seen': 'Last seen',
  'notify.label_evidence': 'Evidence',
  'notify.test_banner_text': 'This is a test notification from Network Monitoring. No findings are involved.',
  'notify.test_banner_html': 'This is a test notification. No findings are involved.',
  'notify.meta_sensor': 'sensor {sensor}',
  'notify.meta_source': 'source {source}',
  'notify.meta_target': 'target {target}',
  'notify.meta_occurrences': '{count, plural, one {# occurrence} other {# occurrences}}',
  'notify.meta_last_seen': 'last seen {at} UTC',
  'notify.evidence_prefix': 'evidence: {evidence}',
  'notify.and_more_text': '…and {count, number} more. Open the dashboard for the full list.',
  'notify.and_more': '…and {count, number} more.',
  'notify.open_dashboard': 'Open the dashboard',
  'notify.open_dashboard_short': 'Open dashboard',
} as const;

export type NotifyMessageKey = keyof typeof NOTIFY_EN;

/** A locale other than English. Partial for the reason findings.ts gives. */
export type PartialNotifyCatalog = Readonly<Partial<Record<NotifyMessageKey, string>>>;
