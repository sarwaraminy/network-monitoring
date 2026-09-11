import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type FlowSettingsRow, type NewFlowSettingsRow, flowSettings as table } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import type { Actor, AuditWriter } from './audit.service.js';
import { recordAudit } from './audit.service.js';
import {
  effectiveFlowSettings,
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
  return settings;
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
 * Writes the patch and re-resolves, recording what changed.
 *
 * The audit row shares the transaction with the write, as everything else in this
 * codebase does. Values are recorded rather than just field names — unlike the
 * delivery and console settings, none of these is a credential, and *which* port
 * and *which* allowlist is the entire content of the event. "Somebody changed the
 * exporters" without saying to what records nothing worth reading a year later.
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

    await tx
      .insert(table)
      .values({ id: ROW_ID, ...values, updatedAt: new Date(), updatedBy: actor.name })
      .onConflictDoUpdate({
        target: table.id,
        set: { ...values, updatedAt: new Date(), updatedBy: actor.name },
      });

    await recordAudit(tx as unknown as AuditWriter, {
      actor: actor.name,
      actorId: actor.id,
      action: 'flow_settings.update',
      detail: { ...(patch as Record<string, unknown>) },
    });
  });

  await loadFlowSettings();
  const after = effectiveFlowSettings(resolution);

  return {
    settings: after,
    needsRebind: REBIND_FIELDS.some((field) => before[field] !== after[field]),
  };
}
