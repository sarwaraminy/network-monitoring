import { and, desc, eq, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { type KnownDeviceRow, knownDevices } from '../db/schema.js';
import { type Actor, recordAudit } from './audit.service.js';

/**
 * Persists the MAC addresses seen on the network, so "new device" means new to
 * the network rather than new since the last restart.
 *
 * Every row belongs to a sensor since V16, and that changes what the table means.
 * "Seen before" is a statement about one sensor's segment, not about the database:
 * with the MAC alone as the primary key, a phone the first sensor had learned was
 * already known to every other sensor sharing the database, and new-device
 * detection simply never raised it. That failure was silent in a way the merged
 * alert rows were not — a detection that does not fire leaves nothing behind to
 * look at.
 */

/**
 * The addresses this sensor has seen, for seeding its own detector.
 *
 * Scoped, and it is the single most important scope in this file: this list is what
 * `NewDeviceDetector` treats as already-known, so an unscoped read hands one
 * sensor every other sensor's devices and switches its detection off for them.
 */
export async function loadKnownMacAddresses(): Promise<string[]> {
  const rows = await db
    .select({ mac: knownDevices.macAddress })
    .from(knownDevices)
    .where(eq(knownDevices.sensorId, env.sensorId));
  return rows.map((row) => row.mac);
}

/**
 * The device inventory, every sensor's by default.
 *
 * Unscoped where `loadKnownMacAddresses` is scoped, and the asymmetry is the point:
 * this one answers "what is on our networks?", which a shared database is what
 * makes possible, while that one answers "what has this sensor already learned?",
 * which decides whether a detector fires. Reading them as the same question is the
 * bug V16 removed.
 */
export async function listKnownDevices(sensor?: string): Promise<KnownDeviceRow[]> {
  return db
    .select()
    .from(knownDevices)
    .where(sensor ? eq(knownDevices.sensorId, sensor) : undefined)
    .orderBy(desc(knownDevices.lastSeen));
}

/** Inserts a device, or refreshes `last_seen`/`last_ip` if it is already known. */
export async function recordDevice(macAddress: string, ipAddress: string | null): Promise<void> {
  const mac = macAddress.toLowerCase();
  const now = new Date();

  await db
    .insert(knownDevices)
    .values({
      // From the environment, like every other write here: which sensor saw a
      // device is a fact about this process, not about the sighting.
      sensorId: env.sensorId,
      macAddress: mac,
      firstIp: ipAddress,
      lastIp: ipAddress,
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoUpdate({
      // Both columns, matching V16's primary key. `macAddress` alone no longer
      // names a constraint, and it is the key that made one sensor's sighting
      // count as every sensor's.
      target: [knownDevices.sensorId, knownDevices.macAddress],
      set: {
        lastSeen: now,
        // Keep the previous address when this sighting had none.
        lastIp: sql`coalesce(${ipAddress}, ${knownDevices.lastIp})`,
      },
    });
}

/**
 * Forgets a device, so it is reported as new if it returns.
 *
 * Scoped to one sensor when the caller names one. Deleting every sensor's row for
 * an address would be a different act than the button asks for: it would re-arm
 * new-device detection on segments the operator is not looking at.
 *
 * When the caller names none, the sensor is *resolved* rather than assumed, and
 * that is this function's one piece of real behaviour. It used to default to this
 * sensor, which disagreed with the list beside it: `GET /devices` returns every
 * sensor's rows, so the obvious client — read the list, post a MAC back — deleted
 * a row it had never seen, or answered 404 for a MAC plainly in the list it had
 * just fetched. Neither is a thing to leave for whoever writes that client.
 *
 * So: one holder, delete it; several, refuse and name them, because picking one is
 * the caller's decision and guessing it is how the wrong segment gets re-armed;
 * none, not found. On a single-sensor installation — every installation that has
 * not set SENSOR_ID — there is exactly one holder and this is what it always did.
 *
 * Resolved inside the transaction, and the holders are locked while it decides:
 * otherwise a second sensor learning the same address between the count and the
 * delete turns an unambiguous request into a silent choice between two rows.
 *
 * Audited in the same transaction, with what was known about it: the addresses and
 * when it was first and last seen are the whole of what the row held, and after the
 * delete this entry is the only place they survive. The sensor is recorded too,
 * because "device aa:bb:cc was forgotten" no longer identifies a single row.
 */
export type ForgetDeviceResult =
  | { outcome: 'forgotten'; sensorId: string }
  | { outcome: 'not-found' }
  /** Held by more than one sensor, and the caller did not say which. */
  | { outcome: 'ambiguous'; sensors: string[] };

export async function forgetDevice(
  macAddress: string,
  actor: Actor,
  sensor?: string,
): Promise<ForgetDeviceResult> {
  const mac = macAddress.toLowerCase();

  return db.transaction(async (tx) => {
    let target = sensor;

    if (target === undefined) {
      const holders = await tx
        .select({ sensorId: knownDevices.sensorId })
        .from(knownDevices)
        .where(eq(knownDevices.macAddress, mac))
        .for('update');

      if (holders.length === 0) return { outcome: 'not-found' };
      if (holders.length > 1) {
        return { outcome: 'ambiguous', sensors: holders.map((row) => row.sensorId).sort() };
      }
      target = holders[0]!.sensorId;
    }

    const [deleted] = await tx
      .delete(knownDevices)
      .where(and(eq(knownDevices.sensorId, target), eq(knownDevices.macAddress, mac)))
      .returning({
        sensorId: knownDevices.sensorId,
        mac: knownDevices.macAddress,
        firstIp: knownDevices.firstIp,
        lastIp: knownDevices.lastIp,
        firstSeen: knownDevices.firstSeen,
        lastSeen: knownDevices.lastSeen,
      });

    if (!deleted) return { outcome: 'not-found' };

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'device.forget',
      subject: deleted.mac,
      detail: {
        sensorId: deleted.sensorId,
        firstIp: deleted.firstIp,
        lastIp: deleted.lastIp,
        firstSeen: deleted.firstSeen?.toISOString() ?? null,
        lastSeen: deleted.lastSeen?.toISOString() ?? null,
      },
    });

    return { outcome: 'forgotten', sensorId: deleted.sensorId };
  });
}
