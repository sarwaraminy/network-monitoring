import { sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { db, pool } from '../db/index.js';
import { alertRollupDaily, alerts, knownDevices } from '../db/schema.js';
import { componentLogger } from '../logger.js';

const log = componentLogger('retention');

/**
 * Retention: alerts expire in detail, not in aggregate.
 *
 * `alerts` and `known_devices` grow without bound. One recurring finding produces a
 * row every `DETECT_ALERT_WINDOW_MS` — five minutes by default — so a scanner that
 * runs nightly is a few hundred rows a day by itself, and `known_devices` gains a row
 * per MAC address ever seen, which on a network of phones using randomised addresses
 * means a row per phone per address.
 *
 * The obvious implementation is `DELETE FROM alerts WHERE last_seen < cutoff`, and it
 * would quietly break the thing this project is most careful about. The dashboard's
 * trend chart reads `alerts.last_seen`, so a window set to a year would show a flat
 * line before the cutoff — expired history rendered identically to a quiet network.
 * Every detector in this codebase is built so that "nothing happened" and "nothing was
 * recorded" look different; a retention sweep that collapsed them again would be a bad
 * trade for the disk it saves.
 *
 * So each day is aggregated into `alert_rollup_daily` in the same transaction that
 * deletes its rows, and the rollup is never pruned. Detail has a lifetime; the shape
 * is permanent.
 */

/** What one sweep did, for the log and for the tests. */
export interface SweepResult {
  /** Alert rows deleted after being rolled up. */
  alertsDeleted: number;
  /** Rollup buckets written or added to. */
  bucketsWritten: number;
  /** Devices forgotten because they had not been seen inside the window. */
  devicesForgotten: number;
  /** Days processed. Zero means nothing was old enough. */
  daysProcessed: number;
  /**
   * Why no sweep ran, or `false` if one did.
   *
   * Not a boolean, because "swept and found nothing", "the operator turned this
   * off" and "another sweep already has it" are three states an operator reading
   * a log needs to be able to tell apart, and only the middle one means their
   * setting is being honoured.
   */
  skipped: false | 'disabled' | 'in-progress';
}

/** What `rollUpExpiredAlerts` contributes to a sweep. */
type RollupTotals = Pick<SweepResult, 'alertsDeleted' | 'bucketsWritten' | 'daysProcessed'>;

const EMPTY: SweepResult = {
  alertsDeleted: 0,
  bucketsWritten: 0,
  devicesForgotten: 0,
  daysProcessed: 0,
  skipped: false,
};

/**
 * Key for the Postgres advisory lock that serialises sweeps across processes.
 *
 * Arbitrary, and only has to be unique within this database's advisory-lock space.
 */
const SWEEP_LOCK_KEY = 7_213_559_001;

/** Set while a sweep is running in *this* process. */
let sweeping = false;

/** The currently running sweep in this process, if any — see `retentionIdle`. */
let inFlight: Promise<SweepResult> | null = null;

function cutoffFor(days: number, now: number): Date {
  return new Date(now - days * 86_400_000);
}

/**
 * Rolls up and deletes alerts older than the window, then forgets stale devices.
 *
 * Never throws. Retention is housekeeping: a failure must not take down the process
 * that is still detecting things, and the next sweep retries from the same state
 * because the work is idempotent.
 */
export async function sweepRetention(now = Date.now()): Promise<SweepResult> {
  if (!env.retention.enabled) return { ...EMPTY, skipped: 'disabled' };

  // Cheap guard first, no round trip: the common overlap is this process's own
  // interval firing while a long first reclaim is still going.
  if (sweeping) {
    log.warn('A retention sweep is already running; skipping this one');
    return { ...EMPTY, skipped: 'in-progress' };
  }
  sweeping = true;

  const promise = lockedSweep(now).finally(() => {
    sweeping = false;
    inFlight = null;
  });
  inFlight = promise;
  return promise;
}

/**
 * Resolves once any sweep currently running in this process has finished.
 *
 * `stopRetention` only cancels what has not started yet — a sweep already in flight
 * keeps issuing queries on its own connections. Shutdown awaits this after
 * `stopRetention` and before `closeDb()`, which is what closes that gap: without it,
 * `closeDb()` ends the pool underneath a running sweep, producing a burst of
 * per-day failures, and `pool.end()` itself blocks until the advisory-lock client
 * is released, which can push shutdown past its deadline anyway.
 */
export function retentionIdle(): Promise<void> {
  return (inFlight ?? Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Runs one sweep, but only if no other process is running one.
 *
 * Concurrent sweeps do not merely waste work, they corrupt the rollup. Two sweeps
 * on day D both run the aggregate INSERT — under READ COMMITTED the second still
 * sees the rows, because the first has not committed its DELETE — and the additive
 * `ON CONFLICT` sums both. Only one DELETE then removes anything, so D's bucket is
 * permanently double. The idempotence this feature relies on is idempotence across
 * *sequential* retries; it was never idempotence under concurrency.
 *
 * The in-process flag cannot see a second API replica, so the real serialisation is
 * a Postgres advisory lock. It is held on a dedicated client for the duration while
 * the work itself runs on other pooled connections: advisory locks are
 * session-scoped, so taking one through `db.execute` would attach it to whichever
 * connection the pool happened to hand out and release it immediately.
 *
 * `pg_try_advisory_lock`, not `pg_advisory_lock`: a sweep that cannot get the lock
 * should say so and let the next interval try, not queue up behind a reclaim that
 * may run for hours.
 */
async function lockedSweep(now: number): Promise<SweepResult> {
  const result: SweepResult = { ...EMPTY };
  let client: PoolClient | undefined;
  let locked = false;

  try {
    client = await pool.connect();
    const held = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      SWEEP_LOCK_KEY,
    ]);
    locked = held.rows[0]?.locked === true;

    if (!locked) {
      log.info('Another process holds the retention lock; skipping this sweep');
      return { ...EMPTY, skipped: 'in-progress' };
    }

    const rolled = await rollUpExpiredAlerts(cutoffFor(env.retention.alertDays, now));
    result.daysProcessed = rolled.daysProcessed;
    result.alertsDeleted = rolled.alertsDeleted;
    result.bucketsWritten = rolled.bucketsWritten;
    result.devicesForgotten = await forgetStaleDevices(env.retention.deviceDays);

    if (result.alertsDeleted > 0 || result.devicesForgotten > 0) {
      log.info(result, 'Retention sweep complete');
    } else {
      log.debug(result, 'Retention sweep found nothing to do');
    }
  } catch (error) {
    /*
     * `result` can already hold real, committed counts here: `rollUpExpiredAlerts`
     * commits one UTC day per transaction, so a throw from `forgetStaleDevices` —
     * which runs after it — lands here with those days genuinely rolled up and
     * deleted, not merely attempted. Logging the error alone would tell whoever is
     * debugging a "failed" sweep that nothing happened, when disk really was
     * reclaimed; both callers of `sweepRetention` discard its return value, so this
     * log line is the only place those counts are still visible.
     *
     * Safe to retry regardless: the days already committed will not reappear in the
     * next sweep's `expiredDays()`, since their rows are gone, and `devicesForgotten`
     * stays at zero here whenever `forgetStaleDevices` is what threw.
     */
    const committed = result.alertsDeleted > 0 || result.devicesForgotten > 0 || result.daysProcessed > 0;
    log.error(
      { err: error, ...result },
      committed
        ? 'Retention sweep failed partway through; the counts above already committed'
        : 'Retention sweep failed before anything committed; nothing was lost and the next one retries',
    );
  } finally {
    if (client) {
      if (locked) {
        // Best effort. A connection that died has already dropped the lock with
        // its session, and failing to unlock must not mask the sweep's own error.
        await client
          .query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY])
          .catch((error: unknown) => log.warn({ err: error }, 'Could not release the retention lock'));
      }
      client.release();
    }
  }

  return result;
}

