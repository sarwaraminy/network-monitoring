import { count, lt, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
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
  skipped: boolean;
}

const EMPTY: SweepResult = {
  alertsDeleted: 0,
  bucketsWritten: 0,
  devicesForgotten: 0,
  daysProcessed: 0,
  skipped: false,
};

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
  if (!env.retention.enabled) return { ...EMPTY, skipped: true };

  const result: SweepResult = { ...EMPTY };

  try {
    result.daysProcessed = await rollUpExpiredAlerts(cutoffFor(env.retention.alertDays, now), result);
    result.devicesForgotten = await forgetStaleDevices(cutoffFor(env.retention.deviceDays, now));

    if (result.alertsDeleted > 0 || result.devicesForgotten > 0) {
      log.info(result, 'Retention sweep complete');
    } else {
      log.debug(result, 'Retention sweep found nothing to do');
    }
  } catch (error) {
    log.error({ err: error }, 'Retention sweep failed; nothing was lost and the next one retries');
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
 */
async function rollUpExpiredAlerts(cutoff: Date, result: SweepResult): Promise<number> {
  const days = await expiredDays(cutoff);
  if (days.length === 0) return 0;

  log.info({ days: days.length, oldest: days[0], cutoff: cutoff.toISOString() }, 'Rolling up expired alerts');

  let processed = 0;
  for (const day of days) {
    try {
      await db.transaction(async (tx) => {
        /*
         * One statement: aggregate the day's rows and write the buckets.
         *
         * `GROUP BY 1, 2, 3` by position rather than by repeating the expressions,
         * because Postgres treats the same expression in SELECT and GROUP BY as two
         * separate ones once a bound parameter is involved and rejects the query —
         * the trap `dashboardData` works around by inlining its bucket unit.
         *
         * ON CONFLICT adds rather than replaces, which is what lets a day be rolled
         * up more than once: a day only partly past the cutoff contributes its
         * expired rows now and the rest when they expire, and an interrupted sweep
         * or a late-arriving flow record for an already-rolled-up day accumulates
         * instead of overwriting.
         */
        const written = await tx.execute(sql`
          INSERT INTO ${alertRollupDaily} (day, kind, severity, alerts, occurrences, first_seen, last_seen)
          SELECT
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
          GROUP BY 1, 2, 3
          ON CONFLICT (day, kind, severity) DO UPDATE SET
            alerts = ${alertRollupDaily.alerts} + EXCLUDED.alerts,
            occurrences = ${alertRollupDaily.occurrences} + EXCLUDED.occurrences,
            first_seen = least(${alertRollupDaily.firstSeen}, EXCLUDED.first_seen),
            last_seen = greatest(${alertRollupDaily.lastSeen}, EXCLUDED.last_seen),
            rolled_up_at = now()
        `);

        const deleted = await tx.execute(sql`
          DELETE FROM ${alerts}
          WHERE ${alerts.lastSeen} >= (${day}::date::timestamp AT TIME ZONE 'UTC')
            AND ${alerts.lastSeen} < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
            AND ${alerts.lastSeen} < ${cutoff}
        `);

        result.bucketsWritten += Number(written.rowCount ?? 0);
        result.alertsDeleted += Number(deleted.rowCount ?? 0);
      });
      processed += 1;
    } catch (error) {
      // One bad day does not cost the others. Logged with the day so it can be
      // investigated rather than silently retried for ever.
      log.error({ day, err: error }, 'Could not roll up this day; its alerts are untouched');
    }
  }

  return processed;
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
 * Forgets devices not seen inside the window.
 *
 * There is nothing to roll up here: the table is a set of "we have seen this MAC
 * before", and the only thing pruning changes is that a returning device is reported
 * as new. That is the same trade `DELETE /api/alerts/devices/:mac` already makes on
 * purpose, and after a year of absence "this appeared on the network" is arguably true
 * again.
 */
async function forgetStaleDevices(cutoff: Date): Promise<number> {
  const deleted = await db
    .delete(knownDevices)
    .where(lt(knownDevices.lastSeen, cutoff))
    .returning({ mac: knownDevices.macAddress });

  if (deleted.length > 0) {
    log.info(
      { devices: deleted.length, cutoff: cutoff.toISOString() },
      'Forgot devices not seen inside the retention window; each will be reported as new if it returns',
    );
  }

  return deleted.length;
}

// --- Scheduling ---

let timer: NodeJS.Timeout | null = null;

/**
 * Starts the periodic sweep.
 *
 * The first sweep runs on a delay rather than at boot. Startup is already doing
 * migrations, feed loading and socket binding, and a retention pass over a large table
 * competes with all of it for no benefit — nothing expires in the first minute that
 * would not still be expired a minute later.
 */
export function startRetention(): void {
  if (!env.retention.enabled) {
    log.info('Retention is disabled; alerts and devices will be kept indefinitely');
    return;
  }
  if (timer) return;

  const intervalMs = Math.max(1, env.retention.sweepHours) * 3_600_000;

  timer = setInterval(() => {
    void sweepRetention();
  }, intervalMs);
  // Never the reason a process refuses to exit.
  timer.unref();

  const first = setTimeout(() => void sweepRetention(), 60_000);
  first.unref();

  log.info(
    {
      alertDays: env.retention.alertDays,
      deviceDays: env.retention.deviceDays,
      sweepHours: env.retention.sweepHours,
    },
    'Retention scheduled',
  );
}

export function stopRetention(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Live alert rows plus rollup buckets, for the status endpoint and the tests. */
export async function retentionStatus(): Promise<{
  enabled: boolean;
  alertDays: number;
  deviceDays: number;
  liveAlerts: number;
  rollupBuckets: number;
  oldestLiveAlert: string | null;
}> {
  const [live] = await db
    .select({ n: count(), oldest: sql<string | null>`min(${alerts.lastSeen})` })
    .from(alerts);
  const [buckets] = await db.select({ n: count() }).from(alertRollupDaily);

  return {
    enabled: env.retention.enabled,
    alertDays: env.retention.alertDays,
    deviceDays: env.retention.deviceDays,
    liveAlerts: Number(live?.n ?? 0),
    rollupBuckets: Number(buckets?.n ?? 0),
    oldestLiveAlert: live?.oldest ? new Date(live.oldest).toISOString() : null,
  };
}
