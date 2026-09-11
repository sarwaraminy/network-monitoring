import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type FlowSettingsRow, type NewFlowSettingsRow, flowSettings as table } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import type { Actor, AuditWriter } from './audit.service.js';
import { recordAudit } from './audit.service.js';
import {
  effectiveFlowSettings,
  exporterList,
  FLOW_FIELDS,
  type FlowField,
  type FlowResolution,
  type FlowSettings,
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

/** Reads the row and re-resolves. Falls back to environment-and-defaults if it cannot. */
export async function loadFlowSettings(): Promise<FlowSettings> {
  try {
    const [row] = await db.select().from(table).where(eq(table.id, ROW_ID)).limit(1);
    resolution = resolveFlowSettings(flowEnvironmentSource(), storedFrom(row));
  } catch (error) {
    /*
     * Warn and keep whatever was resolved before, which on a first load is the
     * environment and the defaults.
     *
     * Not fatal, because the alternative is worse: a database that cannot be read
     * at boot would stop the collector binding, so an installation would lose
     * flow telemetry over a settings table it could run perfectly well without.
     */
    log.warn({ err: error }, 'Could not read the flow settings; using the environment and defaults');
  }

  settings = effectiveFlowSettings(resolution);
  allowed = exporterList(settings);
  return settings;
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
 * and same reasoning as `seedAdhocSettingsFromEnvironment`.
 */
export async function seedFlowSettingsFromEnvironment(): Promise<FlowField[]> {
  const fresh = resolveFlowSettings(flowEnvironmentSource(), {});
  const seeded: FlowField[] = [];

  for (const field of Object.keys(FLOW_FIELDS) as FlowField[]) {
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

  await loadFlowSettings();
  const after = effectiveFlowSettings(resolution);

  return {
    settings: after,
    needsRebind: REBIND_FIELDS.some((field) => before[field] !== after[field]),
  };
}
