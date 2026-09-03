import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error-handler.js';
import { parsePrefix } from '../net/prefix.js';
import { WEBHOOK_FORMATS } from '../notify/types.js';
import { ALERT_KINDS, SEVERITIES } from '../packet/detect/types.js';
import { AUDIT_ACTIONS, type AuditAction } from '../services/audit.service.js';

/**
 * Every request schema, in one place.
 *
 * Extracted from the four route files so it can be tested. Validation is the
 * boundary where untrusted input becomes trusted data — an `id` that should be a
 * positive integer, a `limit` that must not be 10 million, an `ipAddress` that is
 * about to be interpolated into a BPF filter — and until now none of it had a
 * single test. A schema that silently stopped rejecting something would not have
 * failed the build.
 *
 * That gap is also what makes the pending zod 4 upgrade unsafe to merge: v4
 * changes `z.coerce.*` semantics, `.default()` inference and the `.email()` API,
 * and CI would pass either way. With these tests, the upgrade becomes a change
 * that either keeps them green or does not.
 *
 * Deliberately free of service and database imports, so the tests exercise the
 * schemas without opening a connection pool.
 */

// --- Shared ---

/**
 * Path/query ids.
 *
 * Coerced because they arrive as strings, but `positive()` and `int()` matter:
 * without them `-1`, `1.5` and `1e400` all reach the query layer.
 *
 * The leading union is not redundant. A bare `z.coerce.number()` runs `Number()`
 * on whatever it is given, and `Number(true)` is `1` — so `true` would validate
 * as id 1. Express only ever hands us strings here, so it cannot bite today, but
 * a schema called `idSchema` should not quietly accept a boolean if it is ever
 * pointed at a JSON body. Restricting the input type first closes that, along
 * with `null`, `[]` and `{}`, all of which `Number()` turns into 0.
 */
export const idSchema = z
  .union([z.string(), z.number()])
  // An explicit transform rather than z.coerce, which types its input as
  // `unknown` in zod 4 and so cannot be piped into from a narrowed union.
  .transform((value) => (typeof value === 'string' ? Number(value.trim()) : value))
  .pipe(z.number().int().positive());

/** Rejects with the same 400 every route uses. */
export function parseId(raw: string | undefined): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'id must be a positive integer');
  return parsed.data;
}

/** Turns a schema failure into the joined-message 400 the routes return. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

// --- Alerts ---

export const alertListQuerySchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
  kind: z.enum(ALERT_KINDS).optional(),
  /** ISO timestamp, or a relative window such as `24h` / `7d` / `30m`. */
  since: z.string().trim().min(1).optional(),
  acknowledged: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  // Capped at 500: this is the only thing standing between a caller and a
  // select of the entire alerts table.
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * The trend window.
 *
 * The ceiling has to be larger than `ALERT_RETENTION_DAYS` — not as headroom, but
 * because the two windows being equal makes the rollup unreachable. Retention rolls
 * up days *older* than its cutoff, so with both at 365 every bucket in
 * `alert_rollup_daily` sits outside the longest window that can be asked for, and the
 * whole point of aggregating expiring days instead of deleting them is unobservable.
 * Five years is arbitrary; being strictly greater than the retention default is not.
 *
 * That widening is scoped to day buckets. `bucket` is independent of `days`, and the
 * rollup fold-in in `dashboardData` only ever applies to a daily bucket — an hourly
 * one is served from live rows alone. So `?days=1825&bucket=hour` would otherwise be
 * a pure live-row scan and grouping over five years with nothing aggregated to
 * absorb the cost, five times what the old, single 365-day ceiling ever allowed.
 * `MAX_HOURLY_DAYS` keeps that case at the old ceiling.
 */
const MAX_HOURLY_DAYS = 365;
const MAX_TREND_DAYS = Math.max(1825, env.retention.alertDays + 1);

/**
 * The audit listing.
 *
 * `action` is validated against the same vocabulary the service exports, so a typo
 * is a 400 rather than a silently empty page — and adding an action in one place
 * cannot leave the filter rejecting it.
 */
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.enum(Object.keys(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]]).optional(),
  /** Keyset cursor: only events strictly older than this instant. */
  before: z.coerce.date().optional(),
});

