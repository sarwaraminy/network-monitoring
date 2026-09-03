import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { alertSuppressions, type SuppressionRow } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { type Actor, recordAudit } from './audit.service.js';
import { NO_SUPPRESSIONS, SuppressionSet, type UnusableRule } from './suppression-rules.js';

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
 *    mutation reloads before it answers — and chains that reload after any load
 *    already running, so it cannot be satisfied by a query that ran before its own
 *    write. See `reloadAfterWrite`. The interval only matters when something else
 *    changed the table: a second process, or somebody with psql.
 *  - A database that cannot be read is reported once and then at a bounded rate,
 *    not once per finding batch. See `noteLoadFailure`.
 */

/**
 * How stale the cached set may get before a read triggers a background reload.
 *
 * There is no environment variable for this on purpose. A hardened default in
 * env.ts gets silently undone by a Compose file or an `.env.example` that still
 * sets the old value, which has happened three times in this repo; a knob nobody
 * asked for is a knob that can drift.
 */
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Failed loads retried at full speed before backing off.
 *
 * A reload racing a database restart should recover in seconds rather than in a
 * minute, so the first few failures retry promptly. After that the retries are
 * spaced, because `suppressions()` is called once per finding batch and an
 * unreachable database would otherwise mean back-to-back failing queries and a
 * continuous error stream for the length of the outage — at exactly the moment
 * findings are arriving fastest. Loud on the transition, then rate-limited: the
 * same shape the notifier's export queue was corrected into.
 */
const PROMPT_RETRIES = 3;
const BACKOFF_INTERVAL_MS = 60_000;
/** Ceiling on how often a continuing failure is logged. */
const FAILURE_LOG_INTERVAL_MS = 300_000;

let current: SuppressionSet = NO_SUPPRESSIONS;
let loadedAt = 0;
/** In-flight reload, so a burst of findings cannot start twenty of them. */
let loading: Promise<SuppressionSet> | null = null;

/** Failure accounting, so an outage is reported once rather than per batch. */
let consecutiveFailures = 0;
let unloggedFailures = 0;
let lastFailureLogAt = 0;
/** Earliest time a *read* may start another load. Writes ignore it. */
let nextAttemptAt = 0;

/**
 * The rules in force, for the hot path. Never throws, never blocks.
 *
 * A stale set is served while a reload runs in the background. That is deliberate:
 * the alternative is either blocking detection on a query or dropping findings on
 * the floor while one is outstanding, and a rule taking a few seconds longer to
 * apply is a much smaller problem than either.
 */
export function suppressions(): SuppressionSet {
  const now = Date.now();
  if (now - loadedAt > REFRESH_INTERVAL_MS && now >= nextAttemptAt && !loading) {
    // Fire and forget: the load logs its own failures and leaves the current set
    // alone, so there is nothing here to handle.
    void refreshSuppressions();
  }
  return current;
}

/**
 * Reloads and recompiles, joining a load already in flight.
 *
 * For the hot path and for startup, where coalescing is the point: one reload per
 * burst rather than one per batch. A caller that has just *written* must not use
 * this — see `reloadAfterWrite`.
 */
export async function refreshSuppressions(): Promise<SuppressionSet> {
  return loading ?? enqueueLoad();
}

/**
 * A reload whose query provably starts after the caller's write committed.
 *
 * The distinction is not academic. `refreshSuppressions` returns a load already in
 * flight, and that load's `SELECT` may have run *before* an INSERT that has only
 * just committed. A mutation awaiting it would then publish a set without its own
 * new rule and stamp `loadedAt` fresh, so the rule would not apply for up to the
 * refresh interval — breaking exactly the guarantee the mutations claim, that a
 * rule is in force by the time its 201 arrives. Chaining rather than joining costs
 * one extra query on the rare overlap and makes the guarantee true.
 */
export async function reloadAfterWrite(): Promise<SuppressionSet> {
  return enqueueLoad();
}

/**
 * Queues a load behind whatever is in flight and publishes it as the current one.
 *
 * Chained rather than parallel so two concurrent writes cannot interleave their
 * `SELECT`s and publish the older result last.
 */
