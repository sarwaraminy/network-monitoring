import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type FlowSettingsRow, type NewFlowSettingsRow, flowSettings as table } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { HttpError } from '../middleware/error-handler.js';
import type { Actor, AuditWriter } from './audit.service.js';
import { recordAudit } from './audit.service.js';
import {
  effectiveFlowSettings,
  exporterList,
  FLOW_FIELDS,
  type FlowField,
  type FlowResolution,
  type FlowSettings,
  invalidFlowEnvironmentVariables,
  resolveFlowSettings,
  type StoredFlowSettings,
} from './flow-settings.js';

const log = componentLogger('flow-settings');

/**
 * The stored half of the flow collector's settings.
 *
 * Cached, because `isAllowed` consults the exporter list for every datagram and a
 * database round trip per datagram would be a strange thing to do on the path
 * this application is built to keep fast. Refreshed on load and on save, and
 * nothing else writes this row, so it cannot go stale behind our back within one
 * process.
 *
 * No import of `flow/collector.js` here, deliberately: the collector reads these
 * values, so a dependency back would be a cycle. Deciding whether a change needs
 * the socket reopened, and doing it, is therefore the route's job — which is also
 * where that decision belongs, since it is the caller who knows a person is
 * waiting for an answer.
 */

const ROW_ID = 1;

/** The variables, read at call time so a test can change them before the first load. */
export function flowEnvironmentSource(): Record<string, string | undefined> {
  return process.env;
}

/** Resolved with an empty row until the first load, so a read before it is safe. */
let resolution: FlowResolution = resolveFlowSettings(flowEnvironmentSource(), {});
let settings: FlowSettings = effectiveFlowSettings(resolution);
/**
 * The allowlist, parsed once per settings change rather than per datagram.
 *
 * `isAllowed` runs on the hot path — NetFlow on a busy segment is thousands of
 * datagrams a second — and it sits *ahead* of the cheap reject that is supposed
 * to make an unlisted exporter free to ignore. Splitting and trimming a string
 * there undoes that: the collector's whole reason for existing is volume.
 *
 * Cached here rather than captured at boot, because these settings change at
 * runtime now; `loadFlowSettings` is the one place that re-resolves, so it is the
 * one place this has to be refreshed.
 */
let allowed: string[] = exporterList(settings);

export function currentFlowResolution(): FlowResolution {
  return resolution;
}

/** The values, for the code that only needs to know what applies. */
export function currentFlowSettings(): FlowSettings {
  return settings;
}

const storedFrom = (row: FlowSettingsRow | undefined): StoredFlowSettings =>
  row ? { enabled: row.enabled, port: row.port, bindAddress: row.bindAddress, exporters: row.exporters } : {};

/**
 * Whether the cached resolution is known not to reflect the row.
 *
 * Set when a read fails and cleared when one succeeds. Without it a failure at
 * boot was permanent: nothing re-read, so an API that started a few seconds ahead
 * of Postgres — an ordinary ordering, and the normal one with
 * `DB_AUTO_MIGRATE=false` — held environment-and-defaults for its whole lifetime.
 * The collector stayed off while the row said `enabled = true`, and the settings
 * form reported every field as `source: 'default'` over stored values anyone
 * could see in the database.
 *
 * That last part is the reason this is worth a flag rather than a log line. A row
 * and a `source` that disagree is the one failure `flow-settings.ts` says the
 * three layers exist to make impossible.
 */
let stale = false;

/** Reads the row and re-resolves. Throws if it cannot — see the callers below. */
async function readAndResolve(): Promise<void> {
  const [row] = await db.select().from(table).where(eq(table.id, ROW_ID)).limit(1);
  resolution = resolveFlowSettings(flowEnvironmentSource(), storedFrom(row));
  stale = false;
}

/** Publishes whatever is in `resolution` to the caches the hot path reads. */
function applyResolution(): FlowSettings {
  settings = effectiveFlowSettings(resolution);
  allowed = exporterList(settings);

  /*
   * Logged after the resolve, so it reports what was actually ignored rather than
   * what merely looked wrong. Not fatal, for the reason `parseFlowField` gives —
   * but not silent either, which is the half that was missing. Same shape as the
   * adhoc and delivery warnings.
   */
  const invalid = invalidFlowEnvironmentVariables(flowEnvironmentSource());
  if (invalid.length > 0) {
    log.warn(
      { variables: invalid },
      'These environment variables do not parse and are being ignored; using the stored or default value instead',
    );
  }

  return settings;
}