export const alertDashboardQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(MAX_TREND_DAYS).default(7),
    bucket: z.enum(['hour', 'day']).optional(),
  })
  .refine((data) => data.bucket !== 'hour' || data.days <= MAX_HOURLY_DAYS, {
    message: `days must be at most ${MAX_HOURLY_DAYS} when bucket is "hour"`,
    path: ['days'],
  });

/**
 * `since`, as either an ISO date or a relative window like `24h`.
 *
 * `new Date(value)` is deliberately guarded: it returns Invalid Date rather than
 * throwing, and an Invalid Date passed into a query comparison silently matches
 * nothing, which reads as "no alerts" rather than as an error.
 */
export function parseSince(value: string | undefined, now = Date.now()): Date | undefined {
  if (!value) return undefined;

  const relative = /^(\d+)([mhd])$/.exec(value.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as 'm' | 'h' | 'd'];
    return new Date(now - amount * unitMs);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `Could not parse "since": use an ISO date or a window like 24h`);
  }
  return parsed;
}

// --- Alert suppression ---

/**
 * A CIDR range or a bare address, normalised to the range that will actually match.
 *
 * Normalising here rather than on the way out is what stops a rule displaying one
 * address while covering 256 of them: `10.0.0.7/24` is stored as `10.0.0.0/24`,
 * which is what it means. `/0` is refused by `parsePrefix` and the message says so
 * explicitly, because "match every address" already has a spelling — leave the
 * field empty — and a rule that suppresses everything while looking specific is
 * the single most dangerous thing anyone can type on this screen.
 */
const prefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => parsePrefix(value) !== null, {
    message:
      'must be an IP address or CIDR range, e.g. 10.0.0.7 or 10.0.0.0/24. ' +
      'A /0 range is not accepted: leave the field empty to match any address.',
  })
  // Safe: the refinement above rejected everything `parsePrefix` returns null for.
  .transform((value) => parsePrefix(value)!.text);

/**
 * The four criteria, shared by create, update and preview so they cannot drift.
 *
 * `nullish` throughout, and the two absent-versus-null cases mean different
 * things on update: undefined leaves a criterion alone, null clears it. Create
 * treats them the same, since there is nothing to leave alone.
 */
const suppressionCriteria = {
  kind: z.enum(ALERT_KINDS).nullish(),
  sourceCidr: prefixSchema.nullish(),
  targetCidr: prefixSchema.nullish(),
  port: z.coerce.number().int().min(1).max(65_535).nullish(),
};

/** Any criterion at all. A rule with none matches every finding on the network. */
export function hasSuppressionCriterion(values: {
  kind?: string | null;
  sourceCidr?: string | null;
  targetCidr?: string | null;
  port?: number | null;
}): boolean {
  return (
    (values.kind ?? null) !== null ||
    (values.sourceCidr ?? null) !== null ||
    (values.targetCidr ?? null) !== null ||
    (values.port ?? null) !== null
  );
}

export const NO_CRITERIA =
  'A suppression rule needs at least one of kind, source, target or port. ' +
  'A rule with none would drop every finding on the network.';

/**
 * `expiresAt` is accepted even when it is already in the past.
 *
 * Refusing it was the first instinct, and it is wrong in two ways. Such a rule is
 * inert, so it cannot hide anything — the failure mode this whole file guards
 * against does not apply. And refusing it would make an edit to any *other* field
 * of an already-expired rule fail, which is how an operator ends up deleting and
 * retyping a rule instead of extending it. The UI marks expired rules instead,
 * which is the honest place for it: the state is visible rather than unrepresentable.
 */
export const suppressionCreateSchema = z
  .object({
    ...suppressionCriteria,
    reason: z.string().trim().min(3, 'reason is required: record why these findings are expected').max(500),
    enabled: z.boolean().default(true),
    expiresAt: z.coerce.date().nullish(),
  })
  .refine(hasSuppressionCriterion, { message: NO_CRITERIA });

/**
 * Every field optional, and no criteria refinement here.
 *
 * The check cannot run on the patch alone: clearing the only criterion of a rule
 * is invalid, and clearing one of two is fine, and the patch does not know which
 * case it is in. The route merges the patch over the stored row and checks the
 * result — see `hasSuppressionCriterion`.
 */
export const suppressionUpdateSchema = z.object({
  ...suppressionCriteria,
  reason: z.string().trim().min(3, 'reason must say why these findings are expected').max(500).optional(),
  enabled: z.boolean().optional(),
  expiresAt: z.coerce.date().nullish(),
});