/**
 * Aggregates then deletes, one UTC day per transaction.
 *
 * A day at a time rather than everything at once, for two reasons. A single
 * transaction spanning a year of a busy table holds locks and a lot of WAL for as long
 * as it takes; and if it fails, nothing is reclaimed at all. Per day, a failure costs
 * one day's progress and the rest still lands.
 *
 * Aggregate and delete share a transaction, which is what makes the sweep safe to
 * retry. Rolling up and then failing to delete would double-count the day on the next
 * run; deleting and then failing to roll up would lose it. Neither is possible if both
 * commit together.
 *
 * Two details that were wrong in the first version and are worth keeping wrong-proof:
 *
 *  - **Buckets are UTC days, stated explicitly.** `date_trunc('day', ts)` uses the
 *    session's `TimeZone`, so on a server set to Asia/Kabul a finding at 22:30Z landed
 *    in the *next* day's bucket. The same data would then roll up differently on two
 *    machines, and the column's own comment claimed UTC. `AT TIME ZONE 'UTC'` on both
 *    the bucket expression and the range bounds makes it true and portable.
 *  - **Only the expired part of a day is taken.** The day list comes from rows older
 *    than the cutoff, but a day *contains* rows newer than it — so deleting the whole
 *    day removed alerts still inside the retention window, by up to 24 hours. With the
 *    seven-day floor that is a seventh of the window. Both statements now also require
 *    `last_seen < cutoff`, so a partially expired day loses only its expired half and
 *    the additive ON CONFLICT folds the rest in when it expires later.
 *
 * Row counts leave the transaction as its return value rather than being added to a
 * shared total from inside the callback. `db.transaction` resolves only after COMMIT,
 * so a day whose commit failed contributes nothing by construction — where the first
 * version added the counts before COMMIT and then reported rolled-back deletions as
 * done, one log line saying the day was untouched and the next counting its rows.
 */
