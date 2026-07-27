import { desc, eq } from 'drizzle-orm';
import { DETAILS_MAX_LENGTH } from '../constants.js';
import { db } from '../db/index.js';
import { type LogRow, logs, type NewLogRow } from '../db/schema.js';

/** Replaces cyber.wissen.service.LogService + repo.LogRepository. */

export async function getAllLogs(): Promise<LogRow[]> {
  return db.select().from(logs).orderBy(desc(logs.id));
}

export async function getLogById(id: number): Promise<LogRow | null> {
  const rows = await db.select().from(logs).where(eq(logs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createLog(input: NewLogRow): Promise<LogRow> {
  const [created] = await db.insert(logs).values(normalize(input)).returning();
  if (!created) throw new Error('Insert into logs returned no row');
  return created;
}

export async function updateLog(id: number, input: NewLogRow): Promise<LogRow | null> {
  const { id: _ignored, ...values } = normalize(input);
  const [updated] = await db.update(logs).set(values).where(eq(logs.id, id)).returning();
  return updated ?? null;
}

export async function deleteLog(id: number): Promise<void> {
  await db.delete(logs).where(eq(logs.id, id));
}

function normalize(input: NewLogRow): NewLogRow {
  return {
    ...input,
    details: input.details.slice(0, DETAILS_MAX_LENGTH),
    timestamp: input.timestamp ?? new Date(),
  };
}
