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
 * plain objects. `env.ts` no longer has a `notify` block at all — the notifier and
 * the settings service both read this module instead.
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
 * How the SMTP transport authenticates.
 *
 * `password` covers both AUTH LOGIN/PLAIN and no authentication at all — a relay
 * with a blank username sends no AUTH, which is what makes an internal relay the
 * zero-configuration case it should be.
 */
export const EMAIL_AUTH_METHODS = ['password', 'oauth2'] as const;
export type EmailAuthMethod = (typeof EMAIL_AUTH_METHODS)[number];

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

  // XOAUTH2, for the tenants that permit nothing else. See issue #27 and
  // V13__Email_oauth2.sql. The method is an explicit switch rather than something
  // inferred from "is a client id set": inference would let a half-entered OAuth2
  // configuration fall back to password auth and report a rejected password, which
  // is the exact confusion this feature exists to end.
  emailAuthMethod: { env: 'SMTP_AUTH_METHOD', kind: 'enum', values: EMAIL_AUTH_METHODS },
  emailOauthClientId: { env: 'SMTP_OAUTH_CLIENT_ID', kind: 'string' },
  emailOauthClientSecret: { env: 'SMTP_OAUTH_CLIENT_SECRET', kind: 'string', secret: true },
  emailOauthRefreshToken: { env: 'SMTP_OAUTH_REFRESH_TOKEN', kind: 'string', secret: true },
  emailOauthTokenUrl: { env: 'SMTP_OAUTH_TOKEN_URL', kind: 'string' },
  emailOauthScope: { env: 'SMTP_OAUTH_SCOPE', kind: 'string' },
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

  emailAuthMethod: EmailAuthMethod;
  emailOauthClientId: string;
  emailOauthClientSecret: string;
  emailOauthRefreshToken: string;
  emailOauthTokenUrl: string;
  emailOauthScope: string;
}

/**
 * The code defaults. `env.ts` no longer declares any of its own — its `notify`
 * block was dead code once this module and the database took over (nothing read
 * `env.notify` any more) and, worse, live code that still threw a `TypeError` on
 * boot for a value this module was specifically built to fall through on. These
 * are now the only copy, so there is nothing left for them to drift from.
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

  // Password, so an installation that upgrades into these columns keeps sending
  // exactly the way it did before they existed.
  emailAuthMethod: 'password',
  emailOauthClientId: '',
  emailOauthClientSecret: '',
  emailOauthRefreshToken: '',
  emailOauthTokenUrl: '',
  emailOauthScope: '',
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
 * Enums included. `env.ts` used to throw a loud `TypeError` on an invalid one —
 * exactly the boot-crashing failure mode this module exists to avoid — and no
 * longer has an opinion at all: its `notify` block is gone. This is the only check
 * left, and it fails soft like everything else here.
 */
export function parseFieldValue(field: DeliveryField, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  const spec: FieldSpec = DELIVERY_FIELDS[field];

  switch (spec.kind) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw).trim().toLowerCase();
      // Never falls through to undefined, unlike every other kind here. env.ts's
      // old bool() treated any non-blank, unrecognized value as false — not as
      // unset — so a legacy NOTIFY_INCLUDE_EVIDENCE=maybe must keep resolving to
      // false rather than silently falling through to this field's default
      // (true), which is a behavior flip for every boolean field that defaults
      // to true. Same reasoning as the integer case above: a legacy value keeps
      // behaving exactly as it did before this table existed.
      return ['true', '1', 'yes', 'on'].includes(text);
    }
    case 'integer': {
      if (typeof raw !== 'number' && String(raw).trim() === '') return undefined;
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      // Only the shape is checked here, matching the leniency of the env.ts parser
      // this replaces: it rejected a non-number, never a negative one. A legacy
      // value such as NOTIFY_MAX_PER_HOUR=-1 (which made the hourly ceiling check
      // always true, muting delivery) must keep behaving exactly as it did before
      // this table existed. The database's CHECK constraints are the actual bound
      // for anything that gets stored — see seedFromEnvironment in
      // settings.service.ts — and the Zod schema is the bound for the form.
      if (!Number.isInteger(value)) return undefined;
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
 * Environment variables that are set but do not parse, named by the variable
 * rather than the field — an operator fixes this by editing `api/.env`, not by
 * knowing this module's internal field name.
 *
 * `resolveDeliverySettings` treats a rejection here as "this layer has no
 * opinion" and falls through to the stored or default value, deliberately —
 * see `parseFieldValue`'s docblock. Deliberately-not-an-error is not the same as
 * invisible, though: env.ts's old behaviour for these same values was a loud
 * boot-time crash, which at least told somebody. The caller logs this list once
 * so a legacy or mistyped variable like `NOTIFY_MIN_SEVERITY=critial` leaves a
 * trace instead of silently doing nothing.
 */
export function invalidEnvironmentVariables(environmentSource: Record<string, string | undefined>): string[] {
  const invalid: string[] = [];

  for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
    const spec = DELIVERY_FIELDS[field];
    const raw = environmentSource[spec.env];
    if (raw === undefined || raw.trim() === '') continue;
    if (parseFieldValue(field, raw) === undefined) invalid.push(spec.env);
  }

  return invalid;
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

/**
 * Whether the resolved settings could actually deliver over the webhook or email
 * channel, ahead of anything actually building one.
 *
 * `buildChannels` (notifier.ts) and `GET /status` (notify.routes.ts) both have to
 * answer this before either a `NotificationChannel` or a status response exists,
 * and each channel's own `isConfigured()` answers the same question about a
 * channel already built from these same fields — three call sites that have
 * drifted from each other twice now (a whitespace-only webhook URL, then a blank
 * `emailFrom`), always the same way: one of the three re-typed the condition
 * slightly short. Callers should use these rather than a fourth copy.
 */
export function isWebhookConfigured(settings: DeliverySettings): boolean {
  return settings.webhookUrl.trim() !== '';
}

export function isEmailConfigured(settings: DeliverySettings): boolean {
  return settings.emailHost.trim() !== '' && settings.emailFrom.trim() !== '' && settings.emailTo.length > 0;
}