async function rollUpExpiredAlerts(cutoff: Date): Promise<RollupTotals> {
  const days = await expiredDays(cutoff);
  if (days.length === 0) return { daysProcessed: 0, alertsDeleted: 0, bucketsWritten: 0 };

  log.info({ days: days.length, oldest: days[0], cutoff: cutoff.toISOString() }, 'Rolling up expired alerts');

  const totals: RollupTotals = { daysProcessed: 0, alertsDeleted: 0, bucketsWritten: 0 };
  for (const day of days) {
    try {
      const committed = await db.transaction(async (tx) => {
        /*
         * One statement: aggregate the day's rows and write the buckets.
         *
         * `GROUP BY 1, 2, 3` by position rather than by repeating the expressions,
         * because Postgres treats the same expression in SELECT and GROUP BY as two
         * separate ones once a bound parameter is involved and rejects the query —
         * the trap `dashboardData` works around by inlining its bucket unit.
         *
         * Grouped by sensor as well as by day since V16, so two sensors' findings
         * land in two buckets. The sweep itself is still database-wide rather than
         * scoped to whichever process is running it, and that is deliberate:
         * retention is a property of the database, one sweep is cheaper than one
         * per sensor, and two sensors sweeping concurrently is already safe for the
         * same reason a repeated sweep is — the ON CONFLICT below adds.
         *
         * ON CONFLICT adds rather than replaces, which is what lets a day be rolled
         * up more than once: a day only partly past the cutoff contributes its
         * expired rows now and the rest when they expire, and an interrupted sweep
         * or a late-arriving flow record for an already-rolled-up day accumulates
         * instead of overwriting.
         */
        const written = await tx.execute(sql`
          INSERT INTO ${alertRollupDaily}
            (sensor_id, day, kind, severity, alerts, occurrences, first_seen, last_seen)
          SELECT
            ${alerts.sensorId},
            (${alerts.lastSeen} AT TIME ZONE 'UTC')::date AS day,
            ${alerts.kind},
            ${alerts.severity},
            count(*)::int,
            coalesce(sum(${alerts.occurrences}), 0),
            min(${alerts.firstSeen}),
            max(${alerts.lastSeen})
          FROM ${alerts}
          WHERE ${alerts.lastSeen} >= (${day}::date::timestamp AT TIME ZONE 'UTC')
            AND ${alerts.lastSeen} < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
            AND ${alerts.lastSeen} < ${cutoff}
          GROUP BY 1, 2, 3, 4
          ON CONFLICT (sensor_id, day, kind, severity) DO UPDATE SET
            alerts = ${alertRollupDaily.alerts} + EXCLUDED.alerts,
            occurrences = ${alertRollupDaily.occurrences} + EXCLUDED.occurrences,
            first_seen = least(${alertRollupDaily.firstSeen}, EXCLUDED.first_seen),
            last_seen = greatest(${alertRollupDaily.lastSeen}, EXCLUDED.last_seen),
            rolled_up_at = now()
        `);

        const removed = await tx.execute(sql`
          DELETE FROM ${alerts}
          WHERE ${alerts.lastSeen} >= (${day}::date::timestamp AT TIME ZONE 'UTC')
            AND ${alerts.lastSeen} < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
            AND ${alerts.lastSeen} < ${cutoff}
        `);

        return {
          bucketsWritten: Number(written.rowCount ?? 0),
          alertsDeleted: Number(removed.rowCount ?? 0),
        };
      });

      // Past COMMIT: these rows are really gone and really rolled up.
      totals.bucketsWritten += committed.bucketsWritten;
      totals.alertsDeleted += committed.alertsDeleted;
      totals.daysProcessed += 1;
    } catch (error) {
      // One bad day does not cost the others. Logged with the day so it can be
      // investigated rather than silently retried for ever.
      log.error({ day, err: error }, 'Could not roll up this day; its alerts are untouched');
    }
  }

  return totals;
}

