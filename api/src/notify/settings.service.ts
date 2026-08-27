import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type DeliverySettingsRow, deliverySettings, type NewDeliverySettingsRow } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import {
  DELIVERY_FIELDS,
  type DeliveryField,
  type DeliveryResolution,
  type DeliverySettings,
  effectiveSettings,
  isSecretField,
  type RedactedField,
  redactForApi,
  resolveDeliverySettings,
  type StoredDeliverySettings,
} from './settings.js';

const log = componentLogger('delivery-settings');

/**
 * Storage and caching for delivery settings.
 *
 * The resolution rules live in settings.ts, which imports no database so they can be
 * tested against plain objects. This module is the part that has to talk to Postgres
 * and hold an answer in memory, because the notifier reads its settings once at
 * construction and every notification is measured against that held copy.
 *
 * Deliberately does NOT import the notifier. Rebuilding it after a save is the
 * caller's job — the route's — because a settings module that reaches into the
 * notifier and a notifier that reads the settings module is an import cycle, and the
 * one thing worse than doing it in two places is doing it in a circle.
 */

/** The single row's primary key. There is only ever one. */
const ROW_ID = 1;

let cached: DeliveryResolution | null = null;

/**
 * The settings in force. Synchronous, so the notifier's constructor can use it.
 *
 * Falls back to environment-and-defaults only when nothing has been loaded yet,
 * which is the state before `loadDeliverySettings()` runs at boot. That fallback is
 * the pre-existing behaviour exactly — env over defaults, no stored layer — so a
 * notifier built before the first load behaves as it did before this table existed
 * rather than behaving as if delivery were unconfigured.
 */
export function currentResolution(): DeliveryResolution {
  return cached ?? resolveDeliverySettings(process.env, {});
}

export function currentSettings(): DeliverySettings {
  return effectiveSettings(currentResolution());
}

/** The API-safe view: every field with its provenance, secrets reduced to a boolean. */
export function currentRedactedSettings(): Record<string, RedactedField> {
  return redactForApi(currentResolution());
}

/** Reads the row and recomputes the resolution. Resolves to what is now in force. */
export async function loadDeliverySettings(): Promise<DeliverySettings> {
  try {
    const stored = await readRow();
    cached = resolveDeliverySettings(process.env, stored);
    log.debug('Delivery settings loaded');
  } catch (error) {
    // Keep whatever was already in force. A database blip must not silently switch
    // delivery off, and it must not switch it *on* either — the previous answer is
    // the only safe one.
    log.error({ err: error }, 'Could not load delivery settings; keeping the previous set');
  }
  return currentSettings();
}

/** Drops the cache. For tests, and for a reset. */
export function resetDeliverySettingsCache(): void {
  cached = null;
}

async function readRow(): Promise<StoredDeliverySettings> {
  const [row] = await db.select().from(deliverySettings).where(eq(deliverySettings.id, ROW_ID)).limit(1);

  return row ? toStored(row) : {};
}

/** The row, as the field-keyed shape the resolver expects. */
function toStored(row: DeliverySettingsRow): StoredDeliverySettings {
  const stored: StoredDeliverySettings = {};
  for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
    const value = (row as Record<string, unknown>)[field];
    if (value !== null && value !== undefined) stored[field] = value;
  }
  return stored;
}

/**
 * Writes the environment's current values into the row, for fields the row has not
 * got an opinion about yet.
 *
 * Runs once at boot and exists for one scenario: an operator who has been running
 * with `NOTIFY_MIN_SEVERITY=critical` in `api/.env` for a year, upgrades, and later
 * removes that line. Without seeding, the setting would silently revert to the code
 * default of `high` and they would start getting alerts they had deliberately
 * switched off. With it, the row remembers what they had been running.
 *
 * Only fills what is NULL, so it can never overwrite something set through the UI —
 * this runs on every boot, and an operator's saved value must survive a restart.
 * Secrets are seeded too: leaving them out would mean removing `NOTIFY_WEBHOOK_URL`
 * silently stops delivery, which is the same failure in a worse place.
 */
export async function seedFromEnvironment(): Promise<DeliveryField[]> {
  const seeded: DeliveryField[] = [];

  try {
    const stored = await readRow();
    // Built as a loose record and narrowed once below. Each value comes from the
    // resolver, which returns the type the column is declared with, so the cast is
    // sound in a way the loop cannot express field by field.
    const patch: Record<string, unknown> = {};

    for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
      if (stored[field] !== undefined) continue;

      const spec = DELIVERY_FIELDS[field];
      const raw = process.env[spec.env];
      // Blank counts as unset, matching env.ts. Nothing to remember.
      if (raw === undefined || raw.trim() === '') continue;

      const resolution = resolveDeliverySettings({ [spec.env]: raw }, {});
      if (resolution[field].source !== 'environment') continue;

      patch[field] = resolution[field].value;
      seeded.push(field);
    }

    if (seeded.length === 0) return [];

    const typed = patch as Partial<NewDeliverySettingsRow>;
    await db
      .insert(deliverySettings)
      .values({ id: ROW_ID, ...typed, updatedBy: 'environment (first boot)' })
      .onConflictDoUpdate({ target: deliverySettings.id, set: typed });

    log.info(
      // Field names only. The values include a webhook URL and an SMTP password.
      {
        fields: seeded.filter((field) => !isSecretField(field)),
        secrets: seeded.filter(isSecretField).length,
      },
      'Seeded delivery settings from the environment',
    );
  } catch (error) {
    log.error({ err: error }, 'Could not seed delivery settings from the environment');
  }

  return seeded;
}

/**
 * Applies a patch to the row and reloads the cache.
 *
 * A field set to null clears it, which is how "fall back to the environment or the
 * default" is expressed. A field absent from the patch is left alone — that is what
 * lets the form omit a secret it is not changing, rather than having to round-trip a
 * value the API deliberately never sends it.
 */
export async function saveDeliverySettings(
  patch: Partial<NewDeliverySettingsRow>,
  updatedBy: string,
): Promise<DeliverySettings> {
  const values = { ...patch, updatedAt: new Date(), updatedBy: updatedBy.slice(0, 200) };

  await db
    .insert(deliverySettings)
    .values({ id: ROW_ID, ...values })
    .onConflictDoUpdate({ target: deliverySettings.id, set: values });

  return loadDeliverySettings();
}
