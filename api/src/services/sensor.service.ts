import { eq, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { alertRollupDaily, alerts, captureSession, knownDevices } from '../db/schema.js';
import { type Actor, recordAudit } from './audit.service.js';
import { ALERT_ROLLUP_LOCK_KEY } from './retention.service.js';

/**
 * Retiring a sensor, which until now nothing could do.
 *
 * Since V16 every finding, device and rollup bucket carries the `sensor_id` of the
 * installation that wrote it, and a shared database is the point of that column.
 * What it created is a shape with no way out: a sensor retired after a hardware
 * swap, a renamed host, a container that came back with a different `SENSOR_ID` —
 * its rows stay under a name nothing will ever write again, in the sensor filter
 * on two pages, and in the device inventory.
 *
 * **Retention cannot reclaim them, and that is the part worth spelling out.** The
 * device sweep's cutoff is derived from each sensor's own last sighting, so a
 * sensor that stops reporting stops advancing its own cutoff and its newest
 * devices are never stale enough to expire. The alert sweep does expire detail by
 * `last_seen` — but it *rolls up* as it goes, into `alert_rollup_daily`, which is
 * never pruned by design. So the retired sensor's shape is permanent, correctly,
 * and nothing anywhere says "this one is finished" rather than "this one has been
 * quiet".
 *
 * So: one audited action that drops everything recorded under a name.
 *
 * **All four tables in one transaction.** Half a decommission is worse than none —
 * a sensor whose findings are gone but whose devices remain still fills the
 * inventory and still appears in `listSensors`, which reads three of these tables,
 * so it would come back in the filter with nothing behind it. The audit row
 * commits with them, the same argument `audit.service.ts` makes about doing the
 * work and recording the work being one thing.
 *
 * **`capture_session` is included even though `listSensors` does not read it.** It
 * is keyed on `(sensor_id, scope)` and holds an interface name and an
 * administrator's email address. Leaving it would keep a retired host's
 * `started_by` in the database after everything else about that host had been
 * deliberately removed, which is the wrong half to keep.
 *
 * **The `logs` table is NOT included**, deliberately: it predates V16 and has no
 * `sensor_id`, so there is no sensor whose rows those are. Deleting by anything
 * else would be guessing.
 *
 * What is not touched at all is the audit trail — it cannot be, and should not be.
 * After this runs, the `sensor.decommission` row is the only record that the
 * sensor ever existed, which is why it carries the counts.
 */

/**
 * How recently a sensor must have been heard from to count as still running.
 *
 * The refusal below used to compare against `env.sensorId` alone, which protects
 * the host serving the request and nothing else. On the shared-database
 * deployment V16 exists for, the list offers every *other* installation and
 * nothing asked whether those were still going — so an administrator on sensor A
 * could delete sensor B's rows out from under B's live detectors, producing
 * exactly what the self-refusal was written to prevent, on the host nobody was
 * looking at.
 *
 * Fifteen minutes, and the figure is a judgement rather than a measurement. A
 * running sensor with any traffic on its segment updates `known_devices.last_seen`
 * continuously — `recordDevice` writes on every sighting — so the signal is
 * usually seconds old, and the window only has to be wider than a quiet spell on
 * a working network. Three times the default detector window
 * (`DETECT_ALERT_WINDOW_MS`, five minutes) is the shape of that.
 *
 * **What this is not, stated because the obvious alternative is wrong.** An open
 * `capture_session` row is NOT evidence a sensor is running. `stopped_at IS NULL`
 * means "was capturing when that process last had an opinion", which is precisely
 * the state a host that died mid-capture leaves behind — the interruption marker
 * V18 exists to write. Treating it as liveness would refuse to retire the crashed
 * host, which is the main thing this feature is for.
 *
 * **And it is a guard, not a proof.** A sensor that is running but has seen no
 * traffic at all for fifteen minutes still looks retired, and nothing in the
 * database can tell those apart — liveness is a fact about a process, and the
 * only registration this system has is "something wrote a row". Closing that
 * completely would need the sensors to heartbeat, which is a schema change and a
 * different piece of work.
 */
const ACTIVE_WINDOW_MS = 15 * 60_000;

/** What a decommission removed, per table. */
export interface DecommissionCounts {
  alerts: number;
  devices: number;
  rollupBuckets: number;
  captureSessions: number;
}

export type DecommissionResult =
  | { outcome: 'decommissioned'; removed: DecommissionCounts }
  /** Nothing anywhere under that name. */
  | { outcome: 'not-found' }
  /**
   * The name this process is itself writing under.
   *
   * Refused rather than allowed, because allowing it would not do what it says:
   * this sensor's detectors are running, so the rows come back — a device on the
   * next frame, a finding on the next detection — and the operator is left with a
   * half-emptied sensor and no error to explain it. Worse, `known_devices` is what
   * `NewDeviceDetector` treats as already-known, so emptying it for a live sensor
   * re-arms new-device detection across the whole segment and the next few minutes
   * are a flood of findings about machines that have been there for months.
   * Clearing findings has its own button; this action is about a name nothing will
   * write again.
   */
  | { outcome: 'self'; sensorId: string }
  /**
   * Another installation that is evidently still writing.
   *
   * The same objection as `self`, on a host the operator cannot see. Kept a
   * distinct outcome rather than folded into it, because the remedies differ: for
   * `self` the answer is "you want Clear all instead", and for this one it is
   * "stop that sensor, or wait" — and only this one can stop being true on its
   * own. `lastSeen` rides along so the message can say how recently, which is the
   * whole basis of the refusal.
   */
  | { outcome: 'active'; sensorId: string; lastSeen: string }
  /**
   * The retention sweep holds the lock this needs.
   *
   * Reported rather than waited on, the same call `lockedSweep` makes in the
   * other direction: a reclaim can run for hours, and an operator's request must
   * not hang behind one. Retriable, and says so.
   */
  | { outcome: 'busy'; sensorId: string };

export async function decommissionSensor(sensorId: string, actor: Actor): Promise<DecommissionResult> {
  if (sensorId === env.sensorId) return { outcome: 'self', sensorId };

  return db.transaction(async (tx) => {
    /*
     * The rollup lock, before anything is read or deleted.
     *
     * `pg_try_advisory_xact_lock` rather than the dedicated client `lockedSweep`
     * uses: a transaction is pinned to one connection, so the lock rides on it and
     * is released by the commit or the rollback with nothing to unlock by hand.
     * Same key, so the two contend — see `ALERT_ROLLUP_LOCK_KEY` for the race,
     * which is a retention sweep writing rollup buckets for the sensor being
     * retired out of alerts this transaction has deleted but not committed.
     *
     * `try`, not a wait, for the reason `lockedSweep` gives about the other
     * direction: a reclaim may run for hours, and an operator pressing a button
     * should be told to come back rather than left holding a request open. The
     * lock is taken first so a refusal costs nothing.
     */
    const lock = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${ALERT_ROLLUP_LOCK_KEY}) AS locked`,
    );
    if (lock.rows?.[0]?.locked !== true) return { outcome: 'busy', sensorId };

    /*
     * Is anything still writing under this name?
     *
     * Inside the transaction and after the lock, so the answer cannot be
     * invalidated by the sweep between the read and the deletes. It does not fence
     * a *live sensor* — no lock here can, since that is another process on another
     * host with its own connections — which is why this is a guard on an operator
     * mistake rather than a guarantee. See `ACTIVE_WINDOW_MS`.
     *
     * The same three tables `listRetirableSensors` reads, so the guard and the
     * date the operator was shown cannot disagree. `alert_rollup_daily` can only
     * ever drag the answer older, since its buckets cover days retention has
     * already expired.
     */
    const seen = await tx.execute<{ last_seen: string | null }>(sql`
      SELECT to_char(max(last_seen) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen
        FROM (
          SELECT max(last_seen) AS last_seen FROM ${alerts}            WHERE sensor_id = ${sensorId}
          UNION ALL
          SELECT max(last_seen)              FROM ${knownDevices}      WHERE sensor_id = ${sensorId}
          UNION ALL
          SELECT max(last_seen)              FROM ${alertRollupDaily}  WHERE sensor_id = ${sensorId}
        ) activity
    `);
    const lastSeen = seen.rows?.[0]?.last_seen ?? null;
    if (lastSeen !== null && Date.now() - new Date(lastSeen).getTime() < ACTIVE_WINDOW_MS) {
      return { outcome: 'active', sensorId, lastSeen };
    }

    /*
     * `rowCount`, not `.returning()`.
     *
     * The counts are all this needs, and a `RETURNING` clause asks Postgres to
     * send back a column for every row it removed. On the input this function is
     * written for — the docblock above talks about six figures of findings — that
     * materialises hundreds of thousands of values into Node and holds them while
     * the transaction stays open and the row locks stay held, to compute four
     * numbers the driver already reports. It was the only part of this function
     * that scaled with the data rather than with the number of tables.
     *
     * `rowCount` is nullable in the driver's types — a statement that returns no
     * count at all — and a delete always has one, so the `?? 0` is for the type
     * rather than for a case that happens.
     */
    const removed: DecommissionCounts = {
      alerts: (await tx.delete(alerts).where(eq(alerts.sensorId, sensorId))).rowCount ?? 0,
      devices: (await tx.delete(knownDevices).where(eq(knownDevices.sensorId, sensorId))).rowCount ?? 0,
      rollupBuckets:
        (await tx.delete(alertRollupDaily).where(eq(alertRollupDaily.sensorId, sensorId))).rowCount ?? 0,
      captureSessions:
        (await tx.delete(captureSession).where(eq(captureSession.sensorId, sensorId))).rowCount ?? 0,
    };

    /*
     * Nothing under that name, and the transaction is what makes saying so safe:
     * the four deletes removed nothing, so committing and rolling back are the
     * same thing, and no audit row is written for an act that did not happen.
     *
     * Read from the counts rather than from a prior existence query, for the
     * reason `forgetDevice` gives: a pre-fetch narrows the race without closing
     * it, and what the deletes actually removed is the answer.
     */
    if (Object.values(removed).every((count) => count === 0)) {
      return { outcome: 'not-found' };
    }

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'sensor.decommission',
      subject: sensorId,
      /*
       * The counts, because once this commits they are the only description of
       * what was removed that survives anywhere. Not the rows themselves: a busy
       * sensor's findings run into six figures, and an audit `detail` holding them
       * would make the one table that cannot be pruned the largest in the
       * database.
       */
      detail: { ...removed },
    });

    return { outcome: 'decommissioned', removed };
  });
}

/**
 * Which names this sensor could be asked to retire, and what is under each.
 *
 * `listSensors` in `alert.service.ts` answers a related but different question: it
 * adds this sensor to the list even when it has written nothing, so the filter
 * always offers the installation the operator is looking at. Right there, and
 * wrong here — this list is what a destructive action is offered against, and
 * including a name with nothing behind it would offer to retire the live sensor.
 *
 * The counts are what let the dialog say what would be lost before anybody
 * presses the button. Ordered by name, matching `listSensors`, because an operator
 * scans it for one they recognise rather than for the busiest.
 */
export interface RetirableSensor {
  sensorId: string;
  alerts: number;
  devices: number;
  rollupBuckets: number;
  /**
   * The most recent activity under this name.
   *
   * Null only when nothing under it carries a timestamp at all, which no current
   * table produces — every one of the three records a `last_seen`, including
   * `alert_rollup_daily`, whose buckets keep the real extremes precisely so that a
   * rolled-up day still says when something happened. Nullable rather than
   * asserted, because the alternative is a date this code invented.
   */
  lastSeen: string | null;
  /**
   * Evidently still writing, by the same rule the refusal applies.
   *
   * Carried so the interface can disable the control and say why, rather than
   * offering an action the server will refuse — the convention `UserRoles`
   * already follows for the two role changes it knows are impossible. Computed
   * here and not in the browser, because the answer depends on the server's clock
   * and on `ACTIVE_WINDOW_MS`, and a second copy of the threshold would be a rule
   * the two could come to disagree about.
   */
  active: boolean;
}

export async function listRetirableSensors(): Promise<RetirableSensor[]> {
  /*
   * Three grouped scans unioned and re-grouped, rather than a three-way FULL
   * OUTER JOIN.
   *
   * Each branch is an aggregate over an indexed `sensor_id`. Joining them in SQL
   * would mean rebuilding the name with `coalesce` over three nullable key
   * columns, which is the shape that is easy to get subtly wrong — and getting it
   * wrong here means offering to delete rows under a name that is not theirs.
   *
   * **`last_seen` is formatted in SQL, not with `toISOString()`.** A raw
   * `db.execute` gets no column mapping from drizzle, and drizzle's node-postgres
   * driver installs type parsers that hand timestamps back as *strings* precisely
   * because its own `mode: 'date'` mapping is what normally converts them — so
   * `row.last_seen.toISOString()` is a `TypeError` here, not a Date. `::text`
   * would work but hands back whatever `DateStyle` the session is set to; the
   * explicit `AT TIME ZONE 'UTC'` and pattern produce exactly what
   * `toISOString()` would, independent of the session's zone. Same class of
   * problem as `date_trunc` reading the session zone in `trend-buckets`.
   *
   * All three contribute `last_seen`, `alert_rollup_daily` included — its buckets
   * carry the real first and last instants within the day rather than the day
   * alone, which is what lets a sensor whose detail has all expired still report
   * when it was last heard from. That is retention's end state and the most likely
   * state of a sensor somebody wants to retire, so taking the answer from `alerts`
   * alone would have left exactly those reporting nothing.
   */
  const result = await db.execute<{
    sensor_id: string;
    alerts: string;
    devices: string;
    rollup_buckets: string;
    last_seen: string | null;
  }>(sql`
    WITH counted AS (
      SELECT sensor_id,
             count(*)       AS alerts,
             0              AS devices,
             0              AS rollup_buckets,
             max(last_seen) AS last_seen
        FROM ${alerts}
       GROUP BY sensor_id
      UNION ALL
      SELECT sensor_id, 0, count(*), 0, max(last_seen) FROM ${knownDevices} GROUP BY sensor_id
      UNION ALL
      SELECT sensor_id, 0, 0, count(*), max(last_seen) FROM ${alertRollupDaily} GROUP BY sensor_id
    )
    SELECT sensor_id,
           sum(alerts)::text         AS alerts,
           sum(devices)::text        AS devices,
           sum(rollup_buckets)::text AS rollup_buckets,
           to_char(max(last_seen) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen
      FROM counted
     WHERE sensor_id <> ${env.sensorId}
     GROUP BY sensor_id
     ORDER BY sensor_id
  `);

  const now = Date.now();
  return (result.rows ?? []).map((row) => ({
    sensorId: row.sensor_id,
    alerts: Number(row.alerts),
    devices: Number(row.devices),
    rollupBuckets: Number(row.rollup_buckets),
    lastSeen: row.last_seen,
    // One clock and one threshold, the same ones `decommissionSensor` re-checks
    // inside its transaction. This is what the operator is shown; that is what
    // decides, because a list can be minutes stale by the time a button is pressed.
    active: row.last_seen !== null && now - new Date(row.last_seen).getTime() < ACTIVE_WINDOW_MS,
  }));
}
