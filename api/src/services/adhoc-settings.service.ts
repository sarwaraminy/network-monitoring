import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type NewAdhocSettingsRow, adhocSettings as table } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import {
  ADHOC_FIELDS,
  type AdhocField,
  type AdhocResolution,
  type AdhocSettings,
  adhocEnvironmentSource,
  effectiveAdhocSettings,
  resolveAdhocSettings,
  type StoredAdhocSettings,
} from './adhoc-settings.js';

const log = componentLogger('adhoc-settings');

/**
 * The stored half of the query console's settings.
 *
 * Cached, because the resolved values are read on the query path — the row cap
 * and the statement timeout are consulted for every statement — and a database
 * round trip to find out how many rows to allow would be a strange thing to do
 * per query. The cache is refreshed on load and on save, and nothing else writes
 * this row, so it cannot go stale behind our back within one process.
 *
 * There is no import of `adhoc.service` here, deliberately: that module reads
 * these values, so a dependency back the other way would be a cycle. Restarting
 * the pool after a change is therefore the route's job, which is also where the
 * decision "did this change require a restart?" belongs.
 */

const ROW_ID = 1;

/** Resolved with an empty row until the first load, so a read before it is safe. */
let resolution: AdhocResolution = resolveAdhocSettings(adhocEnvironmentSource(), {});
let settings: AdhocSettings = effectiveAdhocSettings(resolution);

export function currentAdhocResolution(): AdhocResolution {
  return resolution;
}

/** The values, for the code that only needs to know what applies. */
export function currentAdhocSettings(): AdhocSettings {
  return settings;
}

/** Reads the row and re-resolves. Falls back to environment-and-defaults if it cannot. */
export async function loadAdhocSettings(): Promise<AdhocSettings> {
  try {
    const [row] = await db.select().from(table).where(eq(table.id, ROW_ID)).limit(1);
    const stored: StoredAdhocSettings = row
      ? {
          enabled: row.enabled,
          writeEnabled: row.writeEnabled,
          timeoutMs: row.timeoutMs,
          maxRows: row.maxRows,
          maxQueryLength: row.maxQueryLength,
          audit: row.audit,
          dbPassword: row.dbPassword,
        }
      : {};

    resolution = resolveAdhocSettings(adhocEnvironmentSource(), stored);
  } catch (error) {
    /*
     * The console is optional and off by default, so a settings read that fails
     * must not take the process down — but it must not silently invent a
     * configuration either. Falling back to environment-and-defaults is the same
     * answer the process had before this table existed, which is the only safe
     * one available: it can never turn the console ON where the row would have
     * left it off, because the row is what is unreadable.
     */
    log.error(
      { err: error },
      'Could not read the query console settings; using the environment and defaults',
    );
    resolution = resolveAdhocSettings(adhocEnvironmentSource(), {});
  }

  settings = effectiveAdhocSettings(resolution);
  return settings;
}

/**
 * Writes the fields in `patch` and re-resolves.
 *
 * `null` clears a field, so it falls back to the environment or the default —
 * the same meaning as in the delivery settings, and the reason every column is
 * nullable. Pinned fields are refused by the route before this is called; this
 * function does not re-check, because a caller that wants to write a pinned
 * field has already been told no and the row would be ignored anyway on the next
 * resolve.
 */
export async function saveAdhocSettings(
  patch: Partial<NewAdhocSettingsRow>,
  actor: string,
): Promise<AdhocSettings> {
  const values = { ...patch, updatedAt: new Date(), updatedBy: actor.slice(0, 200) };

  await db
    .insert(table)
    .values({ id: ROW_ID, ...values })
    .onConflictDoUpdate({ target: table.id, set: values });

  return loadAdhocSettings();
}

/**
 * Copies the environment into the row on first boot.
 *
 * Without this, an installation that had configured the console entirely through
 * environment variables would see every field in the interface reading "from the
 * environment" and be unable to change any of them — technically correct and
 * useless. Seeding means the row starts as a copy of what is already in force,
 * so deleting an environment line later keeps the behaviour rather than reverting
 * it to a default nobody chose.
 *
 * Per field, and only where the row has nothing: a value an administrator has
 * already chosen is never overwritten by an environment variable that has since
 * appeared.
 */
export async function seedAdhocSettingsFromEnvironment(): Promise<AdhocField[]> {
  const source = adhocEnvironmentSource();
  const seeded: AdhocField[] = [];

  const fresh = resolveAdhocSettings(source, {});
  for (const field of Object.keys(ADHOC_FIELDS) as AdhocField[]) {
    if (fresh[field].source !== 'environment') continue;

    const column = table[field];
    // One column at a time, so the key is computed — which is as far as the row
    // type can be checked here. The value came from `resolveAdhocSettings`, so it
    // is already the right shape for its column.
    const one = { [field]: fresh[field].value } as Partial<NewAdhocSettingsRow>;
    const { rowCount } = await db
      .insert(table)
      .values({ id: ROW_ID, ...one })
      .onConflictDoUpdate({
        target: table.id,
        set: one,
        // Only where nobody has chosen: an administrator's value outranks an
        // environment variable that showed up afterwards.
        setWhere: sql`${column} IS NULL`,
      });

    if ((rowCount ?? 0) > 0) seeded.push(field);
  }

  if (seeded.length > 0) {
    log.info(
      { fields: seeded.map((field) => ADHOC_FIELDS[field].env) },
      'Copied query console settings from the environment into the database',
    );
  }

  await loadAdhocSettings();
  return seeded;
}
