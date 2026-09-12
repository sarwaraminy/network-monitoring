import type { SettingSource } from './adhoc-settings.js';

/**
 * The flow collector's settings, resolved environment → stored row → default.
 *
 * The same three-layer rule delivery (#39) and the query console (#53) both use,
 * and the same reason both cited: a restart on a monitoring server drops a live
 * capture, so "edit a file and restart the API" is a real cost rather than an
 * inconvenience. `FLOW_ENABLED`, `FLOW_PORT`, `FLOW_BIND_ADDRESS` and
 * `FLOW_EXPORTERS` were read once at boot and changeable no other way.
 *
 * **A third hand-written resolver, and that is worth naming rather than hiding.**
 * `notify/settings.ts` and `adhoc-settings.ts` each carry their own copy of this
 * shape. Four fields did not justify refactoring two modules that took several
 * review rounds to settle, so this one is written to match them exactly — same
 * `FieldSpec`, same blank-is-unset rule, same `pinned` semantics — and the
 * extraction is a separate change that can be reviewed on its own. What stops the
 * three drifting in the meantime is `compose-unpinned.test.ts`, which reads all
 * of their field tables and checks the one property that actually broke twice.
 *
 * **No secret here.** Flow has no credential: the protocol is unauthenticated,
 * which is exactly why `FLOW_EXPORTERS` exists and why it matters — reachability
 * plus that allowlist is the whole of the access control. So there is nothing to
 * redact, and nothing to keep out of the audit trail.
 */

type FieldKind = 'boolean' | 'integer' | 'string';

interface FieldSpec {
  /** The environment variable that pins this field. */
  env: string;
  kind: FieldKind;
  /** Inclusive bounds for `integer`, matching V19's CHECK constraints. */
  min?: number;
  max?: number;
}

export const FLOW_FIELDS = {
  enabled: { env: 'FLOW_ENABLED', kind: 'boolean' },
  /**
   * The UDP port.
   *
   * Bounded at 1024 and not 1: a container runs the API unprivileged, so a
   * privileged port would fail to bind and report itself as "not listening" with
   * no way to tell that from a port already in use. Refusing the value is a
   * better answer than accepting one that cannot work.
   */
  port: { env: 'FLOW_PORT', kind: 'integer', min: 1024, max: 65_535 },
  bindAddress: { env: 'FLOW_BIND_ADDRESS', kind: 'string' },
  /**
   * Comma-separated sender addresses. Empty accepts any.
   *
   * Stored as the raw string rather than an array, matching how the environment
   * carries it and how `flowExporters()` in `env.ts` parses it — one spelling of
   * the value, so the form, the row and the variable cannot disagree about what
   * an empty one means.
   */
  exporters: { env: 'FLOW_EXPORTERS', kind: 'string' },
} as const satisfies Record<string, FieldSpec>;

export type FlowField = keyof typeof FLOW_FIELDS;

export interface FlowSettings {
  enabled: boolean;
  port: number;
  bindAddress: string;
  exporters: string;
}

/**
 * The code defaults, and the last layer. Identical to `env.ts`'s, deliberately:
 * these two have to agree or removing an environment line would change
 * behaviour, which is the thing the seed exists to prevent.
 */
export const FLOW_DEFAULTS: FlowSettings = {
  // Off, because a collector nobody asked for is an open UDP port.
  enabled: false,
  port: 2055,
  // All interfaces, so a first run works without knowing the container's address.
  bindAddress: '0.0.0.0',
  exporters: '',
};

export interface ResolvedField<T = unknown> {
  value: T;
  source: SettingSource;
}

export type FlowResolution = { [K in FlowField]: ResolvedField<FlowSettings[K]> };
export type StoredFlowSettings = Partial<Record<FlowField, unknown>>;

/**
 * One value out of whatever a layer offered, or `undefined` if it offered nothing.
 *
 * A blank counts as unset, matching `env.ts` and both other resolvers — and it is
 * what makes the shipped Compose file able to pass these through without pinning
 * them. See `compose-unpinned.test.ts` for why that matters more than it sounds.
 */
export function parseFlowField(field: FlowField, raw: unknown): unknown {
  const spec: FieldSpec = FLOW_FIELDS[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string' && raw.trim() === '') {
    /*
     * `exporters` is the exception, and only from the stored row.
     *
     * An empty allowlist is a real choice — "accept any sender" — so an
     * administrator who clears the field means it, and treating that as "nobody
     * has decided" would silently fall back to whatever the environment said.
     * From the *environment* a blank still means unset, because that is how an
     * unset Compose variable arrives and the whole file depends on it.
     */
    return undefined;
  }

  if (spec.kind === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const text = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    return undefined;
  }

  if (spec.kind === 'integer') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(value)) return undefined;
    // Out of bounds is refused rather than clamped, matching the other two: a
    // value the database would reject must not be quietly turned into one it
    // accepts, or the form and the row disagree about what was saved.
    if (spec.min !== undefined && value < spec.min) return undefined;
    if (spec.max !== undefined && value > spec.max) return undefined;
    return value;
  }

  return typeof raw === 'string' ? raw.trim() : String(raw).trim();
}

