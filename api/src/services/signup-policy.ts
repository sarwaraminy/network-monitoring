import { type ErrorMessageKey, renderError } from '../i18n/catalog/errors.js';
import { DEFAULT_LOCALE } from '../i18n/locales.js';
/**
 * Who may create an account, and what role they get.
 *
 * Extracted from the route so it can be tested without a database or an HTTP
 * server. This is the privilege-escalation surface: `POST /auth/signup` was once
 * unauthenticated *and* honoured a `role` of `ADMIN` taken straight from the
 * request body, so a single anonymous request could mint an administrator of a
 * security monitoring tool. Verified against a running server before the fix: HTTP
 * 201, `"role":"ADMIN"`.
 *
 * Keeping the decision here, pure and exhaustively tested, is what stops that
 * reopening quietly during a later refactor of the route.
 */

export type Role = 'USER' | 'ADMIN';

/** Who is asking, as established from a *verified* token — never from the body. */
export interface SignupActor {
  /** True only when a valid token carrying role ADMIN was presented. */
  actorIsAdmin: boolean;
  /**
   * True only when the users table is empty. A brand-new installation has nobody
   * who could authorise the first account, so exactly one unauthenticated creation
   * is permitted. The window shuts the instant an account exists, so it cannot be
   * used to add a second.
   */
  bootstrap: boolean;
}

export type SignupDecision =
  | { allowed: true; role: Role; reason: 'admin' | 'bootstrap' | 'open-signup' }
  /**
   * Refused, and *which* refusal — a catalogue key rather than a sentence, so the
   * interface can say it in the reader's language. The English text still reaches
   * the client, rendered from this key by `HttpError.of`.
   */
  | { allowed: false; status: 401 | 403; code: ErrorMessageKey };

/*
 * The two refusals, as English sentences.
 *
 * Kept as exports because they are what the tests and the CLI's own help text
 * assert against, but rendered from the catalogue rather than written twice — the
 * decision above names the key, and these are that key in English.
 */
export const ADMIN_TOKEN_REQUIRED = renderError('error.signup_token_required', {}, DEFAULT_LOCALE);

export const ADMIN_ONLY = renderError('error.signup_admin_only', {}, DEFAULT_LOCALE);

/**
 * Decides whether a signup may proceed and with what role.
 *
 * `requestedRole` is treated as a suggestion, never an instruction. It is honoured
 * only for an authenticated administrator. Under open signup it is discarded
 * entirely — a public form that can create administrators is the exact hole this
 * replaced, and quietly downgrading is safer than erroring, because an attacker
 * learns nothing and a legitimate user still gets their account.
 */
export function decideSignup(
  actor: SignupActor,
  requestedRole: Role,
  openSignupEnabled: boolean,
  /** True when a token was presented but did not carry ADMIN. */
  authenticatedButNotAdmin = false,
): SignupDecision {
  if (actor.actorIsAdmin) {
    return { allowed: true, role: requestedRole, reason: 'admin' };
  }

  if (authenticatedButNotAdmin) {
    return { allowed: false, status: 403, code: 'error.signup_admin_only' };
  }

  if (actor.bootstrap) {
    // Forced, not requested. The first account must be able to administer the
    // installation or there is no way to create the second.
    return { allowed: true, role: 'ADMIN', reason: 'bootstrap' };
  }

  if (openSignupEnabled) {
    return { allowed: true, role: 'USER', reason: 'open-signup' };
  }

  return { allowed: false, status: 401, code: 'error.signup_token_required' };
}

/** What `/auth/signup-allowed` reports, so the UI can draw the right screen. */
export type SignupMode = 'first-admin' | 'open' | 'admin-only';

export function signupMode(anyUserExists: boolean, openSignupEnabled: boolean): SignupMode {
  if (!anyUserExists) return 'first-admin';
  return openSignupEnabled ? 'open' : 'admin-only';
}
