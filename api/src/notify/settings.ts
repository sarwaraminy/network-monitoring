import { SEVERITIES, type Severity } from '../packet/detect/types.js';
import { WEBHOOK_FORMATS, type WebhookFormat } from './types.js';

/**
 * Delivery settings, and where each one came from.
 *
 * Today every delivery setting is read once from `api/.env` at boot and cannot
 * change without editing a file on the server and restarting. That is fine for the
 * developer and wrong for the buyer: the person configuring this is an IT admin, and
 * asking them to shell into a host to add a second recipient means every tuning
 * change is an outage. See issue #28.
 *
 * The model here is deliberately *not* "move the settings into the database". It is
 * three layers, resolved per field:
 *
 *   environment variable  →  stored row  →  code default
 *
 * The environment wins, and that ordering is the whole reason this is safe to ship.
 * A deployment driven by Compose or by config management has its settings pinned in
 * a file that a web form must not be able to contradict — otherwise the file says
 * one thing, the running process does another, and the next redeploy silently
 * reverts whatever was changed in the UI. Pinning is a feature for those
 * deployments, so it stays.
 *
 * The consequence is a UX obligation, not just a rule: a field pinned by the
 * environment must be shown as such and must not be editable, because a form
 * control that accepts an edit and changes nothing is the exact failure this
 * codebase keeps finding. Hence `SettingSource` — every field reports whether it
 * came from the environment, the database or the default, and the API hands that to
 * the page rather than leaving it to infer.
 *
 * Kept free of database and `env` imports so the resolution can be tested against
 * plain objects. `env.ts` continues to expose `env.notify` for now; this module is
 * what the notifier will read once it stops reading `env` directly.
 */

/** Where a resolved value came from. */
export type SettingSource = 'environment' | 'database' | 'default';

/** The shape a field's value can take. */
type FieldKind = 'boolean' | 'integer' | 'string' | 'string-list' | 'enum';

interface FieldSpec {
  /** The environment variable that pins this field. */
  env: string;
  kind: FieldKind;
  /** Allowed values, for `enum`. */
  values?: readonly string[];
  /**
   * True for a value that must never be returned by the API.
   *
   * The webhook URL is a bearer credential for Slack and Teams, and the SMTP
   * password is a password. `GET /api/notify/status` has never returned the webhook
   * URL, and that property has to survive this change — the form shows whether a
   * secret is configured and offers to replace it, never the value.
   */
  secret?: true;
  /** Seconds in the environment, milliseconds in the code. */
  scale?: 1000;
}

/**
 * Every delivery setting, flattened.
 *
 * Flat rather than nested like `env.notify`, because this shape has to be a database
 * row, a form and a JSON payload as well as a config object, and three of those four
 * are worse when nested.
 */
export const DELIVERY_FIELDS = {
  enabled: { env: 'NOTIFY_ENABLED', kind: 'boolean' },
  minSeverity: { env: 'NOTIFY_MIN_SEVERITY', kind: 'enum', values: SEVERITIES },
  digestSeconds: { env: 'NOTIFY_DIGEST_SECONDS', kind: 'integer' },
  throttleSeconds: { env: 'NOTIFY_THROTTLE_SECONDS', kind: 'integer' },
  maxPerHour: { env: 'NOTIFY_MAX_PER_HOUR', kind: 'integer' },
  includeEvidence: { env: 'NOTIFY_INCLUDE_EVIDENCE', kind: 'boolean' },
  dashboardUrl: { env: 'NOTIFY_DASHBOARD_URL', kind: 'string' },

  webhookUrl: { env: 'NOTIFY_WEBHOOK_URL', kind: 'string', secret: true },
  webhookFormat: { env: 'NOTIFY_WEBHOOK_FORMAT', kind: 'enum', values: WEBHOOK_FORMATS },

  syslogHost: { env: 'SYSLOG_HOST', kind: 'string' },
  syslogPort: { env: 'SYSLOG_PORT', kind: 'integer' },
  syslogProtocol: { env: 'SYSLOG_PROTOCOL', kind: 'enum', values: ['udp', 'tcp'] },
  syslogFormat: { env: 'SYSLOG_FORMAT', kind: 'enum', values: ['cef', 'json'] },
  syslogRfc: { env: 'SYSLOG_RFC', kind: 'enum', values: ['5424', '3164'] },
  syslogFacility: { env: 'SYSLOG_FACILITY', kind: 'integer' },
  syslogAppName: { env: 'SYSLOG_APP_NAME', kind: 'string' },
  syslogIncludeEvidence: { env: 'SYSLOG_INCLUDE_EVIDENCE', kind: 'boolean' },

  emailHost: { env: 'SMTP_HOST', kind: 'string' },
  emailPort: { env: 'SMTP_PORT', kind: 'integer' },
  emailSecure: { env: 'SMTP_SECURE', kind: 'boolean' },
  emailUser: { env: 'SMTP_USER', kind: 'string' },
  emailPassword: { env: 'SMTP_PASSWORD', kind: 'string', secret: true },
  emailFrom: { env: 'NOTIFY_EMAIL_FROM', kind: 'string' },
  emailTo: { env: 'NOTIFY_EMAIL_TO', kind: 'string-list' },
} as const satisfies Record<string, FieldSpec>;

