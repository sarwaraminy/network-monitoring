import { z } from 'zod';
import { HttpError } from '../middleware/error-handler.js';
import { ALERT_KINDS, SEVERITIES } from '../packet/detect/types.js';

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

export const alertDashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  bucket: z.enum(['hour', 'day']).optional(),
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