/**
 * Reads the row and re-resolves, falling back to environment-and-defaults if it
 * cannot. **For boot, and only for boot.**
 *
 * Tolerant because the alternative is worse there: a database that cannot be read
 * at boot would stop the collector binding, so an installation would lose flow
 * telemetry over a settings table it could run perfectly well without.
 *
 * That argument does not survive being reused after a write, which is what
 * `refreshFlowSettings` is for. Keeping the previous resolution on a read failure
 * is "carry on with what we had" at boot and "silently claim the save took
 * effect" after one — same code, opposite meanings, because after a write the
 * stale value is precisely the one the caller is about to compare against.
 */
export async function loadFlowSettings(): Promise<FlowSettings> {
  try {
    await readAndResolve();
  } catch (error) {
    // Warn and keep whatever was resolved before, which on a first load is the
    // environment and the defaults. Marked stale so the next reader retries
    // rather than serving this for the lifetime of the process.
    stale = true;
    log.warn({ err: error }, 'Could not read the flow settings; using the environment and defaults');
  }

  return applyResolution();
}

/**
 * The resolution, having retried first if the last read failed.
 *
 * For `GET /settings`, which is the one place a person is explicitly asking what
 * this installation is configured to do — so it is also the natural place to
 * notice that the answer in memory was never actually read from anywhere. A boot
 * that could not reach the database used to be permanent: the form showed
 * `source: 'default'` over stored values, and the only way out was a restart,
 * which is the shell access this whole feature exists to stop needing.
 *
 * Retried here rather than on a timer because this is where it matters and where
 * somebody is waiting for the answer; a background retry would also work and is
 * more machinery for the same result. A retry that fails again serves what we
 * have, since a settings form that will not open is worse than one reporting the
 * layer it fell back to.
 *
 * Recovery is more than cosmetic: `applyResolution` republishes `currentFlowSettings`,
 * so a collector that stayed off because its row was unreadable now reads as
 * "should be listening and is not" — which is what makes the retry button appear.
 */
export async function flowResolutionWithRecovery(): Promise<FlowResolution> {
  if (!stale) return resolution;

  try {
    await readAndResolve();
    applyResolution();
    log.info('Re-read the flow settings after an earlier failure; the cached values were stale');
  } catch (error) {
    log.warn({ err: error }, 'Flow settings are still unreadable; serving the environment and defaults');
  }

  return resolution;
}

/**
 * The same read, propagating the failure. For the path after a write.
 *
 * `saveFlowSettings` decides `needsRebind` by diffing the resolution before the
 * write against the one after it, and the route decides whether the collector is
 * stalled from the same place. Swallowing the read left both comparing the old
 * resolution against itself: nothing differs, so nothing needs rebinding, the
 * response says "Saved, and in force", and the collector goes on serving the old
 * port and the old allowlist out of a cache until somebody restarts the API.
 *
 * Every piece of evidence available to the administrator agrees with the lie. The
 * write committed, the form confirmed it, and reopening the settings shows the
 * new values, because that reads the row rather than the cache.
 */
async function refreshFlowSettings(): Promise<FlowSettings> {
  await readAndResolve();
  return applyResolution();
}

/**
 * The permitted senders, already parsed.
 *
 * Returned as the live array rather than a copy: this is read per datagram, and
 * allocating one there would be the cost this cache exists to remove. Nothing
 * mutates it — `loadFlowSettings` replaces the binding instead — and the one
 * caller only ever asks whether it contains an address.
 */
export function currentAllowedExporters(): readonly string[] {
  return allowed;
}

/**
 * Fields the seed will not copy, and why there is exactly one.
 *
 * `docker-compose.flow.yml` hard-pins `FLOW_ENABLED: 'true'` — not passed through
 * like the others, but written into the overlay, because switching collection on
 * *is* what that file is for. It publishes the UDP port in the same breath, and
 * its own header says the two "belong together, in here".
 *
 * Seeding that value would quietly take the off switch away from the deployment
 * that has the overlay. The first boot writes `enabled = true` into the row, and
 * from then on the row carries it independently of the file. An operator who
 * removes the overlay to stop collecting — which is what removing it is *for* —
 * gets a collector that keeps its socket open on a value from a file they
 * deleted, shown in the form as an ordinary editable setting with nothing
 * anywhere connecting the two. The published port is gone, so nothing arrives
 * either: a listening collector receiving nothing, which is the exact symptom
 * this feature's whole diagnosis panel exists to explain.
 *
 * The other three are settings an administrator should inherit and then own. A
 * port or a bind address or an allowlist is a preference; `enabled` is a
 * deployment decision, and the deployment is entitled to take it back by removing
 * the file that made it.
 *
 * Not applied to `seedAdhocSettingsFromEnvironment`, which has the same shape and
 * an `enabled` of its own. Nothing shipped pins `ADHOC_ENABLED` — `docker-compose.yml`
 * passes it through blank — so the only way its seed fires is an operator setting
 * the variable in their own `api/.env`, and deleting your own line is a different
 * act from deleting an overlay that pins four things at once. The argument still
 * half applies there and is worth a look on its own; changing it from a branch
 * about flow would be a behaviour change nobody reviewed.
 */