/** A rule that has not been saved, checked against alerts already stored. */
export const suppressionPreviewSchema = z
  .object({
    ...suppressionCriteria,
    // Bounded like the alert list, and for the same reason: this is the only
    // thing between a caller and a scan of the whole table.
    limit: z.coerce.number().int().min(1).max(2_000).default(500),
  })
  .refine(hasSuppressionCriterion, { message: NO_CRITERIA });

// --- Delivery settings ---

/**
 * A patch to the stored delivery settings.
 *
 * Every field is optional and nullable, and the two mean different things: absent
 * leaves the stored value alone, `null` clears it so the field falls back to the
 * environment or the code default. That distinction is what lets the form omit a
 * secret it is not changing — the API never sends the value out, so requiring it
 * back would mean the form could not save anything else without retyping the
 * webhook URL.
 *
 * Lower bounds here are deliberately the same as the CHECK constraints in
 * V7__Delivery_settings.sql, and the tests compare a rejection at this layer
 * against a rejection at that one rather than trusting that they agree.
 *
 * The upper bounds on `digestSeconds`, `throttleSeconds` and `maxPerHour` are NOT
 * shared with a CHECK constraint — the database accepts any value up to its
 * INTEGER range for those three, only this form caps them. That is a deliberate
 * sanity ceiling on what a person can type into a box, not a mirrored constraint,
 * and the gap is real: a legacy environment value above it (`NOTIFY_MAX_PER_HOUR=
 * 5000`, say) still seeds into the row — env.ts never enforced these fields either
 * — and stays in force from there, reachable only that way, never through this
 * schema.
 */
const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();

export const deliverySettingsPatchSchema = z
  .object({
    // Gates. These apply to the channels a person reads, never to the SIEM feed.
    enabled: z.boolean().nullable().optional(),
    minSeverity: z.enum(SEVERITIES).nullable().optional(),
    // Zero is meaningful for both windows: no batching, no throttling. Negative is
    // not, and a `maxPerHour` of zero would mute every channel — which is what
    // `enabled: false` is for, so it is refused rather than offered as a second
    // spelling of the same thing.
    digestSeconds: z.coerce.number().int().min(0).max(3600).nullable().optional(),
    throttleSeconds: z.coerce.number().int().min(0).max(86_400).nullable().optional(),
    maxPerHour: z.coerce.number().int().min(1).max(1000).nullable().optional(),
    includeEvidence: z.boolean().nullable().optional(),
    dashboardUrl: nullableTrimmed(500),

    /**
     * The webhook URL: a bearer credential for Slack and Teams, accepted here and
     * never returned. See notify/settings.ts.
     *
     * Shape-checked for the same reason `emailFrom` is. A schemeless paste —
     * `hooks.slack.com/services/...`, a plausible copy-paste slip — used to store
     * fine, and then `detectFormat` falls back to `generic` because `new URL()`
     * throws, and every send burns three delivery attempts with 500ms/1s/2s backoff
     * before reporting `webhook request failed`. That is the silent-until-someone-
     * reads-the-logs failure this whole feature exists to remove, so it is refused
     * at the boundary where the operator is still looking at the field.
     *
     * http as well as https: a generic JSON endpoint on an internal network is a
     * legitimate target, and refusing it would be inventing a policy nobody asked
     * for. Every other scheme is refused, which also rules out `javascript:` and
     * `file:` reaching a URL that later gets fetched.
     */
    webhookUrl: z
      .string()
      .trim()
      .max(1000)
      .refine(
        (value) => {
          try {
            return ['http:', 'https:'].includes(new URL(value).protocol);
          } catch {
            return false;
          }
        },
        {
          message:
            'webhookUrl must be a full URL including the scheme, e.g. https://hooks.slack.com/services/…',
        },
      )
      .nullable()
      .optional(),
    webhookFormat: z.enum(WEBHOOK_FORMATS).nullable().optional(),

    syslogHost: nullableTrimmed(255),
    syslogPort: z.coerce.number().int().min(1).max(65_535).nullable().optional(),
    syslogProtocol: z.enum(['udp', 'tcp']).nullable().optional(),
    syslogFormat: z.enum(['cef', 'json']).nullable().optional(),
    syslogRfc: z.enum(['5424', '3164']).nullable().optional(),
    // 16-23 are the local-use facilities; the full range is allowed because a
    // collector may be configured to expect any of them.
    syslogFacility: z.coerce.number().int().min(0).max(23).nullable().optional(),
    syslogAppName: nullableTrimmed(64),
    syslogIncludeEvidence: z.boolean().nullable().optional(),

    emailHost: nullableTrimmed(255),
    emailPort: z.coerce.number().int().min(1).max(65_535).nullable().optional(),
    emailSecure: z.boolean().nullable().optional(),
    // Not validated as an email: this is an SMTP AUTH username, and plenty of
    // providers hand out one that is not email-shaped at all (an API key, a
    // plain account name). Only `from` and `to` are addresses in the RFC 5321
    // sense, so only those get the format check.
    emailUser: nullableTrimmed(255),
    // A password. Accepted, never returned.
    emailPassword: nullableTrimmed(500),
    // z.email(), not a bare trimmed string: this becomes the From: header, and a
    // malformed one used to save successfully and only surface later as a
    // silent SMTP rejection — the same class of failure notify.ts's own
    // isConfigured() checks exist to catch before it gets that far.
    emailFrom: z
      .string()
      .trim()
      .pipe(z.email('emailFrom must be a valid email address'))
      .pipe(z.string().max(255))
      .nullable()
      .optional(),
    /**
     * Recipients as a list, not a comma-separated string.
     *
     * Stored as a Postgres array for the same reason: a recipient containing a comma
     * cannot corrupt the set. A comma-separated string is still accepted, because
     * that is what the environment variable looks like and somebody will paste one.
     */
    emailTo: z
      .union([z.array(z.string()), z.string()])
      .nullable()
      .optional()
      .transform((value) => {
        if (value === null || value === undefined) return value;
        const list = Array.isArray(value) ? value : value.split(',');
        return list.map((entry) => entry.trim()).filter((entry) => entry !== '');
      })
      .pipe(
        z
          .array(
            z
              .string()
              .pipe(z.email('every recipient must be a valid email address'))
              .pipe(z.string().max(320)),
          )
          .max(50)
          .nullable()
          .optional(),
      ),
  })
  // Unknown keys are refused rather than ignored: a typo like `minSeverety` would
  // otherwise return 200 having changed nothing, which is the silent no-op this
  // whole feature is trying not to be.
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'No settings to change. Send at least one field.',
  });

