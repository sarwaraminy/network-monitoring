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
 * Every action the trail can record from now on, with what to show a reader.
 *
 * Adding an entry here is the deliberate act; `AuditAction` below makes an
 * unlisted action a compile error rather than a row nobody can interpret.
 */
export const AUDIT_ACTIONS = {
  'alert.delete': 'Deleted a finding',
  'alert.unacknowledge': 'Reopened a finding, clearing who had acknowledged it',
  'alerts.clear': 'Cleared every finding',
  'device.forget': 'Forgot a device',
  'sensor.decommission': 'Decommissioned a sensor, deleting everything recorded under its name',
  'suppression.create': 'Created a suppression rule',
  'suppression.update': 'Changed a suppression rule',
  'suppression.delete': 'Deleted a suppression rule',
  'delivery_settings.update': 'Changed where findings are delivered',
  // `detail` carries the values, not just the field names, because none of them
  // is a credential and *which* port and *which* allowlist is the whole content
  // of the event. The exporter list is this collector's only access control.
  'flow_settings.update': 'Changed the flow collector settings',
  // `detail` carries the interface, the scope and the filter. Which interface is
  // the content of the event: "started a capture" without saying where reads as
  // an administrative act with no object, and the two scopes one process runs are
  // separate captures that start and stop independently.
  'capture.start': 'Started capturing traffic from an interface',
  'capture.stop': 'Stopped capturing traffic',
  // The query text goes in `detail`, which is the one place this trail records a
  // value rather than the fact of a change: here the query IS the action, and
  // "ran a query" without saying which one records nothing. The console's role
  // cannot read a secret, so the text cannot contain one.
  'adhoc.query': 'Ran an ad hoc SQL query',
  'adhoc.recheck': 'Re-checked whether the query console can start',
  'adhoc_settings.update': 'Changed the query console settings',
  // `detail` carries the old and new role. Which way a role moved is the whole
  // content of the event, and "changed a role" without it records nothing.
  'user.role_change': "Changed an account's role",
} as const;

/**
 * Actions no code can write any more, whose rows are still in the table.
 *
 * The trail is append-only — V9 revokes UPDATE, DELETE and TRUNCATE on it — so
 * retiring the endpoint that wrote an action does not retire the rows it wrote.
 * Deleting the entry outright would have taken the label off those rows and, worse,
 * dropped the value from the `action` filter's enum, so `?action=log.delete` would
 * answer 400 and the only way to read a historical entry would be to page past
 * everything newer. That is the failure V9's docblock describes in advance: an
 * action column that cannot be filtered or counted a year later, which is when
 * somebody first needs to.
 *
 * So they label and filter, and they are not part of `AuditAction`: a new
 * `recordAudit` call naming one is a compile error.
 *
 * `log.*` are the three legacy packet-log writes, removed rather than guarded —
 * see logs.routes.ts.
 */
export const RETIRED_AUDIT_ACTIONS = {
  'log.create': 'Added a legacy packet-log record (endpoint since removed)',
  'log.update': 'Changed a legacy packet-log record (endpoint since removed)',
  'log.delete': 'Deleted a legacy packet-log record (endpoint since removed)',
} as const;

/** What `recordAudit` will accept — the writable vocabulary only. */
export type AuditAction = keyof typeof AUDIT_ACTIONS;

/**
 * Every action with a label, writable or retired.
 *
 * What `GET /api/audit/actions` serves and what the `action` filter validates
 * against, which are the two places that answer questions about rows that already
 * exist rather than about rows still to be written.
 */
export const AUDIT_ACTION_LABELS = { ...AUDIT_ACTIONS, ...RETIRED_AUDIT_ACTIONS } as const;

/** Anything the trail may hold, and so anything the filter may be asked for. */
export type AuditActionFilter = keyof typeof AUDIT_ACTION_LABELS;
