import { desc, eq } from 'drizzle-orm';
import { DETAILS_MAX_LENGTH } from '../constants.js';
import { db } from '../db/index.js';
import { type LogRow, logs, type NewLogRow } from '../db/schema.js';
import { type Actor, recordAudit } from './audit.service.js';

/** Replaces cyber.wissen.service.LogService + repo.LogRepository. */

export async function getAllLogs(): Promise<LogRow[]> {
  return db.select().from(logs).orderBy(desc(logs.id));
}

export async function getLogById(id: number): Promise<LogRow | null> {
  const rows = await db.select().from(logs).where(eq(logs.id, id)).limit(1);
  return rows[0] ?? null;
}

/*
 * The three writes below are audited, and it is worth saying why for a table
 * nothing writes any more.
 *
 * `logs` is the pre-`alerts` record of what was observed on the network, kept so
 * existing history stays readable. Rows in it are evidence, and until recently any
 * authenticated account could add a fabricated one, rewrite one, or delete one.
 * They are ADMIN-only now — but "an administrator may do this" and "we know which
 * administrator did" are different guarantees, and an un-audited mutating route is
 * exactly the gap the trail exists to close.
 */

/** What identifies a record, for the trail. Not the whole row: `details` can be 2 KB. */
function logDetail(row: LogRow): Record<string, unknown> {
  return {
    sourceip: row.sourceip,
    destinationip: row.destinationip,
    protocol: row.protocol,
    timestamp: row.timestamp?.toISOString() ?? null,
  };
}

export async function createLog(input: NewLogRow, actor: Actor): Promise<LogRow> {
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(logs).values(normalize(input)).returning();
    if (!created) throw new Error('Insert into logs returned no row');

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'log.create',
      subject: String(created.id),
      detail: logDetail(created),
    });

    return created;
  });
}

export async function updateLog(id: number, input: NewLogRow, actor: Actor): Promise<LogRow | null> {
  const { id: _ignored, ...values } = normalize(input);

  return db.transaction(async (tx) => {
    // `FOR UPDATE` for the same reason as `updateSuppression`: under READ COMMITTED
    // an unlocked read lets two concurrent updates record the same `from`.
    const [before] = await tx.select().from(logs).where(eq(logs.id, id)).limit(1).for('update');
    if (!before) return null;

    const [updated] = await tx.update(logs).set(values).where(eq(logs.id, id)).returning();
    if (!updated) return null;

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'log.update',
      subject: String(id),
      detail: { from: logDetail(before), to: logDetail(updated) },
    });

    return updated;
  });
}

export async function deleteLog(id: number, actor: Actor): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(logs).where(eq(logs.id, id)).returning();
    if (!deleted) return false;

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'log.delete',
      subject: String(id),
      detail: logDetail(deleted),
    });

    return true;
  });
}

function normalize(input: NewLogRow): NewLogRow {
  return {
    ...input,
    details: input.details.slice(0, DETAILS_MAX_LENGTH),
    timestamp: input.timestamp ?? new Date(),
  };
}
