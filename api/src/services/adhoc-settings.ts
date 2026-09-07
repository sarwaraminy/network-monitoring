/**
 * The query console's settings, resolved from three layers.
 *
 * The same rule as delivery settings, for the same reason: **environment →
 * stored row → code default, and the environment wins.** A deployment that pins
 * `ADHOC_ENABLED=false` in its Compose file cannot be contradicted from a
 * browser, and a field that is pinned renders disabled rather than accepting an
 * edit that changes nothing — this codebase's recurring bug, in a place where it
 * would matter more than usual.
 *
 * Why any of it is editable at all, given `env.ts` argues the console should be
 * an installation's decision: the decision that matters is whether the
 * capability *exists*, and that still belongs to whoever sets
 * `ADHOC_DB_PASSWORD`. Without one the console cannot start whatever these say —
 * the password is installed on a Postgres role at boot, and no value here can
 * conjure it. What an administrator gains is the ability to switch a
 * provisioned console on and off, and to tune its limits, without a restart that
 * on a monitoring server means dropping a live capture.
 *
 * `ADHOC_DB_PASSWORD` is therefore not in this registry, and should not be added
 * to it.
 */

export type SettingSource = 'environment' | 'database' | 'default';

type FieldKind = 'boolean' | 'integer' | 'enum';

interface FieldSpec {
  /** The environment variable that pins this field. */
  env: string;
  kind: FieldKind;
  /** For `enum`. */
  values?: readonly string[];
  /** Inclusive bounds for `integer`, matching V14's CHECK constraints. */
  min?: number;
  max?: number;
}

export const ADHOC_AUDIT_MODES = ['all', 'refused', 'off'] as const;
export type AdhocAuditMode = (typeof ADHOC_AUDIT_MODES)[number];

export const ADHOC_FIELDS = {
  enabled: { env: 'ADHOC_ENABLED', kind: 'boolean' },
  writeEnabled: { env: 'ADHOC_WRITE_ENABLED', kind: 'boolean' },
  timeoutMs: { env: 'ADHOC_TIMEOUT_MS', kind: 'integer', min: 100, max: 600_000 },
  maxRows: { env: 'ADHOC_MAX_ROWS', kind: 'integer', min: 1, max: 100_000 },
  maxQueryLength: { env: 'ADHOC_MAX_QUERY_LENGTH', kind: 'integer', min: 1, max: 1_000_000 },
  audit: { env: 'ADHOC_AUDIT', kind: 'enum', values: ADHOC_AUDIT_MODES },
} as const satisfies Record<string, FieldSpec>;

export type AdhocField = keyof typeof ADHOC_FIELDS;

export interface AdhocSettings {
  enabled: boolean;
  writeEnabled: boolean;
  timeoutMs: number;
  maxRows: number;
  maxQueryLength: number;
  audit: AdhocAuditMode;
}

/**
 * The code defaults, and the last layer.
 *
 * `enabled` and `writeEnabled` are false here for the reason `env.ts` gives at
 * length: a console nobody asked for is a SQL prompt nobody decided to have.
 */
export const ADHOC_DEFAULTS: AdhocSettings = {
  enabled: false,
  writeEnabled: false,
  timeoutMs: 10_000,
  maxRows: 1000,
  maxQueryLength: 20_000,
  audit: 'all',
};

export interface ResolvedField<T = unknown> {
  value: T;
  source: SettingSource;
}

export type AdhocResolution = { [K in AdhocField]: ResolvedField<AdhocSettings[K]> };
export type StoredAdhocSettings = Partial<Record<AdhocField, unknown>>;

/**
 * One value out of whatever a layer offered, or `undefined` if it offered nothing.
 *
 * A blank environment variable counts as unset, matching `env.ts` — an
 * `ADHOC_ENABLED=` line left in a file is somebody who has not decided, not
 * somebody who chose false.
 */
export function parseFieldValue(field: AdhocField, raw: unknown): unknown {
  const spec: FieldSpec = ADHOC_FIELDS[field];
  if (raw === undefined || raw === null) return undefined;
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
    // Out of bounds is refused rather than clamped: a value the database would
    // reject must not be silently turned into one it accepts, or the interface
    // and the table would disagree about what was saved.
    if (spec.min !== undefined && value < spec.min) return undefined;
    if (spec.max !== undefined && value > spec.max) return undefined;
    return value;
  }

  const text = String(raw).trim();
  return spec.values?.includes(text) ? text : undefined;
}

export function resolveAdhocSettings(
  environmentSource: Record<string, string | undefined>,
  stored: StoredAdhocSettings = {},
): AdhocResolution {
  const resolution = {} as AdhocResolution;

  for (const field of Object.keys(ADHOC_FIELDS) as AdhocField[]) {
    const fromEnv = parseFieldValue(field, environmentSource[ADHOC_FIELDS[field].env]);
    if (fromEnv !== undefined) {
      resolution[field] = { value: fromEnv, source: 'environment' } as never;
      continue;
    }

    const fromRow = parseFieldValue(field, stored[field]);
    if (fromRow !== undefined) {
      resolution[field] = { value: fromRow, source: 'database' } as never;
      continue;
    }

    resolution[field] = { value: ADHOC_DEFAULTS[field], source: 'default' } as never;
  }

  return resolution;
}

/**
 * The values themselves, with one rule applied on top.
 *
 * **Write mode forces auditing to `all`.** `env.ts` says so and it is not
 * decoration: a console that can DELETE and a trail that records none of it is
 * the one combination this feature must not offer, and it was previously
 * unreachable only because both came from the environment. Now that either can
 * be set in a browser, the rule has to live where both are read rather than in
 * whoever remembers to set them together.
 */
export function effectiveAdhocSettings(resolution: AdhocResolution): AdhocSettings {
  const settings = {
    enabled: resolution.enabled.value,
    writeEnabled: resolution.writeEnabled.value,
    timeoutMs: resolution.timeoutMs.value,
    maxRows: resolution.maxRows.value,
    maxQueryLength: resolution.maxQueryLength.value,
    audit: resolution.audit.value,
  };

  return settings.writeEnabled ? { ...settings, audit: 'all' } : settings;
}

/** Fields the environment has pinned, which the interface must not offer to edit. */
export function adhocPinnedFields(resolution: AdhocResolution): AdhocField[] {
  return (Object.keys(ADHOC_FIELDS) as AdhocField[]).filter(
    (field) => resolution[field].source === 'environment',
  );
}

/**
 * The pinned fields a patch would try to change, for the 409.
 *
 * Named by their environment variable rather than their field key, because the
 * variable is what an operator can grep for — the lesson from the delivery
 * settings' own 409, which named the internal key and helped nobody.
 */
export function adhocPinnedConflicts(resolution: AdhocResolution, patch: StoredAdhocSettings): string[] {
  const pinned = new Set(adhocPinnedFields(resolution));
  return (Object.keys(patch) as AdhocField[])
    .filter((field) => pinned.has(field))
    .map((field) => ADHOC_FIELDS[field].env);
}

/** The process environment, as the resolver wants it. */
export function adhocEnvironmentSource(): Record<string, string | undefined> {
  return process.env;
}