// --- Packet capture ---

export const captureStartSchema = z.object({
  interfaceName: z.string().trim().min(1, 'interfaceName is required'),
  snaplength: z.coerce.number().int().positive().default(65_536),
  timeout: z.coerce.number().int().min(0).default(10),
  ipAddress: z.string().trim().min(1).optional(),
});

export const ipAddressSchema = z.object({
  ipAddress: z.string().trim().min(1, 'ipAddress is required').max(255),
});

// --- Legacy log rows ---

export const logSchema = z.object({
  timestamp: z.coerce.date().optional(),
  sourceip: z.string().trim().min(1, 'sourceip is required').max(200),
  sourcemac: z.string().trim().max(2000).nullish(),
  destinationip: z.string().trim().min(1, 'destinationip is required').max(200),
  destinationmac: z.string().trim().max(2000).nullish(),
  protocol: z.string().trim().min(1, 'protocol is required').max(100),
  ipversion: z.string().trim().max(100).nullish(),
  details: z.string().min(1, 'details is required'),
});

// --- Auth ---

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'email is required').max(200),
  password: z.string().min(1, 'password is required'),
});

/**
 * `role` is accepted here but is only a *request*. What the account actually gets
 * is decided by services/signup-policy.ts from the caller's verified token — see
 * the privilege-escalation fix. Do not wire this field straight into saveUser().
 */
export const signupSchema = z.object({
  username: z.string().trim().max(200).optional(),
  // z.email(), not z.string().email(): the string method is deprecated in zod 4
  // and slated for removal. Order matters — trim before the format check, or a
  // pasted address with trailing whitespace is rejected as malformed.
  email: z.string().trim().pipe(z.email('a valid email is required')).pipe(z.string().max(200)),
  password: z.string().min(8, 'password must be at least 8 characters').max(200),
  firstname: z.string().trim().min(1, 'firstname is required').max(50),
  lastname: z.string().trim().max(50).optional().default(''),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
  langCode: z.string().trim().min(1).max(10).default('en'),
});
