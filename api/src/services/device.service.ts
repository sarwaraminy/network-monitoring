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
 * Scoped to one sensor, defaulting to this one. Deleting every sensor's row for an
 * address would be a different act than the button asks for: it would re-arm
 * new-device detection on segments the operator is not looking at, and on a
 * single-sensor installation — which is every installation that has not set
 * SENSOR_ID — the default makes this behave exactly as it did before.
 *
 * Audited in the same transaction, with what was known about it: the addresses and
 * when it was first and last seen are the whole of what the row held, and after the
 * delete this entry is the only place they survive. The sensor is recorded too,
 * because "device aa:bb:cc was forgotten" no longer identifies a single row.
 */
export async function forgetDevice(
  macAddress: string,
  actor: Actor,
  sensor: string = env.sensorId,
): Promise<boolean> {
  const mac = macAddress.toLowerCase();

  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(knownDevices)
      .where(and(eq(knownDevices.sensorId, sensor), eq(knownDevices.macAddress, mac)))
      .returning({
        sensorId: knownDevices.sensorId,
        mac: knownDevices.macAddress,
        firstIp: knownDevices.firstIp,
        lastIp: knownDevices.lastIp,
        firstSeen: knownDevices.firstSeen,
        lastSeen: knownDevices.lastSeen,
      });

    if (!deleted) return false;

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

    return true;
  });
}