export type DeliveryField = keyof typeof DELIVERY_FIELDS;

export interface DeliverySettings {
  enabled: boolean;
  minSeverity: Severity;
  digestSeconds: number;
  throttleSeconds: number;
  maxPerHour: number;
  includeEvidence: boolean;
  dashboardUrl: string;

  webhookUrl: string;
  webhookFormat: WebhookFormat;

  syslogHost: string;
  syslogPort: number;
  syslogProtocol: 'udp' | 'tcp';
  syslogFormat: 'cef' | 'json';
  syslogRfc: '5424' | '3164';
  syslogFacility: number;
  syslogAppName: string;
  syslogIncludeEvidence: boolean;

  emailHost: string;
  emailPort: number;
  emailSecure: boolean;
  emailUser: string;
  emailPassword: string;
  emailFrom: string;
  emailTo: string[];
}

/**
 * The code defaults, matching what `env.ts` falls back to today.
 *
 * These must not drift from `env.ts`, so a test compares the two rather than
 * trusting this comment — the same reasoning as `env-defaults.test.ts`, which exists
 * because a hardened default silently undone by a second copy has happened three
 * times in this repository.
 */
export const DELIVERY_DEFAULTS: DeliverySettings = {
  enabled: false,
  minSeverity: 'high',
  digestSeconds: 60,
  throttleSeconds: 900,
  maxPerHour: 12,
  includeEvidence: true,
  dashboardUrl: '',

  webhookUrl: '',
  webhookFormat: 'auto',

  syslogHost: '',
  syslogPort: 514,
  syslogProtocol: 'udp',
  syslogFormat: 'cef',
  syslogRfc: '5424',
  syslogFacility: 16,
  syslogAppName: 'nmt',
  syslogIncludeEvidence: true,

  emailHost: '',
  emailPort: 587,
  emailSecure: false,
  emailUser: '',
  emailPassword: '',
  emailFrom: '',
  emailTo: [],
};

/** A field's resolved value with its provenance. */
export interface ResolvedField<T = unknown> {
  value: T;
  source: SettingSource;
}

export type DeliveryResolution = {
  [K in DeliveryField]: ResolvedField<DeliverySettings[K]>;
};

/** The stored row, as far as this module cares: any subset, nulls meaning "unset". */
export type StoredDeliverySettings = Partial<Record<DeliveryField, unknown>>;

/**
 * Parses one raw value against a field's kind.
 *
 * Returns undefined rather than throwing when the value is unusable, so a malformed
 * environment variable or a stale database row falls through to the next layer
 * instead of taking the process down. That direction matters: the alternative is a
 * server that will not boot because somebody typed `NOTIFY_MAX_PER_HOUR=lots`.
 *
 * The exception is a *booted* value that env.ts already validates and throws on —
 * the enums — where env.ts remains the loud check. Here they are simply refused.
 */
export function parseFieldValue(field: DeliveryField, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  const spec: FieldSpec = DELIVERY_FIELDS[field];

  switch (spec.kind) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw).trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(text)) return true;
      if (['false', '0', 'no', 'off'].includes(text)) return false;
      return undefined;
    }
    case 'integer': {
      if (typeof raw !== 'number' && String(raw).trim() === '') return undefined;
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(value) || value < 0) return undefined;
      return value;
    }
    case 'enum': {
      const text = String(raw).trim().toLowerCase();
      return spec.values?.includes(text) ? text : undefined;
    }
    case 'string-list': {
      if (Array.isArray(raw)) {
        const list = raw.map((entry) => String(entry).trim()).filter((entry) => entry !== '');
        return list;
      }
      return String(raw)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    }
    default: {
      // A string field. Trimmed, because a trailing space in a copied webhook URL
      // is otherwise a silent failure that looks like a wrong URL.
      return String(raw).trim();
    }
  }
}

