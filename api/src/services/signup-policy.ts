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
  | { allowed: false; status: 401 | 403; message: string };

export const ADMIN_TOKEN_REQUIRED =
  'Account creation requires an administrator token. Use `npm run user -- create` on the server, ' +
  'or sign in as an administrator.';

export const ADMIN_ONLY = 'Only an administrator can create accounts.';

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
    return { allowed: false, status: 403, message: ADMIN_ONLY };
  }

  if (actor.bootstrap) {
    // Forced, not requested. The first account must be able to administer the
    // installation or there is no way to create the second.
    return { allowed: true, role: 'ADMIN', reason: 'bootstrap' };
  }

  if (openSignupEnabled) {
    return { allowed: true, role: 'USER', reason: 'open-signup' };
  }

  return { allowed: false, status: 401, message: ADMIN_TOKEN_REQUIRED };
}

/** What `/auth/signup-allowed` reports, so the UI can draw the right screen. */
export type SignupMode = 'first-admin' | 'open' | 'admin-only';

export function signupMode(anyUserExists: boolean, openSignupEnabled: boolean): SignupMode {
  if (!anyUserExists) return 'first-admin';
  return openSignupEnabled ? 'open' : 'admin-only';
}
