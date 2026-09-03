import { desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type AuditEventRow, auditEvents, type UserRow } from '../db/schema.js';

/**
 * The audit trail: who did what, and when.
 *
 * This application already recorded identity in three places — who acknowledged a
 * finding, who wrote a suppression rule, who last changed the delivery settings —
 * each with its own copy of the same helper, one of them commented "Same form the
 * alert acknowledgement uses". What none of them covered was any action that
 * *removes* something: deleting a finding, clearing the table, forgetting a device,
 * deleting the rule that had been hiding findings. Those recorded nobody, and the
 * information was unrecoverable afterwards, because the row was gone and nothing
 * else knew it had ever existed.
 *
 * Three decisions shape everything below.
 *
 * **The audit row and the action share a transaction.** `recordAudit` takes the
 * writer it should use, so a caller inside `db.transaction` passes the `tx` and the
 * deletion and its record commit together or not at all. This is the same argument
 * the retention sweep makes about rolling up and deleting: doing the work and
 * recording the work are one thing, and every way of splitting them is wrong in one
 * direction or the other — record first and you can log a deletion that never
 * happened, record after and you can delete without a trace. Sharing a transaction
 * also disposes of the usual "should a failed audit write fail the action?" debate,
 * which has no good answer.
 *
 * **Identity is resolved in exactly one place.** `actorName` is the only copy now,
 * and the three routers call it. A second form of the same string would eventually
 * mean two spellings of one person in the trail.
 *
 * **The vocabulary is closed.** `AUDIT_ACTIONS` is the list, the type is derived
 * from it, and the database enforces the `domain.verb` shape independently. An audit
 * trail whose `action` column is free text cannot be filtered or counted a year
 * later, which is when someone first needs to.
 */

/**
 * Every action the trail records, with what to show a reader.
 *
 * Adding an entry here is the deliberate act; the type below makes an unlisted
 * action a compile error rather than a row nobody can interpret.
 */
export const AUDIT_ACTIONS = {
  'alert.delete': 'Deleted a finding',
  'alerts.clear': 'Cleared every finding',
  'device.forget': 'Forgot a device',
  'suppression.create': 'Created a suppression rule',
  'suppression.update': 'Changed a suppression rule',
  'suppression.delete': 'Deleted a suppression rule',
  'delivery_settings.update': 'Changed where findings are delivered',
  'log.create': 'Added a legacy packet-log record',
  'log.update': 'Changed a legacy packet-log record',
  'log.delete': 'Deleted a legacy packet-log record',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface AuditEvent {
  /** From `actorName`. */
  actor: string;
  actorId?: number | null;
  action: AuditAction;
  /** The thing acted on — an id, a MAC — where the action has a single subject. */
  subject?: string | null;
  /**
   * What changed, as a plain object.
   *
   * For a deletion this is the last description of what was removed, so it is worth
   * carrying more than an id: the audit row is the only residue of the finding.
   * Never a credential. The delivery-settings entry records which fields changed and
   * not their values, because a trail that becomes a place to read the SMTP password
   * has made the system less safe rather than more accountable.
   */
  detail?: Record<string, unknown>;
}

/**
 * Anything that can insert — `db` itself, or a transaction handle.
 *
 * Deliberately the narrowest thing that works, so a caller cannot reach for
 * unrelated database access through the parameter this exists to thread.
 */
export type AuditWriter = Pick<typeof db, 'insert'>;

/**
 * The identity to record, in the one form every column and the trail agree on.
 *
 * The email, because that is what an operator recognises and what survives being
 * read a year later. `user:<id>` only where there is no email to use — a state that
 * should be unreachable behind `requireAuth`, which is exactly why it is spelled
 * rather than left to produce `undefined` in a column that must never be blank.
 *
 * A blank email counts as no email, matching how `env.ts` and the delivery-settings
 * resolver treat a blank value everywhere else in this codebase. The first version
 * used `??`, which only falls back on null — so an account with an empty email
 * produced `''`, and `actor` is NOT NULL with a non-blank CHECK. Because the audit
 * insert shares the caller's transaction, that constraint violation would not have
 * shown up as a bad audit row: it would have aborted the deletion, and reported a
 * database constraint to somebody trying to delete a finding.
 */
export function actorName(user: UserRow | undefined): string {
  const email = user?.email?.trim();
  return email && email !== '' ? email : `user:${user?.id ?? 'unknown'}`;
}

/**
 * Appends one event. Pass the surrounding `tx` when there is one.
 *
 * Not error-swallowing, unlike the retention sweep and the notifier: those are
 * housekeeping, and this is the record. A caller inside a transaction *wants* the
 * failure to propagate, because the alternative is a deletion that committed with
 * nothing recording it.
 */
export async function recordAudit(writer: AuditWriter, event: AuditEvent): Promise<void> {
  await writer.insert(auditEvents).values({
    actor: event.actor,
    actorId: event.actorId ?? null,
    action: event.action,
    subject: event.subject ?? null,
    detail: event.detail ?? {},
  });
}

export interface AuditPage {
  events: AuditEventRow[];
  /** The `at` of the oldest row returned, to page from. Absent when the page is the last. */
  nextBefore?: string;
}

/**
 * Most recent first, optionally filtered by action and paged by timestamp.
 *
 * Keyset paging on `at` rather than OFFSET: the trail only ever grows at the head,
 * so an offset walks further and further through rows it has already returned, and
 * a row appended mid-read shifts the window under the reader.
 */
export async function listAuditEvents(options: {
  limit: number;
  action?: AuditAction;
  before?: Date;
}): Promise<AuditPage> {
  const conditions = [
    ...(options.action ? [eq(auditEvents.action, options.action)] : []),
    ...(options.before ? [lt(auditEvents.at, options.before)] : []),
  ];

  const rows = await db
    .select()
    .from(auditEvents)
    .where(conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(options.limit + 1);

  // One more than asked for, so "is there another page" is answered without a
  // second count query against a table that only grows.
  const events = rows.slice(0, options.limit);
  const oldest = events.at(-1);

  return {
    events,
    ...(rows.length > options.limit && oldest ? { nextBefore: oldest.at.toISOString() } : {}),
  };
}