function enqueueLoad(): Promise<SuppressionSet> {
  const previous = loading ?? Promise.resolve(current);
  // Both arms, because a predecessor's rejection must not cancel this load.
  // `loadAndCompile` swallows its own errors, so in practice only the first arm
  // runs; relying on that would make this fragile to a later edit.
  const run: Promise<SuppressionSet> = previous.then(loadAndCompile, loadAndCompile);
  loading = run;
  void run.finally(() => {
    // Only if nothing has queued behind us in the meantime.
    if (loading === run) loading = null;
  });
  return run;
}

/**
 * Where the rows come from. Swapped by tests, never at runtime.
 *
 * The same seam `EmailChannel` takes as `transportFactory` and `WebhookChannel` as
 * `fetchImpl`, and for the same reason: the interesting behaviour in this module is
 * the caching, the write-ordering and the retry policy, none of which is about
 * Postgres. With this the suites keep their promise of needing no database.
 */
export type RuleLoader = () => Promise<SuppressionRow[]>;
let loader: RuleLoader = loadRules;

/** Test seam. Passing null restores the real query. */
export function setRuleLoaderForTests(load: RuleLoader | null): void {
  loader = load ?? loadRules;
}

/** Drops the cached set and the failure accounting. For tests and for a reset. */
export function resetSuppressionCache(): void {
  current = NO_SUPPRESSIONS;
  loadedAt = 0;
  loading = null;
  consecutiveFailures = 0;
  unloggedFailures = 0;
  lastFailureLogAt = 0;
  nextAttemptAt = 0;
}

/** Reads, compiles, publishes. Never rejects: a failure keeps the previous set. */
async function loadAndCompile(): Promise<SuppressionSet> {
  try {
    const rows = await loader();
    const set = new SuppressionSet(rows);

    if (set.unusable.length > 0) {
      // Loud, because such a rule silently does nothing: its author believes
      // findings are being suppressed and they are not. The reason travels with
      // the id, so a renamed detector kind is diagnosable from the log alone.
      log.warn({ rules: set.unusable }, 'Suppression rules ignored: they cannot match anything');
    }

    current = set;
    loadedAt = Date.now();
    nextAttemptAt = 0;

    if (consecutiveFailures > 0) {
      log.warn(
        { failedAttempts: consecutiveFailures },
        'Suppression rules loaded again after failing; suppression was not being applied in between',
      );
      consecutiveFailures = 0;
      unloggedFailures = 0;
    }

    log.debug({ rules: set.size }, 'Suppression rules loaded');
    return set;
  } catch (error) {
    noteLoadFailure(error);
    return current;
  }
}

/**
 * Records a failed load: schedules the next attempt and decides whether to log.
 *
 * The previous set stays in force, and `current` is deliberately not cleared —
 * failing open means findings get through, and clearing the set on a database
 * blip would silently stop suppressing rules the operator still wants.
 */
function noteLoadFailure(error: unknown): void {
  const now = Date.now();
  consecutiveFailures += 1;
  unloggedFailures += 1;

  const prompt = consecutiveFailures <= PROMPT_RETRIES;
  nextAttemptAt = prompt ? 0 : now + BACKOFF_INTERVAL_MS;

  if (prompt || now - lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
    log.error(
      {
        err: error,
        consecutiveFailures,
        // How many attempts this one line stands for, so the rate limiting is
        // visible rather than looking like the failures stopped.
        attemptsSinceLastLog: unloggedFailures,
        retryInMs: nextAttemptAt === 0 ? 0 : BACKOFF_INTERVAL_MS,
      },
      'Could not load suppression rules; keeping the previous set',
    );
    lastFailureLogAt = now;
    unloggedFailures = 0;
  }
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
   * Rules that cannot match anything, with the reason. Worth surfacing rather
   * than counting: their author believes findings are being suppressed, and the
   * reason is the difference between fixing a typo and staring at the row.
   */
  invalid: UnusableRule[];
}

/**
 * The rules, with the ones that cannot work called out.
 *
 * `invalid` is recomputed from the rows just read rather than taken from the
 * cache, so the flag always describes the rules being shown.
 */
