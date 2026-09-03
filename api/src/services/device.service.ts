import { desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type KnownDeviceRow, knownDevices } from '../db/schema.js';
import { type Actor, recordAudit } from './audit.service.js';

/**
 * Persists the MAC addresses seen on the network, so "new device" means new to
 * the network rather than new since the last restart.
 */

export async function loadKnownMacAddresses(): Promise<string[]> {
  const rows = await db.select({ mac: knownDevices.macAddress }).from(knownDevices);
  return rows.map((row) => row.mac);
}

export async function listKnownDevices(): Promise<KnownDeviceRow[]> {
  return db.select().from(knownDevices).orderBy(desc(knownDevices.lastSeen));
}

/** Inserts a device, or refreshes `last_seen`/`last_ip` if it is already known. */
export async function recordDevice(macAddress: string, ipAddress: string | null): Promise<void> {
  const mac = macAddress.toLowerCase();
  const now = new Date();

  await db
    .insert(knownDevices)
    .values({ macAddress: mac, firstIp: ipAddress, lastIp: ipAddress, firstSeen: now, lastSeen: now })
    .onConflictDoUpdate({
      target: knownDevices.macAddress,
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
 * Audited in the same transaction, with what was known about it: the addresses and
 * when it was first and last seen are the whole of what the row held, and after the
 * delete this entry is the only place they survive.
 */
export async function forgetDevice(macAddress: string, actor: Actor): Promise<boolean> {
  const mac = macAddress.toLowerCase();

  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(knownDevices)
      .where(sql`${knownDevices.macAddress} = ${mac}`)
      .returning({
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
        firstIp: deleted.firstIp,
        lastIp: deleted.lastIp,
        firstSeen: deleted.firstSeen?.toISOString() ?? null,
        lastSeen: deleted.lastSeen?.toISOString() ?? null,
      },
    });

    return true;
  });
}
