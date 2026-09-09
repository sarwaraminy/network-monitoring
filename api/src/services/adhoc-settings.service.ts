import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type AdhocSettingsRow, type NewAdhocSettingsRow, adhocSettings as table } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import {
  ADHOC_FIELDS,
  type AdhocField,
  type AdhocResolution,
  type AdhocSettings,
  adhocEnvironmentSource,
  effectiveAdhocSettings,
  invalidAdhocEnvironmentVariables,
  resolveAdhocSettings,
  type StoredAdhocSettings,
} from './adhoc-settings.js';
import type { AuditWriter } from './audit.service.js';

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

  /*
   * Logged after the resolve, so it reports what was actually ignored rather
   * than what merely looked wrong. Not fatal, for the reason `parseFieldValue`
   * gives — but not silent either, which is the half that was missing. Same
   * shape as the delivery warning in `notify/settings.service.ts`.
   */
  const invalid = invalidAdhocEnvironmentVariables(adhocEnvironmentSource());
  if (invalid.length > 0) {
    log.warn(
      { variables: invalid },
      'These environment variables do not parse and are being ignored; using the stored or default value instead',
    );
  }

  return settings;
}

/**
 * The subset of `patch` whose value actually differs from what is stored.
 *
 * `Object.keys(patch).length > 0` is not this check: a `PUT` resubmitting values
 * that already match — a form re-saved with nothing edited — has a non-empty
 * patch and no real change. `changedFields` in `notify/settings.service.ts`
 * draws the same distinction for the same reason, and `ruleChanges` does it for
 * a suppression rule.
 *
 * `current` is `undefined` before any row exists, so on the first save every
 * field of the patch is new against nothing and the whole patch counts.
 *
 * Every column here is a scalar — no `emailTo`-style array — so `!==` is the
 * whole comparison, and `null` on both sides is correctly unchanged.
 *
 * Exported so a test can assert the diff without a database, rather than
 * trusting the call site to have got it right.
 */
export function changedAdhocFields(
  current: AdhocSettingsRow | undefined,
  patch: Partial<NewAdhocSettingsRow>,
): Partial<NewAdhocSettingsRow> {
  if (!current) return patch;

  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const before = current[key as keyof AdhocSettingsRow];
    const after = patch[key as keyof NewAdhocSettingsRow];
    if (before !== after) changed[key] = after;
  }

  return changed as Partial<NewAdhocSettingsRow>;
}

/**
 * Writes the fields in `patch` that actually changed, records them, and
 * re-resolves.
 *
 * `null` clears a field, so it falls back to the environment or the default —
 * the same meaning as in the delivery settings, and the reason every column is
 * nullable. Pinned fields are refused by the route before this is called; this
 * function does not re-check, because a caller that wants to write a pinned
 * field has already been told no and the row would be ignored anyway on the next
 * resolve.
 *
 * **`audit` runs inside the write's transaction**, which is why it is a
 * parameter rather than something the route does afterwards. The write used to
 * commit on its own with `recordAudit(db, …)` following it, so anything failing
 * in between — a constraint on `audit_events`, a pool timeout, the process being
 * stopped — left the console enabled and nothing recording who did it. That is
 * the one question this particular trail exists to answer.
 * `saveDeliverySettings` and `setUserRole` both thread the transaction, and
 * `setUserRole`'s docblock puts it plainly: a trail that can be committed
 * without the act it records is worse than none.
 *
 * **Nothing is written when nothing changed.** Every field of the patch schema
 * is optional, so `PUT {}` parses — and without a diff it bumped `updated_at`,
 * overwrote `updated_by` with whoever sent it, and appended `{changed: {}}` to a
 * table that is append-only by trigger and outside retention's reach. A no-op
 * save must not reattribute the last real change to somebody who pressed Save
 * without editing anything.
 *
 * This used to note that it went a step further than the delivery path, which
 * skipped only the audit entry and still ran the upsert. That was the gap rather
 * than the difference, and `saveDeliverySettings` closes it the same way now.
 */
export async function saveAdhocSettings(
  patch: Partial<NewAdhocSettingsRow>,
  actor: string,
  audit?: (writer: AuditWriter, changed: Partial<NewAdhocSettingsRow>) => Promise<void>,
): Promise<AdhocSettings> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(table).where(eq(table.id, ROW_ID)).limit(1);
    const changed = changedAdhocFields(current, patch);
    if (Object.keys(changed).length === 0) return;

    const values = { ...changed, updatedAt: new Date(), updatedBy: actor.slice(0, 200) };
    await tx
      .insert(table)
      .values({ id: ROW_ID, ...values })
      .onConflictDoUpdate({ target: table.id, set: values });

    // Only the fields that moved, not the whole patch — the same choice the
    // delivery trail makes, so a resubmitted form does not read as a change to
    // everything it happened to contain.
    if (audit) await audit(tx, changed);
  });

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

  /*
   * The load is deliberately NOT done here.
   *
   * It used to be, and `index.ts` now calls it separately for a reason that
   * docblock spells out: a transient failure anywhere in the loop above rejected
   * this whole function, so the load never ran and the process held
   * environment-and-defaults for its lifetime. With both, the boot read the row
   * twice — and re-emitted the invalid-variable warning with it, so a single
   * mistyped `ADHOC_TIMEOUT_MS` printed two identical lines, which reads as two
   * different variables being wrong.
   *
   * `seedFromEnvironment` on the delivery side ends the same way, and that is
   * what `index.ts` means when it says the two paths agree.
   */
  return seeded;
}