const NEVER_SEEDED: readonly FlowField[] = ['enabled'];

/**
 * Copies the environment into the row, once, per field it has nothing for.
 *
 * Without this, an installation that configured flow entirely through environment
 * variables would see every field reading "from the environment" and be unable to
 * change any of them — technically correct and useless. Seeding means the row
 * starts as a copy of what is already in force, so deleting an environment line
 * later keeps the behaviour rather than reverting it to a default nobody chose.
 *
 * Only where the row has nothing: a value an administrator has already chosen is
 * never overwritten by an environment variable that has since appeared. Same rule
 * and same reasoning as `seedAdhocSettingsFromEnvironment` — except for
 * `NEVER_SEEDED` above, where keeping the behaviour is the bug rather than the
 * point.
 */
export async function seedFlowSettingsFromEnvironment(): Promise<FlowField[]> {
  const fresh = resolveFlowSettings(flowEnvironmentSource(), {});
  const seeded: FlowField[] = [];

  for (const field of Object.keys(FLOW_FIELDS) as FlowField[]) {
    if (NEVER_SEEDED.includes(field)) continue;
    if (fresh[field].source !== 'environment') continue;

    const column = table[field];
    const one = { [field]: fresh[field].value } as Partial<NewFlowSettingsRow>;
    const { rowCount } = await db
      .insert(table)
      .values({ id: ROW_ID, ...one })
      .onConflictDoUpdate({
        target: table.id,
        set: one,
        // Only where nobody has chosen.
        setWhere: sql`${column} IS NULL`,
      });

    if ((rowCount ?? 0) > 0) seeded.push(field);
  }

  if (seeded.length > 0) {
    log.info(
      { fields: seeded.map((field) => FLOW_FIELDS[field].env) },
      'Copied flow settings from the environment into the settings row',
    );
  }

  return seeded;
}

export interface FlowSaveResult {
  settings: FlowSettings;
  /**
   * Whether anything was actually written.
   *
   * False for a patch that resubmits what is already stored — which the form can
   * produce without anybody doing anything odd: clear a field, it falls back to
   * its default, clear it again, and the patch is `null` over a column that is
   * already NULL. Reported so the interface can say "nothing changed" rather than
   * "Saved, and in force", which is the one answer that is untrue.
   */
  changed: boolean;
  /**
   * Whether the socket has to be closed and reopened for this to take effect.
   *
   * `exporters` is a filter test per datagram, so it applies the moment the cache
   * is refreshed. The other three are properties of a bound socket and are not
   * changeable on one — which is the whole reason this flag exists rather than
   * the route restarting unconditionally: reopening a socket drops whatever is
   * in flight, and doing that because somebody edited an allowlist would be a
   * cost nobody asked for.
   */
  needsRebind: boolean;
  /**
   * Whether the allowlist itself moved.
   *
   * Separate from `needsRebind` because it is the field that deliberately does
   * *not* reopen the socket — but the refusal counter was counted against the
   * list that has just been replaced, and a counter nobody resets goes on being
   * attributed to a list it never saw. See `resetRefusals` on the collector.
   */
  allowlistChanged: boolean;
}

/** Which fields cannot be applied to a socket that is already bound. */
const REBIND_FIELDS: readonly FlowField[] = ['enabled', 'port', 'bindAddress'];

/**
 * The subset of `patch` whose value actually differs from the stored row.
 *
 * `Object.keys(patch).length > 0` is not this check: a `PUT` resubmitting values
 * that already match — a form re-saved with nothing edited, or the retry the
 * route allows when the collector is stalled — has a non-empty patch and no real
 * change. `changedAdhocFields` draws the same distinction for the same reason.
 *
 * `current` is `undefined` before any row exists, so on the first save every
 * field is new against nothing and the whole patch counts.
 *
 * Exported so a test can assert the diff without a database, rather than
 * trusting the call site to have got it right.
 */