/** The distinct UTC days entirely older than the cutoff, oldest first. */
async function expiredDays(cutoff: Date): Promise<string[]> {
  const rows = await db.execute<{ day: string }>(sql`
    SELECT DISTINCT (${alerts.lastSeen} AT TIME ZONE 'UTC')::date::text AS day
    FROM ${alerts}
    WHERE ${alerts.lastSeen} < ${cutoff}
    ORDER BY 1
  `);

  return (rows.rows ?? []).map((row) => row.day);
}

/**
 * Forgets devices not seen inside the window, where "the window" is measured
 * against the newest sighting in the table rather than against the wall clock.
 *
 * There is nothing to roll up here: the table is a set of "we have seen this MAC
 * before", and the only thing pruning changes is that a returning device is reported
 * as new. That is the same trade `DELETE /api/alerts/devices/:mac` already makes on
 * purpose, and after a year of absence "this appeared on the network" is arguably true
 * again.
 *
 * That justification rests entirely on `last_seen` measuring absence, which it did not
 * when this was written: new-device detection returns early for a MAC it already knows,
 * so the only writer of the column ran on discovery and it meant "first inserted". This
 * would then have deleted every device recorded on install day a year later however
 * continuously it had been present, and the next capture would have re-alerted the whole
 * network. `NewDeviceDetector` now reports sightings of known devices too — see
 * TOUCH_INTERVAL_MS there — so the column means what its name says.
 *
 * That still leaves the clocks mismatched, and this is why the cutoff is not
 * `now - deviceDays`. `last_seen` only advances while a capture is running, and
 * nothing starts one automatically; the sweep, by contrast, starts with the process.
 * On an installation where captures are run for an afternoon at a time, wall-clock
 * time would march past a frozen column until the window elapsed and the *entire*
 * device table went at once — the same mass re-alert, arrived at from the other
 * direction.
 *
 * So the reference point is `max(last_seen)`: the most recent moment we have any
 * evidence of being on this network. It advances only when something is actually
 * seen, which makes it a clock that stops when we stop listening. Under continuous
 * capture it tracks wall time to within TOUCH_INTERVAL_MS and the behaviour is
 * identical; under intermittent capture the devices that appeared in the latest
 * capture — which is to say the ones that are really here — keep their place, and
 * only addresses absent across the observed history are forgotten.
 *
 * It is not a full accounting of capture uptime: a five-minute capture after a year
 * of silence still advances the reference to now, so a device that was present but
 * quiet during those five minutes can be dropped. That is the trade the docblock
 * above already accepts for one device. What it cannot do any more is drop all of
 * them.
 *
 * **The reference is per sensor**, since V16 gave the table a sensor column. A
 * single `max(last_seen)` over the whole table would be one sensor's clock applied
 * to every sensor's devices: a busy sensor capturing continuously would drag the
 * cutoff forward until a quiet one's entire device list fell behind it and went in
 * one sweep — the mass re-alert this function is built to prevent, arriving from a
 * third direction. Correlated on `sensor_id`, each sensor keeps its own clock, and a
 * sensor with no rows at all has no cutoff and loses nothing.
 *
 * **A retired sensor keeps its newest devices for ever, and that is the cost of
 * the correlation rather than a bug in it.** Each cutoff is derived only from that
 * sensor's own rows, so the rows AT its `max(last_seen)` can never fall behind it;
 * once the sensor stops writing, the cutoff stops advancing and everything inside
 * the last window stays. Before the correlation a surviving sensor's clock
 * eventually swept them — which is precisely the mass delete this exists to
 * prevent, so the trade is deliberate. What makes it worth naming is that there is
 * no other way out: `forgetDevice` takes one MAC, this is the only bulk reclaim,
 * and nothing removes a sensor. A sensor retired after a hardware swap leaves its
 * device rows for the life of the installation. Giving an operator a way to drop a
 * sensor is on the roadmap; until then the escape hatch is a DELETE by
 * `sensor_id`, which the query console in write mode can run.
 */
