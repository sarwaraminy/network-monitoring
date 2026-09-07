/**
 * The audit action vocabulary, kept out of `audit.service.ts` on purpose.
 *
 * `audit.service.ts` imports `db` from `db/index.js`, which constructs the
 * connection pool at module load. A module that only needs the *names* of the
 * actions — `validation.ts`, building the `action` filter's enum — would import
 * that pool along with them if this lived there, the same latent coupling
 * `ALERT_KINDS` and `SEVERITIES` already avoid by living in the types-only
 * `packet/detect/types.ts` rather than a service. `audit.service.ts` re-exports
 * both names from here, so nothing importing them from there has to change.
 */

/**
 * Every action the trail records, with what to show a reader.
 *
 * Adding an entry here is the deliberate act; the type below makes an unlisted
 * action a compile error rather than a row nobody can interpret.
 */
export const AUDIT_ACTIONS = {
  'alert.delete': 'Deleted a finding',
  'alert.unacknowledge': 'Reopened a finding, clearing who had acknowledged it',
  'alerts.clear': 'Cleared every finding',
  'device.forget': 'Forgot a device',
  'suppression.create': 'Created a suppression rule',
  'suppression.update': 'Changed a suppression rule',
  'suppression.delete': 'Deleted a suppression rule',
  'delivery_settings.update': 'Changed where findings are delivered',
  'log.create': 'Added a legacy packet-log record',
  'log.update': 'Changed a legacy packet-log record',
  'log.delete': 'Deleted a legacy packet-log record',
  // The query text goes in `detail`, which is the one place this trail records a
  // value rather than the fact of a change: here the query IS the action, and
  // "ran a query" without saying which one records nothing. The console's role
  // cannot read a secret, so the text cannot contain one.
  'adhoc.query': 'Ran an ad hoc SQL query',
  'adhoc.recheck': 'Re-checked whether the query console can start',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
