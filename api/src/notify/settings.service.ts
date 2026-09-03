import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type DeliverySettingsRow, deliverySettings, type NewDeliverySettingsRow } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { recordAudit } from '../services/audit.service.js';
import {
  DELIVERY_FIELDS,
  type DeliveryField,
  type DeliveryResolution,
  type DeliverySettings,
  effectiveSettings,
  invalidEnvironmentVariables,
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

    // A rejection here is deliberately not fatal — see parseFieldValue's
    // docblock — but env.ts's crash-on-boot behaviour for the same bad values
    // at least left a trace. This is what replaces it: not a crash, but not
    // silence either.
    const invalid = invalidEnvironmentVariables(process.env);
    if (invalid.length > 0) {
      log.warn(
        { variables: invalid },
        'These environment variables do not parse and are being ignored; using the stored or default value instead',
      );
    }
  } catch (error) {
    // Keep whatever was already in force. A database blip must not silently switch
    // delivery off, and it must not switch it *on* either — the previous answer is
    // the only safe one.
    log.error({ err: error }, 'Could not load delivery settings; keeping the previous set');
  }
  return currentSettings();
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

    // One UPDATE per field rather than a single batched statement. The parser above
    // is deliberately as lenient as the env.ts parser it replaces — a legacy value
    // like a negative NOTIFY_MAX_PER_HOUR still resolves as 'environment' and still
    // takes effect — but the row's CHECK constraints are tighter (max_per_hour >= 1,
    // ports in range, and so on). A single value tripping a constraint must not cost
    // every other field this boot was meant to preserve, and it already had: this
    // used to be one insert covering the whole patch, so one bad legacy value threw
    // and silently dropped the rest.
    const applied: DeliveryField[] = [];
    for (const field of seeded) {
      const spec = DELIVERY_FIELDS[field];
      const values = {
        [field]: patch[field],
        updatedBy: 'environment (first boot)',
      } as Partial<NewDeliverySettingsRow>;
      try {
        const result = await db.update(deliverySettings).set(values).where(eq(deliverySettings.id, ROW_ID));
        // The migration's own seed insert is what's supposed to guarantee this
        // row exists, but that is a different code path (SQL migration, not
        // this one) — an install that reached the schema some other way (a
        // push rather than a migration run, or a hand-deleted row) would have
        // this UPDATE match nothing, throw nothing, and fall straight through
        // to "seeded" below, logging success for a write that never happened.
        if (result.rowCount === 0) {
          log.warn(
            { field, variable: spec.env },
            'No delivery_settings row to update; the environment still applies, but nothing was persisted',
          );
          continue;
        }
        applied.push(field);
      } catch (error) {
        /*
         * The variable's name, not the field key — the same distinction the 409
         * conflict message needed. An operator reading `syslogAppName` has nothing
         * to search for; `SYSLOG_APP_NAME` is a line in their file.
         *
         * And it spells out the consequence, because this is the one case where
         * this feature's promise cannot be kept. The parser is deliberately as
         * lenient as the env.ts parser it replaces, so a legacy value outside the
         * row's CHECK bounds — a pre-existing NOTIFY_MAX_PER_HOUR=0, a mistyped
         * SYSLOG_FACILITY=99 — still takes effect from the environment and still
         * cannot be stored. So "delete the line later and your behaviour is
         * preserved" is false for exactly these values, and the only honest
         * response is to say so at the moment it happens rather than let the
         * operator discover it on the boot after they tidy the file.
         */
        log.warn(
          { field, variable: spec.env, err: error },
          `Value of ${spec.env} cannot be stored (it is outside the limits this table enforces). ` +
            'It still applies while the variable is set — but the row cannot remember it, so removing ' +
            'that line later will revert this setting to its default rather than preserving it.',
        );
      }
    }
    seeded.length = 0;
    seeded.push(...applied);

    if (seeded.length > 0) {
      log.info(
        // Field names only. The values include a webhook URL and an SMTP password.
        {
          fields: seeded.filter((field) => !isSecretField(field)),
          secrets: seeded.filter(isSecretField).length,
        },
        'Seeded delivery settings from the environment',
      );
    }
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

  await db.transaction(async (tx) => {
    await tx
      .insert(deliverySettings)
      .values({ id: ROW_ID, ...values })
      .onConflictDoUpdate({ target: deliverySettings.id, set: values });

    /*
     * Field *names*, never values.
     *
     * These settings hold the webhook URL and the SMTP password, and an audit trail
     * that recorded them would be a second place to read credentials — one that
     * cannot be pruned, and that an administrator can read in full. The API redacts
     * them for the same reason. "Changed notify_webhook_url and smtp_password" is
     * the accountable fact; their contents are not.
     */
    await recordAudit(tx, {
      actor: updatedBy,
      action: 'delivery_settings.update',
      detail: { fields: Object.keys(patch).sort() },
    });
  });

  return loadDeliverySettings();
}
