import { desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type LogRow, logs } from '../db/schema.js';

/**
 * Replaces cyber.wissen.service.LogService + repo.LogRepository.
 *
 * Read-only, and the only thing left of it. `logs` is the pre-`alerts` record of
 * what was observed on the network, kept so existing history stays readable;
 * nothing in this application has written to it since the detectors started
 * writing `alerts`, and the three write endpoints that reached the functions that
 * used to live here have been removed rather than guarded. See logs.routes.ts.
 */

export async function getAllLogs(): Promise<LogRow[]> {
  return db.select().from(logs).orderBy(desc(logs.id));
}
