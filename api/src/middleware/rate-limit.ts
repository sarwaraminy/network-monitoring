import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';

const log = componentLogger('rate-limit');

/**
 * Rate limiting.
 *
 * The login endpoint is the one that matters: without a limit, bcrypt verification
 * is both an online password-guessing oracle and a cheap way to saturate the CPU,
 * because each attempt costs ~100 ms of hashing by design.
 *
 * Limits are disabled in tests so the suite is not throttled by its own traffic.
 */

const disabled = env.nodeEnv === 'test';

interface LimiterOptions {
  /**
   * Count only requests that failed. Without this, a user who signs in normally
   * spends their own quota and can be locked out by ordinary use — while an
   * attacker's failed guesses are what actually need limiting.
   */
  countFailuresOnly?: boolean;
}

function build(
  name: string,
  windowMs: number,
  max: number,
  message: string,
  limiterOptions: LimiterOptions = {},
) {
  const options: Partial<Options> = {
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => disabled,
    skipSuccessfulRequests: limiterOptions.countFailuresOnly === true,
    message: { message },
    handler: (req, res, _next, opts) => {
      log.warn({ limiter: name, ip: req.ip, path: req.path }, 'Rate limit exceeded');
      res.status(opts.statusCode).json({ message });
    },
  };
  return rateLimit(options);
}

/**
 * Credential endpoints — the main brute-force surface, and the reason this file
 * exists: each bcrypt verification costs ~100 ms of CPU by design.
 *
 * Only failed attempts count, so signing in normally never consumes the quota.
 * That keeps the limit meaningful against guessing while staying invisible to
 * legitimate users, including several people behind one NAT address.
 */
export const authLimiter = build(
  'auth',
  60_000,
  env.rateLimit.authPerMinute,
  'Too many failed attempts. Wait a minute and try again.',
  { countFailuresOnly: true },
);

/**
 * Starting a capture puts the interface into promiscuous mode and allocates a
 * 10 MB kernel buffer, so it should not be callable in a loop.
 */
export const captureControlLimiter = build(
  'capture-control',
  60_000,
  env.rateLimit.captureControlPerMinute,
  'Too many capture control requests. Slow down.',
);

/**
 * `ip-info` fans out to reverse DNS, WHOIS and a third-party geolocation API. Left
 * unbounded it would let a caller use this server to hammer someone else's.
 */
export const lookupLimiter = build(
  'lookup',
  60_000,
  env.rateLimit.lookupPerMinute,
  'Too many lookup requests. Slow down.',
);

/** Broad backstop for everything else under /api. */
export const apiLimiter = build('api', 60_000, env.rateLimit.apiPerMinute, 'Too many requests. Slow down.');
