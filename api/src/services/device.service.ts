import { desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type KnownDeviceRow, knownDevices } from '../db/schema.js';

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

export async function forgetDevice(macAddress: string): Promise<boolean> {
  const deleted = await db
    .delete(knownDevices)
    .where(sql`${knownDevices.macAddress} = ${macAddress.toLowerCase()}`)
    .returning({ mac: knownDevices.macAddress });
  return deleted.length > 0;
}