async function forgetStaleDevices(days: number): Promise<number> {
  // rowCount, not .returning(): the MACs are never read, and this table exists
  // precisely because it grows unbounded — the first sweep after a long gap would
  // otherwise pull the whole backlog into memory just to count it.
  /*
   * Each sensor's cutoff computed ONCE, then joined — not correlated per row.
   *
   * The correlated form reads better and does not survive `EXPLAIN`. Because the
   * right-hand side of the outer predicate depends on the row's own `sensor_id`,
   * no index can drive the delete: Postgres seq-scans the whole table and runs the
   * subquery once per row (scalar SubPlans are not memoized — `Memoize` is a
   * nested-loop-join node, which this is not). Measured on 20k rows and three
   * sensors: 202 ms and 78,917 buffers for the correlated version against 21 ms
   * and 19,074 for this one, and the gap widens with the row count on the one
   * table whose unbounded growth is why this function exists.
   *
   * This shape is proportional to the number of SENSORS rather than the number of
   * rows: one aggregate pass builds a row per sensor, and the delete hash-joins
   * against it. The per-sensor clock is unchanged — that is the whole point of
   * keeping the `GROUP BY` — and a sensor with no rows still contributes no
   * cutoff and loses nothing.
   */
  const result = await db.execute(sql`
    WITH cutoff AS (
      SELECT sensor_id, max(last_seen) - ${days}::int * interval '1 day' AS at
      FROM ${knownDevices}
      GROUP BY sensor_id
    )
    DELETE FROM ${knownDevices} AS stale
    USING cutoff
    WHERE cutoff.sensor_id = stale.sensor_id
      AND stale.last_seen < cutoff.at
  `);
  const deleted = result.rowCount ?? 0;

  if (deleted > 0) {
    log.info(
      { devices: deleted, days },
      'Forgot devices absent for the retention window, measured from the newest sighting; ' +
        'each will be reported as new if it returns',
    );
  }

  return deleted;
}

// --- Scheduling ---

/**
 * How long after start the first sweep runs.
 *
 * Startup is already doing migrations, feed loading and socket binding, and a pass
 * over a large table competes with all of it for no benefit: nothing expires in the
 * first minute that would not still be expired a minute later.
 */
const BOOTSTRAP_DELAY_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let firstSweep: NodeJS.Timeout | null = null;

/**
 * Starts the periodic sweep, after `BOOTSTRAP_DELAY_MS`.
 *
 * Returns whether it scheduled anything, which is not decoration. The timer is
 * `unref`'d so that it can never hold the process open, and a consequence of that is
 * it never appears in the process's handle list — so "did this schedule a sweep?" is
 * otherwise unobservable from outside. A test comparing handle counts passed even with
 * the disabled check deleted, which is worse than no test. The caller logs the answer
 * too, so an operator sees it rather than inferring it.
 */
export function startRetention(): boolean {
  if (!env.retention.enabled) {
    log.info('Retention is disabled; alerts and devices will be kept indefinitely');
    return false;
  }
  if (timer) return true;

  // `sweepHours` is already clamped to what a timer can express (see env.ts); this
  // is the belt to that braces, because the failure mode is silent and severe — an
  // overflowing delay becomes 1 ms and sweeps continuously.
  const intervalMs = Math.min(Math.max(1, env.retention.sweepHours) * 3_600_000, 2_147_483_647);

  timer = setInterval(() => {
    void sweepRetention();
  }, intervalMs);
  // Never the reason a process refuses to exit.
  timer.unref();

  firstSweep = setTimeout(() => {
    firstSweep = null;
    void sweepRetention();
  }, BOOTSTRAP_DELAY_MS);
  firstSweep.unref();

  log.info(
    {
      alertDays: env.retention.alertDays,
      deviceDays: env.retention.deviceDays,
      sweepHours: env.retention.sweepHours,
    },
    'Retention scheduled',
  );

  return true;
}

/**
 * Cancels everything scheduled, and returns how many handles that was.
 *
 * Both handles, which is the whole point of the count. The first version cleared only
 * the interval, so a shutdown inside the bootstrap delay let a sweep start *after*
 * `closeDb()`, and a stop/start cycle armed a second bootstrap timeout while the
 * first was still pending — two concurrent sweeps. Neither is visible from outside:
 * the handles are `unref`'d, so they never appear in `getActiveResourcesInfo()` and a
 * test counting the process's resources would pass with the miss still there.
 */
export function stopRetention(): number {
  let cancelled = 0;

  if (firstSweep) {
    clearTimeout(firstSweep);
    firstSweep = null;
    cancelled += 1;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
    cancelled += 1;
  }

  return cancelled;
}
