import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { alertSuppressions, type SuppressionRow } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { NO_SUPPRESSIONS, SuppressionSet } from './suppression-rules.js';

const log = componentLogger('suppression');

/**
 * Storage, caching and match accounting for suppression rules.
 *
 * The matching itself is in suppression-rules.ts, which has no database import so
 * its semantics can be tested exhaustively. This module is the part that has to
 * deal with the awkward shape of the problem: rules live in Postgres and are
 * edited by people, but they are consulted from `AlertSink.record`, which is
 * synchronous and runs once per finding — thousands of times during a burst.
 * Awaiting a query there is not an option, so a compiled set is held in memory
 * and refreshed.
 *
 * Two consequences worth being explicit about:
 *
 *  - Until the first load succeeds the set is empty, and a failed reload leaves
 *    the previous set in place. Both directions fail OPEN: findings get through.
 *    The opposite choice — treating an unreadable rule table as "suppress" — would
 *    turn a database blip into a monitoring outage that looks like a quiet night.
 *  - A rule edited through the API takes effect immediately, because every
 *    mutation reloads before it answers. The interval below only matters when
 *    something else changed the table: a second process, or somebody with psql.
 */

/** How stale the cached set may get before a read triggers a background reload. */
const REFRESH_INTERVAL_MS = 30_000;

let current: SuppressionSet = NO_SUPPRESSIONS;
let loadedAt = 0;
/** In-flight reload, so a burst of findings cannot start twenty of them. */
let loading: Promise<SuppressionSet> | null = null;

/**
 * The rules in force, for the hot path. Never throws, never blocks.
 *
 * A stale set is served while a reload runs in the background. That is deliberate:
 * the alternative is either blocking detection on a query or dropping findings on
 * the floor while one is outstanding, and a rule taking a few seconds longer to
 * apply is a much smaller problem than either.
 */
export function suppressions(): SuppressionSet {
  if (Date.now() - loadedAt > REFRESH_INTERVAL_MS && !loading) {
    // Fire and forget: refreshSuppressions logs its own failures and leaves the
    // current set alone, so there is nothing here to handle.
    void refreshSuppressions();
  }
  return current;
}

