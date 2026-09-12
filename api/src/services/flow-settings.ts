import {
  createResolver,
  type EnvironmentSource,
  type Resolution,
  type SettingSource,
  type StoredSettings,
} from '../config/settings-resolver.js';

/**
 * The flow collector's settings, resolved environment → stored row → default.
 *
 * The same three-layer rule delivery (#39) and the query console (#53) both use,
 * and the same reason both cited: a restart on a monitoring server drops a live
 * capture, so "edit a file and restart the API" is a real cost rather than an
 * inconvenience. `FLOW_ENABLED`, `FLOW_PORT`, `FLOW_BIND_ADDRESS` and
 * `FLOW_EXPORTERS` were read once at boot and changeable no other way.
 *
 * **The layer walk comes from `config/settings-resolver.ts`**, which the three
 * features that resolve settings this way now share. This module was written as
 * the third hand-written copy, deliberately matching the other two so the
 * extraction could be reviewed on its own; that is what happened. What stays here
 * is the field table, the defaults and `parseFlowField` — the parser is a
 * parameter because the three domains disagree about blanks, bounds and trimming
 * in ways each of them documents.
 *
 * **No secret here.** Flow has no credential: the protocol is unauthenticated,
 * which is exactly why `FLOW_EXPORTERS` exists and why it matters — reachability
 * plus that allowlist is the whole of the access control. So there is nothing to
 * redact, and nothing to keep out of the audit trail.
 */

type FieldKind = 'boolean' | 'integer' | 'string';

/**
 * This domain's spec: the shared `env`/`secret`/`blankStoredIsValue`, plus what
 * only `parseFlowField` reads. Structural typing means it satisfies the shared
 * `FieldSpec` without saying so.
 */
interface FlowFieldSpec {
  /** The environment variable that pins this field. */
  env: string;
  kind: FieldKind;
  /** Inclusive bounds for `integer`, matching V19's CHECK constraints. */
  min?: number;
  max?: number;
  /** See `exporters` below, and `FieldSpec` in the resolver. */
  blankStoredIsValue?: boolean;
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
  exporters: { env: 'FLOW_EXPORTERS', kind: 'string', blankStoredIsValue: true },
} as const satisfies Record<string, FlowFieldSpec>;

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

export type FlowResolution = Resolution<FlowSettings>;
export type StoredFlowSettings = StoredSettings<FlowSettings>;

/** The shared three-layer walk, bound to this domain's table and parser. */
const resolver = createResolver<FlowSettings>({
  fields: FLOW_FIELDS,
  defaults: FLOW_DEFAULTS,
  parse: (field, raw) => parseFlowField(field, raw),
});

/**
 * One value out of whatever a layer offered, or `undefined` if it offered nothing.
 *
 * A blank counts as unset, matching `env.ts` and both other resolvers — and it is
 * what makes the shipped Compose file able to pass these through without pinning
 * them. See `compose-unpinned.test.ts` for why that matters more than it sounds.
 */
export function parseFlowField(field: FlowField, raw: unknown): unknown {
  const spec: FlowFieldSpec = FLOW_FIELDS[field];
  if (raw === undefined || raw === null) return undefined;
  /*
   * A blank is unset, for every field and every layer, as far as this parser is
   * concerned.
   *
   * `exporters` is the one exception and it does NOT live here: an administrator
   * who clears the allowlist means "accept any sender", but only from the stored
   * row — from the environment a blank is still an unset Compose variable. A
   * parser cannot tell those apart, because it is not told which layer it is
   * reading. The resolver is, so the exception is `blankStoredIsValue` on the
   * field above.
   */
  if (typeof raw === 'string' && raw.trim() === '') return undefined;

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
  environmentSource: EnvironmentSource,
  stored: StoredFlowSettings = {},
): FlowResolution {
  return resolver.resolve(environmentSource, stored);
}

export function effectiveFlowSettings(resolution: FlowResolution): FlowSettings {
  return resolver.effective(resolution);
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
  return resolver.pinned(resolution);
}

/**
 * `FLOW_*` variables that are set to something this cannot use.
 *
 * It matters more here than in most places: these are edited by people who
 * cannot easily see the application log, so the log line is what a support
 * conversation ends up turning on. The reasoning for reporting them at all is in
 * `invalidEnvironment` on the shared resolver.
 */
export function invalidFlowEnvironmentVariables(environmentSource: EnvironmentSource): string[] {
  return resolver.invalidEnvironment(environmentSource);
}
