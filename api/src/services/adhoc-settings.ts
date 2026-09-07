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
 * an installation's decision: an administrator can switch a console on and off
 * and tune its limits without the restart that on a monitoring server means
 * dropping a live capture — and a deployment that wants the decision kept in a
 * file keeps it, because a variable set there pins the field.
 *
 * **`ADHOC_DB_PASSWORD` is in this registry** (`dbPassword`, below), and this
 * paragraph used to end by saying it was not and should never be added. That was
 * true when it was written: the argument was that the capability's *existence*
 * belonged to whoever set the password, so leaving it out kept that decision off
 * the browser. V15 reversed it deliberately — see `dbPassword`'s own docblock —
 * and this header was left behind, still instructing future editors not to do
 * what the file already does. Two halves of one module disagreeing is worse than
 * either being wrong alone, because whichever half a reader trusts, the code
 * says otherwise.
 *
 * What holds the line now that the password is editable: the environment still
 * pins it; the console's own Postgres roles cannot read the table it is stored
 * in (V11/V12 grant an explicit per-table allowlist, and V15 revokes on it);
 * the value never leaves the server, redacted in this module rather than at the
 * route; and the audit trail records `[set]`/`[cleared]`, never a value.
 */

export type SettingSource = 'environment' | 'database' | 'default';

type FieldKind = 'boolean' | 'integer' | 'enum' | 'string';

interface FieldSpec {
  /** The environment variable that pins this field. */
  env: string;
  kind: FieldKind;
  /** For `enum`. */
  values?: readonly string[];
  /** Inclusive bounds for `integer`, matching V14's CHECK constraints. */
  min?: number;
  max?: number;
  /**
   * A credential: reported as configured-or-not, never returned.
   *
   * Same marker and same meaning as `notify/settings.ts`, deliberately — the
   * webhook URL and the SMTP password already needed exactly this, and a second
   * vocabulary for "do not send this to a browser" is how one of them
   * eventually gets it wrong.
   */
  secret?: boolean;
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
  /**
   * The console role's password, installed with `ALTER ROLE` at startup.
   *
   * V14 left this out and argued that it was what kept the decision to *have* a
   * SQL prompt on the production database with whoever installed the server.
   * That description was accurate and the trade-off was then made deliberately:
   * an administrator can now provision the console without server access. What
   * still holds is that the environment wins — `ADHOC_DB_PASSWORD` set there
   * pins the field — and that the value never leaves the server.
   *
   * Not bounded or validated beyond being a non-blank string. Postgres accepts
   * anything as a role password, and rejecting a value the database would take
   * would only teach somebody to work around this form.
   */
  dbPassword: { env: 'ADHOC_DB_PASSWORD', kind: 'string', secret: true },
} as const satisfies Record<string, FieldSpec>;

/** Fields that are credentials, so nothing returns them by accident. */
export function isAdhocSecretField(field: AdhocField): boolean {
  return 'secret' in ADHOC_FIELDS[field] && ADHOC_FIELDS[field].secret === true;
}

export type AdhocField = keyof typeof ADHOC_FIELDS;

export interface AdhocSettings {
  enabled: boolean;
  writeEnabled: boolean;
  timeoutMs: number;
  maxRows: number;
  maxQueryLength: number;
  audit: AdhocAuditMode;
  /**
   * Never sent to a browser and never logged. `withoutPassword` in
   * `adhoc.service.ts` scrubs it out of anything Postgres says back, because
   * `ALTER ROLE … PASSWORD` has no parameterised form and the value is part of
   * the statement text.
   */
  dbPassword: string;
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
  /*
   * Empty, and that is the only sensible default: without a password the console
   * cannot start whatever else is set, which is what keeps a fresh install from
   * having a SQL prompt nobody asked for.
   */
  dbPassword: '',
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

  if (spec.kind === 'string') {
    // Already known non-blank by the guard at the top, so a string field offers
    // whatever it holds. Not trimmed: a password's whitespace is part of it.
    return typeof raw === 'string' ? raw : String(raw);
  }

  /*
   * Lowercased, like every other reader of an enum setting in this codebase:
   * `oneOf()` in `env.ts` and the enum branch of `notify/settings.ts` both do
   * it, and so does the boolean branch above.
   *
   * Without it `ADHOC_AUDIT=OFF` — or `Off`, or `Refused` — was rejected, the
   * environment layer offered nothing, and the field fell through to the code
   * default `all`. So an installation that had deliberately turned query
   * auditing off got it switched back on by upgrading, with the field reporting
   * its source as `default` so the control claimed nothing in the environment
   * decided it, and nothing anywhere logging that the variable had been ignored.
   * The same in reverse for `ADHOC_AUDIT=ALL`, which was silently unpinned.
   */
  const text = String(raw).trim().toLowerCase();
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
    dbPassword: resolution.dbPassword.value,
  };

  return settings.writeEnabled ? { ...settings, audit: 'all' } : settings;
}

/**
 * The API-safe view: every field with its provenance, credentials reduced to a
 * boolean.
 *
 * Redacting here rather than at the route is the same choice `notify/settings.ts`
 * made for the webhook URL, and for the same reason: a second endpoint added
 * later cannot leak the value by forgetting to strip it.
 */
export interface RedactedAdhocField {
  source: SettingSource;
  /** The environment variable that would pin it. */
  env: string;
  /** Non-secret fields only. */
  value?: unknown;
  /** Secret fields only: whether one is set, never what it is. */
  configured?: boolean;
}

export function redactAdhocForApi(resolution: AdhocResolution): Record<string, RedactedAdhocField> {
  const out: Record<string, RedactedAdhocField> = {};

  for (const field of Object.keys(ADHOC_FIELDS) as AdhocField[]) {
    const { value, source } = resolution[field];
    const env = ADHOC_FIELDS[field].env;
    out[field] = isAdhocSecretField(field)
      ? { source, env, configured: typeof value === 'string' && value.trim() !== '' }
      : { source, env, value };
  }

  return out;
}

/**
 * A patch as the audit trail should record it.
 *
 * The trail has to say that the console's password changed — "who gave this
 * database a SQL prompt" is precisely the question it exists to answer — and must
 * never say what it changed to. `audit_events` is append-only and never pruned,
 * so a credential written there is written for good.
 *
 * `[set]` and `[cleared]` rather than a length or a hash: both of those are
 * facts about the credential, and neither helps anybody reading the trail.
 */
export function auditableAdhocPatch(patch: StoredAdhocSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(patch) as [AdhocField, unknown][]) {
    if (!(field in ADHOC_FIELDS)) continue;
    out[field] = isAdhocSecretField(field) ? (value === null || value === '' ? '[cleared]' : '[set]') : value;
  }

  return out;
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