/** Reloads and recompiles. Resolves to the set now in force, even on failure. */
export async function refreshSuppressions(): Promise<SuppressionSet> {
  if (loading) return loading;

  loading = (async () => {
    try {
      const rows = await loadRules();
      const set = new SuppressionSet(rows);

      if (set.malformed.length > 0) {
        // Loud, because such a rule silently does nothing: its author believes
        // findings are being suppressed and they are not.
        log.warn({ ids: set.malformed }, 'Suppression rules ignored: the stored range could not be parsed');
      }

      current = set;
      loadedAt = Date.now();
      log.debug({ rules: set.size }, 'Suppression rules loaded');
      return set;
    } catch (error) {
      // Keep serving the last good set, and keep `loadedAt` where it is so the
      // next read tries again rather than backing off.
      log.error({ err: error }, 'Could not load suppression rules; keeping the previous set');
      return current;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** For tests and for a clean shutdown: drops the cache without touching the table. */
export function resetSuppressionCache(): void {
  current = NO_SUPPRESSIONS;
  loadedAt = 0;
}

export interface SuppressionCacheStatus {
  /** Rules compiled and in force. */
  rules: number;
  /** Epoch ms of the last successful load; 0 if none has succeeded. */
  loadedAt: number;
  /** Ids ignored because their stored range will not parse. */
  malformed: number[];
}

export function suppressionCacheStatus(): SuppressionCacheStatus {
  return { rules: current.size, loadedAt, malformed: [...current.malformed] };
}

// --- Match accounting ---

/**
 * Suppressed-finding counts waiting to be written.
 *
 * Buffered for the same reason alerts are: suppression happens per finding on the
 * hot path, and a rule pointed at a busy scanner would otherwise cost one UPDATE
 * per packet. Drained synchronously in `flushSuppressionCounters`, so two sinks
 * flushing at once cannot double-count.
 */
const pendingCounts = new Map<number, { count: number; lastAt: Date }>();

/** Records that `ruleId` suppressed a finding observed at `at`. Never throws. */
export function countSuppressed(ruleId: number, at: Date): void {
  const existing = pendingCounts.get(ruleId);
  if (existing) {
    existing.count += 1;
    if (at > existing.lastAt) existing.lastAt = at;
    return;
  }
  pendingCounts.set(ruleId, { count: 1, lastAt: at });
}

export function hasPendingSuppressionCounts(): boolean {
  return pendingCounts.size > 0;
}

/**
 * Writes the buffered counts.
 *
 * These counters are the only trace a suppressed finding leaves, so they are
 * written on the same schedule as the alerts themselves rather than opportunistically.
 * A failure loses counts, not alerts, so it is logged and swallowed — the caller
 * is a flush loop that must go on to serve the next batch.
 */
export async function flushSuppressionCounters(): Promise<void> {
  if (pendingCounts.size === 0) return;

  const batch = [...pendingCounts.entries()];
  pendingCounts.clear();

  for (const [id, entry] of batch) {
    try {
      await db
        .update(alertSuppressions)
        .set({
          matchCount: sql`${alertSuppressions.matchCount} + ${entry.count}`,
          // `greatest` rather than a plain assignment: with two processes
          // matching against the same rule, the later flush must not move the
          // timestamp backwards. Postgres ignores nulls here, so the first write
          // against a fresh rule still lands.
          lastMatchAt: sql`greatest(${alertSuppressions.lastMatchAt}, ${entry.lastAt}::timestamptz)`,
        })
        .where(eq(alertSuppressions.id, id));
    } catch (error) {
      log.error({ ruleId: id, suppressed: entry.count, err: error }, 'Could not record suppressed findings');
    }
  }
}

// --- Storage ---

/**
 * Every rule, oldest first.
 *
 * The order is load-bearing, not cosmetic: `SuppressionSet.match` returns the
 * first rule that matches, and attributing a finding to the oldest rule covering
 * it is the stable choice. Sorting by anything editable would move counts between
 * rules when one was renamed.
 */
async function loadRules(): Promise<SuppressionRow[]> {
  return db.select().from(alertSuppressions).orderBy(asc(alertSuppressions.id));
}

export interface SuppressionListing {
  rules: SuppressionRow[];
  /**
   * Ids whose stored range will not parse. Such a rule matches nothing at all,
   * which is worth surfacing: its author believes it is suppressing something.
   */
  invalid: number[];
}

/**
 * The rules, with the ones that cannot work called out.
 *
 * `invalid` is recomputed from the rows just read rather than taken from the
 * cache, so the flag always describes the rules being shown.
 */
export async function listSuppressions(): Promise<SuppressionListing> {
  const rules = await loadRules();
  return { rules, invalid: new SuppressionSet(rules).malformed };
}

export async function getSuppression(id: number): Promise<SuppressionRow | null> {
  const [row] = await db.select().from(alertSuppressions).where(eq(alertSuppressions.id, id)).limit(1);
  return row ?? null;
}

/** The columns a caller may set. Criteria are already validated at the boundary. */
export interface SuppressionInput {
  kind: string | null;
  sourceCidr: string | null;
  targetCidr: string | null;
  port: number | null;
  reason: string;
  enabled: boolean;
  expiresAt: Date | null;
}

export async function createSuppression(input: SuppressionInput, createdBy: string): Promise<SuppressionRow> {
  const [row] = await db
    .insert(alertSuppressions)
    .values({ ...input, createdBy: createdBy.slice(0, 200) })
    .returning();

  // Reload before answering, so the rule is in force by the time the caller sees
  // its 201. Without this an operator watching the alert list would see findings
  // they had just suppressed keep arriving for up to the refresh interval, and
  // conclude the feature does not work.
  await refreshSuppressions();
  return row!;
}

export async function updateSuppression(id: number, input: SuppressionInput): Promise<SuppressionRow | null> {
  const [row] = await db
    .update(alertSuppressions)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(alertSuppressions.id, id))
    .returning();

  if (!row) return null;
  await refreshSuppressions();
  return row;
}

export async function deleteSuppression(id: number): Promise<boolean> {
  const deleted = await db
    .delete(alertSuppressions)
    .where(eq(alertSuppressions.id, id))
    .returning({ id: alertSuppressions.id });

  if (deleted.length === 0) return false;
  await refreshSuppressions();
  return true;
}