export function changedFlowFields(
  current: FlowSettingsRow | undefined,
  patch: Partial<NewFlowSettingsRow>,
): Partial<NewFlowSettingsRow> {
  if (!current) return patch;

  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const before = current[key as keyof FlowSettingsRow];
    const after = patch[key as keyof NewFlowSettingsRow];
    if (before !== after) changed[key] = after;
  }

  return changed as Partial<NewFlowSettingsRow>;
}

/**
 * Writes the fields that actually changed, records them, and re-resolves.
 *
 * The audit row shares the transaction with the write, as everything else in this
 * codebase does. Values are recorded rather than just field names — unlike the
 * delivery and console settings, none of these is a credential, and *which* port
 * and *which* allowlist is the entire content of the event. "Somebody changed the
 * exporters" without saying to what records nothing worth reading a year later.
 *
 * **Nothing is written when nothing changed**, matching `saveAdhocSettings` and
 * `saveDeliverySettings`. Without the diff a resubmitted form bumped
 * `updated_at`, overwrote `updated_by` with whoever pressed Save, and appended an
 * empty change to a table that is append-only by trigger and outside retention's
 * reach — so a no-op reattributed the last real change to somebody who edited
 * nothing. It matters more here than it did there, because the route deliberately
 * accepts an empty patch as "try binding again".
 */
export async function saveFlowSettings(patch: StoredFlowSettings, actor: Actor): Promise<FlowSaveResult> {
  const before = effectiveFlowSettings(resolution);

  let wrote = false;

  await db.transaction(async (tx) => {
    const values: Partial<NewFlowSettingsRow> = {};
    for (const field of Object.keys(FLOW_FIELDS) as FlowField[]) {
      if (field in patch) {
        // `null` clears the field, so it falls back to the environment and then
        // the default — the same meaning the column's NULL carries.
        (values as Record<string, unknown>)[field] = patch[field] ?? null;
      }
    }

    const [current] = await tx.select().from(table).where(eq(table.id, ROW_ID)).limit(1);
    const changed = changedFlowFields(current, values);
    if (Object.keys(changed).length === 0) return;
    wrote = true;

    const row = { ...changed, updatedAt: new Date(), updatedBy: actor.name.slice(0, 200) };
    await tx
      .insert(table)
      .values({ id: ROW_ID, ...row })
      .onConflictDoUpdate({ target: table.id, set: row });

    // Only the fields that moved, not the whole patch — so a resubmitted form
    // does not read as a change to everything it happened to contain.
    await recordAudit(tx as unknown as AuditWriter, {
      actor: actor.name,
      actorId: actor.id,
      action: 'flow_settings.update',
      detail: { ...(changed as Record<string, unknown>) },
    });
  });

  /*
   * The strict read, so a settings table that went unreadable between the commit
   * and here cannot be reported as a save that took effect.
   *
   * Raised as a 500 rather than left to the generic handler, because the generic
   * message ("something went wrong") would send the administrator to undo a
   * change that is in fact stored. What is true is narrower and worth saying: the
   * row was written and is what the next boot will use; what is running now is
   * whatever was running before. Restarting the API applies it.
   */
  try {
    await refreshFlowSettings();
  } catch (error) {
    if (wrote) {
      log.error({ err: error }, 'Flow settings were written but could not be read back; nothing was applied');
      throw HttpError.of(500, 'error.flow_saved_not_applied');
    }

    /*
     * Nothing was written, so there is nothing to misreport — and throwing here
     * broke the one control that recovers a bad bind.
     *
     * The retry button sends an EMPTY patch deliberately: that is how it reaches
     * the server at all, since a form whose values are already correct produces
     * no diff. On that path `wrote` is false, and raising "the setting was saved
     * and will be used the next time the API starts" describes a request that
     * saved nothing. Worse, the throw returns before the route's
     * `restartFlowCollector()`, so pressing the button to fix a failed bind
     * failed to rebind and reported it as a successful save.
     *
     * Carrying on with the resolution we have makes `after` equal `before`, so
     * `needsRebind` is false and the route falls through to its stalled check —
     * which is exactly the branch the retry is meant to reach.
     */
    stale = true;
    log.warn({ err: error }, 'Could not re-read the flow settings; nothing was written, so continuing');
  }

  const after = effectiveFlowSettings(resolution);

  return {
    settings: after,
    changed: wrote,
    needsRebind: REBIND_FIELDS.some((field) => before[field] !== after[field]),
    allowlistChanged: before.exporters !== after.exporters,
  };
}
