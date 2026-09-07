import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { alertRollupDaily, alerts, knownDevices } from '../db/schema.js';
import { componentLogger } from '../logger.js';

const log = componentLogger('sensor-scope');

/**
 * Whether this database has more than one sensor writing to it.
 *
 * One question, asked so a notification can decide whether naming its sensor is
 * information or noise. It replaces a heuristic that read the *name*: the sensor
 * line was printed for any `sensorId` other than the literal `default`, on the
 * theory that naming a sensor is what an operator does when they have two.
 *
 * That theory is wrong on the upgrade path this feature recommends. V16 backfills
 * existing rows to `default`, and `SENSOR_ID=default` is what ships in
 * `api/.env.example`, `.env.docker.example` and `docker-compose.yml` — so the
 * first sensor of a real multi-sensor install is almost always called `default`.
 * Head office upgrades, keeps the shipped name, adds `branch-2`, and every alert
 * from the busiest segment arrives with no sensor line while every alert from the
 * new one carries one. The operator has to learn that "no line means head
 * office", which is precisely the ambiguity the line exists to remove.
 *
 * So this asks what the interface asks — `sensors.length > 1`, the same test both
 * pages use to decide whether to render the sensor column at all. The two now
 * agree by construction rather than by two heuristics that happen to coincide
 * except on the default name.
 *
 * Deliberately NOT in `alert.service.ts` alongside `listSensors`, which answers
 * almost the same question: that module imports the notifier to hand it findings,
 * so a notifier importing it back is a cycle.
 *
 * Refreshed at boot and on a timer by index.ts, and read synchronously by whoever
 * builds a notification. Not refreshed on the send path, deliberately: that path's
 * contract is that a delivery problem never reaches detection, and it is driven in
 * unit tests with no database — so a query there would make formatting depend on
 * Postgres being up, and would be paid once per digest.
 */

/**
 * How long an answer is trusted.
 *
 * A sensor appearing or disappearing is a deployment, not a runtime event, so this
 * can be minutes. What it must not be is per-notification: this is read while
 * building every digest, and a query on that path would be paid at whatever rate
 * the network generates findings.
 */
export const SENSOR_SCOPE_TTL_MS = 5 * 60 * 1000;

/**
 * How often the application re-asks. Exported so index.ts sets one interval, not two.
 *
 * **Half the TTL, and that is the point rather than a rounding.** Set equal to it,
 * every other tick did nothing: `checkedAt` is stamped when the query *resolves*,
 * so a tick arriving exactly `TTL_MS` later finds the cached answer fractionally
 * too fresh and returns early. The effective refresh was ten minutes, not the five
 * the constant named — and what that costs is a newly added sensor staying invisible
 * to the notification scope for twice as long as intended, with its alerts going out
 * unlabelled in the meantime.
 *
 * Both halves of the fix are here, because either alone leaves a gap. The interval
 * is half the TTL *and* `checkedAt` is stamped when the query starts rather than
 * when it resolves — with only the halving, a tick at exactly `TTL_MS` still finds
 * the answer fresher than the TTL by however long the query took, and the first
 * tick that actually re-asks is the one after it. Together the effective refresh is
 * the TTL the constant names.
 */
export const SENSOR_SCOPE_REFRESH_MS = SENSOR_SCOPE_TTL_MS / 2;

let known = false;
let checkedAt = 0;
let inFlight: Promise<boolean> | null = null;

/**
 * The cached answer, without waiting.
 *
 * Callers that build a notification use this, so building stays synchronous and
 * `buildNotification` stays a pure function of its arguments. `refreshSensorScope`
 * is what keeps it current, called at boot and on a timer by index.ts — never by
 * the code that sends.
 */
export function hasMultipleSensors(): boolean {
  return known;
}

/**
 * Re-reads the answer if the cached one is stale. Never throws.
 *
 * On failure the previous answer stands. That direction is deliberate: the
 * alternative — assuming one sensor because a query failed — is the exact silence
 * this module exists to prevent, and it would appear only during a database
 * problem, when nobody is reading release notes to find out why the sensor line
 * went missing.
 */
export async function refreshSensorScope(now: number = Date.now()): Promise<boolean> {
  if (now - checkedAt < SENSOR_SCOPE_TTL_MS) return known;

  // Stamped before the query, not after it. See SENSOR_SCOPE_REFRESH_MS: measuring
  // from when the answer arrived made the guard reject a tick that was exactly one
  // TTL late, which is the only kind of tick a fixed interval produces.
  checkedAt = now;

  // One query at a time. Two callers can land together, and there is no reason for
  // two identical reads.
  inFlight ??= query()
    .then((result) => {
      known = result;
      return result;
    })
    .catch((error) => {
      log.warn({ err: error }, 'Could not count sensors; keeping the previous answer');
      // Retry on the next tick rather than sitting on a failed attempt for a full
      // TTL: the stamp above is a promise to have asked, and this one did not.
      checkedAt = 0;
      return known;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function query(): Promise<boolean> {
  /*
   * Three ids at most, because the question is "more than one" rather than "how
   * many". `LIMIT 3` and not 2: one of the rows may be this sensor, and this
   * sensor counts whether or not it has written anything yet — so two returned ids
   * that both happen to be somebody else still has to be distinguishable from one
   * that is us.
   */
  const result = await db.execute<{ sensor_id: string }>(sql`
    SELECT sensor_id FROM (
      SELECT DISTINCT sensor_id FROM ${alerts}
      UNION SELECT DISTINCT sensor_id FROM ${knownDevices}
      UNION SELECT DISTINCT sensor_id FROM ${alertRollupDaily}
    ) AS present
    LIMIT 3
  `);

  const ids = new Set((result.rows ?? []).map((row) => row.sensor_id));
  // This sensor exists even before it has stored anything, exactly as
  // `listSensors` reports it.
  ids.add(env.sensorId);
  return ids.size > 1;
}

/** Test seam: forget the cached answer. */
export function resetSensorScope(): void {
  known = false;
  checkedAt = 0;
  inFlight = null;
}