/**
 * Resolves every field across the three layers, recording where each came from.
 *
 * `environmentSource` is the raw environment — `process.env` in production, a plain
 * object in tests.
 *
 * A variable that is present but **blank** counts as UNSET, and that is not a free
 * choice: `env.ts`'s own `optional`, `int` and `bool` all return their fallback on
 * `raw.trim() === ''`, so any other rule here would mean two layers disagreeing about
 * what an empty variable means. A second copy of a rule that can silently diverge is
 * precisely what `env-defaults.test.ts` exists to catch, and the agreement is
 * asserted in this module's tests rather than left to this comment.
 *
 * The limitation that follows, stated because it is real: there is no way to pin a
 * field to blank. `SYSLOG_HOST=` in a Compose file expresses "no default", not
 * "forbidden", so an administrator can still set a syslog host through the UI. That
 * matches how the variable behaves today, and a deployment needing hard immutability
 * would need something this model does not offer — a deny list rather than a default.
 */
export function resolveDeliverySettings(
  environmentSource: Record<string, string | undefined>,
  stored: StoredDeliverySettings = {},
): DeliveryResolution {
  const resolution = {} as DeliveryResolution;

  for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
    const spec: FieldSpec = DELIVERY_FIELDS[field];
    const rawEnv = environmentSource[spec.env];
    // Blank is unset, matching env.ts. See the docblock.
    const envIsSet = rawEnv !== undefined && rawEnv.trim() !== '';

    if (envIsSet) {
      const parsed = parseFieldValue(field, rawEnv);
      if (parsed !== undefined) {
        resolution[field] = { value: parsed, source: 'environment' } as never;
        continue;
      }
      // A set-but-unparseable variable falls through rather than pinning nonsense.
    }

    const rawStored = stored[field];
    if (rawStored !== null && rawStored !== undefined) {
      const parsed = parseFieldValue(field, rawStored);
      if (parsed !== undefined) {
        resolution[field] = { value: parsed, source: 'database' } as never;
        continue;
      }
    }

    resolution[field] = { value: DELIVERY_DEFAULTS[field], source: 'default' } as never;
  }

  return resolution;
}

/** The effective settings alone, for the code that only needs values. */
export function effectiveSettings(resolution: DeliveryResolution): DeliverySettings {
  const settings = {} as Record<string, unknown>;
  for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
    settings[field] = resolution[field].value;
  }
  return settings as unknown as DeliverySettings;
}

/** Fields the environment has pinned, which the UI must render as uneditable. */
export function environmentPinnedFields(resolution: DeliveryResolution): DeliveryField[] {
  return (Object.keys(DELIVERY_FIELDS) as DeliveryField[]).filter(
    (field) => resolution[field].source === 'environment',
  );
}

/**
 * Fields in a patch that the environment has pinned, which cannot be stored.
 *
 * Pure and exported so the refusal has a test. Storing such a field would be
 * defensible — it would take effect if the variable were later removed — but it
 * would also mean answering 200 to a change that changes nothing, and the entire
 * point of reporting provenance is that nobody has to guess about that.
 */
export function pinnedConflicts(
  patch: Record<string, unknown>,
  resolution: DeliveryResolution,
): DeliveryField[] {
  const pinned = new Set(environmentPinnedFields(resolution));
  return Object.keys(patch).filter((field): field is DeliveryField => pinned.has(field as DeliveryField));
}

export function isSecretField(field: DeliveryField): boolean {
  return 'secret' in DELIVERY_FIELDS[field];
}

/**
 * The API-safe view: every field with its source, secrets replaced by whether they
 * are set.
 *
 * `GET /api/notify/status` has never returned the webhook URL, because for Slack and
 * Teams that URL *is* the credential and the endpoint is readable by any
 * authenticated account. Redacting here rather than at the route means a future
 * endpoint cannot leak it by forgetting.
 */
export interface RedactedField {
  source: SettingSource;
  /** Present for non-secret fields only. */
  value?: unknown;
  /** Present for secret fields only: whether a value is configured. */
  configured?: boolean;
}

export function redactForApi(resolution: DeliveryResolution): Record<string, RedactedField> {
  const out: Record<string, RedactedField> = {};

  for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
    const { value, source } = resolution[field];
    out[field] = isSecretField(field)
      ? { source, configured: typeof value === 'string' && value.trim() !== '' }
      : { source, value };
  }

  return out;
}
