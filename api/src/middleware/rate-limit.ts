import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env.js';
import type { ErrorMessageKey } from '../i18n/catalog/errors.js';
import { componentLogger } from '../logger.js';
import { HttpError } from './error-handler.js';

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
  /**
   * A catalogue key, not a sentence.
   *
   * These bodies are written before the error handler can see them, so they used
   * `res.json({ message })` and carried no `code` — leaving the 429 a browser
   * shows on the LOGIN screen untranslatable. That is the one screen reached
   * before any language preference is known, and the one most likely to be read
   * by somebody who does not read English.
   */
  code: ErrorMessageKey,
  limiterOptions: LimiterOptions = {},
) {
  const error = HttpError.of(429, code);
  const options: Partial<Options> = {
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => disabled,
    skipSuccessfulRequests: limiterOptions.countFailuresOnly === true,
    message: { message: error.message, code: error.code, params: error.params },
    handler: (req, res, _next, opts) => {
      log.warn({ limiter: name, ip: req.ip, path: req.path }, 'Rate limit exceeded');
      // `opts.statusCode` rather than the error's, so a caller overriding the
      // limiter's status still wins — the body is what this is fixing.
      res.status(opts.statusCode).json({
        message: error.message,
        code: error.code,
        params: error.params,
      });
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
export const authLimiter = build('auth', 60_000, env.rateLimit.authPerMinute, 'error.too_many_logins', {
  countFailuresOnly: true,
});

/**
 * Starting a capture puts the interface into promiscuous mode and allocates a
 * 10 MB kernel buffer, so it should not be callable in a loop.
 */
export const captureControlLimiter = build(
  'capture-control',
  60_000,
  env.rateLimit.captureControlPerMinute,
  'error.too_many_capture',
);

/**
 * `ip-info` fans out to reverse DNS, WHOIS and a third-party geolocation API. Left
 * unbounded it would let a caller use this server to hammer someone else's.
 */
export const lookupLimiter = build('lookup', 60_000, env.rateLimit.lookupPerMinute, 'error.too_many_lookups');

/** Broad backstop for everything else under /api. */
export const apiLimiter = build('api', 60_000, env.rateLimit.apiPerMinute, 'error.too_many_requests');