export function resolveFlowSettings(
  environmentSource: Record<string, string | undefined>,
  stored: StoredFlowSettings = {},
): FlowResolution {
  const resolution = {} as FlowResolution;

  for (const field of Object.keys(FLOW_FIELDS) as FlowField[]) {
    const fromEnv = parseFlowField(field, environmentSource[FLOW_FIELDS[field].env]);
    if (fromEnv !== undefined) {
      resolution[field] = { value: fromEnv, source: 'environment' } as never;
      continue;
    }

    /*
     * The stored row, where a blank `exporters` is a decision rather than a gap.
     * Read directly for that field so an administrator who cleared the allowlist
     * keeps an empty one instead of falling through to the environment.
     */
    const rawRow = stored[field];
    const fromRow =
      field === 'exporters' && typeof rawRow === 'string' ? rawRow.trim() : parseFlowField(field, rawRow);
    if (fromRow !== undefined) {
      resolution[field] = { value: fromRow, source: 'database' } as never;
      continue;
    }

    resolution[field] = { value: FLOW_DEFAULTS[field], source: 'default' } as never;
  }

  return resolution;
}

export function effectiveFlowSettings(resolution: FlowResolution): FlowSettings {
  return {
    enabled: resolution.enabled.value,
    port: resolution.port.value,
    bindAddress: resolution.bindAddress.value,
    exporters: resolution.exporters.value,
  };
}

/**
 * The allowlist as the collector wants it: trimmed, blanks dropped.
 *
 * Splits on newlines as well as commas, because the form's field is a two-row
 * textarea and the shape of a control is a promise about its format — it says
 * "list them down the page". Splitting on commas alone turned three addresses
 * entered one per line into a single entry containing the whole block: not
 * empty, so the "blank accepts any sender" escape did not apply, just one
 * unmatchable address refusing every datagram. The form said "Saved, and in
 * force", and the operator collected nothing.
 *
 * Semicolons too, since a list of addresses is the one place somebody reaches
 * for one when commas feel ambiguous.
 */
export function exporterList(settings: FlowSettings): string[] {
  return settings.exporters
    .split(/[,;\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export interface RedactedFlowField {
  source: SettingSource;
  /** The environment variable that would pin it. */
  env: string;
  value: unknown;
}

/**
 * The API view. No redaction, because flow has no credential — stated rather
 * than left as an absence, so that adding one later is a decision somebody makes
 * here instead of a value that leaks by default.
 */
export function flowForApi(resolution: FlowResolution): Record<string, RedactedFlowField> {
  const out: Record<string, RedactedFlowField> = {};

  for (const field of Object.keys(FLOW_FIELDS) as FlowField[]) {
    const { value, source } = resolution[field];
    out[field] = { source, env: FLOW_FIELDS[field].env, value };
  }

  return out;
}

/** Fields the environment has pinned, which the interface must not offer to edit. */
export function flowPinnedFields(resolution: FlowResolution): FlowField[] {
  return (Object.keys(FLOW_FIELDS) as FlowField[]).filter(
    (field) => resolution[field].source === 'environment',
  );
}

/**
 * `FLOW_*` variables that are set to something this cannot use.
 *
 * An unusable value falls through to the next layer, which is right — pinning a
 * field to a value that can never apply would disable the control and change
 * nothing, the worst of both. What was missing is that it happened in silence.
 *
 * Every piece of evidence then points the wrong way: the variable is there in the
 * operator's Compose file, the collector is running, and the admin form shows the
 * field as editable rather than pinned, because a rejected value does not pin.
 * The one thing that would explain it is the line nobody wrote. `FLOW_PORT=514`
 * leaves the collector on 2055 with nothing anywhere connecting the two.
 *
 * It matters more here than in most places: these are edited by people who
 * cannot easily see the application log, so the log line is what a support
 * conversation ends up turning on.
 *
 * Same shape as `invalidAdhocEnvironmentVariables`, which is where the convention
 * comes from.
 */
export function invalidFlowEnvironmentVariables(
  environmentSource: Record<string, string | undefined>,
): string[] {
  const invalid: string[] = [];

  for (const field of Object.keys(FLOW_FIELDS) as FlowField[]) {
    const spec = FLOW_FIELDS[field];
    const raw = environmentSource[spec.env];
    if (raw === undefined || raw.trim() === '') continue;
    if (parseFlowField(field, raw) === undefined) invalid.push(spec.env);
  }

  return invalid;
}