export async function listSuppressions(): Promise<SuppressionListing> {
  const rules = await loadRules();
  return { rules, invalid: [...new SuppressionSet(rules).unusable] };
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

/**
 * The parts of a rule worth putting in the audit trail.
 *
 * A suppression rule is the one piece of configuration that can make this tool stop
 * reporting, so "somebody changed a rule" is not a useful entry on its own — what
 * it covered is the whole substance. Nothing here is a credential.
 */
function ruleDetail(rule: SuppressionRow | SuppressionInput): Record<string, unknown> {
  return {
    kind: rule.kind,
    sourceCidr: rule.sourceCidr,
    targetCidr: rule.targetCidr,
    port: rule.port,
    reason: rule.reason,
    enabled: rule.enabled,
    expiresAt: rule.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Field-by-field, so a change reads as a change rather than as a new rule.
 *
 * Exported for the test: "only what changed" is the property that makes an update
 * entry readable, and a diff that quietly recorded every field would turn every
 * edit into a wall of unchanged values.
 */
export function ruleChanges(before: SuppressionRow, after: SuppressionInput): Record<string, unknown> {
  const from = ruleDetail(before);
  const to = ruleDetail(after);
  const changed: Record<string, unknown> = {};

  for (const field of Object.keys(to)) {
    if (from[field] !== to[field]) changed[field] = { from: from[field], to: to[field] };
  }

  return changed;
}

export async function createSuppression(input: SuppressionInput, createdBy: Actor): Promise<SuppressionRow> {
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(alertSuppressions)
      .values({ ...input, createdBy: createdBy.name.slice(0, 200) })
      .returning();

    await recordAudit(tx, {
      actor: createdBy.name,
      actorId: createdBy.id,
      action: 'suppression.create',
      subject: String(created!.id),
      detail: ruleDetail(created!),
    });

    return created!;
  });

  // Reload before answering, so the rule is in force by the time the caller sees
  // its 201. Without this an operator watching the alert list would see findings
  // they had just suppressed keep arriving for up to the refresh interval, and
  // conclude the feature does not work. Outside the transaction, because it reads
  // on its own connection and would not see the rule before it commits.
  await reloadAfterWrite();
  return row;
}

export async function updateSuppression(
  id: number,
  input: SuppressionInput,
  actor: Actor,
): Promise<SuppressionRow | null> {
  const row = await db.transaction(async (tx) => {
    /*
     * `FOR UPDATE`, and the lock is the point rather than the transaction.
     *
     * Postgres defaults to READ COMMITTED, where a plain SELECT takes no row lock —
     * so two concurrent PATCHes both read the pre-first-update row, the second
     * blocks only when it reaches its own UPDATE, and both audit entries then claim
     * the same starting values. The trail shows two edits from one origin and the
     * intermediate state appears in no record at all. Atomicity was never the
     * property needed here; serialising this read against the write it describes is.
     */
    const [before] = await tx
      .select()
      .from(alertSuppressions)
      .where(eq(alertSuppressions.id, id))
      .limit(1)
      .for('update');
    if (!before) return null;

    const [updated] = await tx
      .update(alertSuppressions)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(alertSuppressions.id, id))
      .returning();

    if (!updated) return null;

    // Same rule as the settings save: a form re-submitted with nothing altered is
    // not an edit, and `{ changed: {} }` in a table that cannot be pruned is a row
    // an auditor has to read past to reach the ones that mattered.
    const changed = ruleChanges(before, input);
    if (Object.keys(changed).length > 0) {
      await recordAudit(tx, {
        actor: actor.name,
        actorId: actor.id,
        action: 'suppression.update',
        subject: String(id),
        detail: { changed },
      });
    }

    return updated;
  });

  if (!row) return null;
  await reloadAfterWrite();
  return row;
}

export async function deleteSuppression(id: number, actor: Actor): Promise<boolean> {
  const removed = await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(alertSuppressions).where(eq(alertSuppressions.id, id)).returning();
    if (!deleted) return false;

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'suppression.delete',
      subject: String(id),
      // Including the match count: a rule that had quietly hidden nine thousand
      // findings and was then deleted is a different event from one that never
      // matched, and the counter goes with the row.
      detail: { ...ruleDetail(deleted), matchCount: deleted.matchCount },
    });

    return true;
  });

  if (!removed) return false;
  await reloadAfterWrite();
  return true;
}
