import { type Request, Router } from 'express';
import { env } from '../config/env.js';
import type { UserRow } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { extractBearerToken, signAccessToken, verifyAccessToken } from '../services/jwt.service.js';
import {
  ADMIN_TOKEN_REQUIRED,
  decideSignup,
  type Role,
  type SignupDecision,
  signupMode,
} from '../services/signup-policy.js';
import {
  authenticateUser,
  EmailAlreadyExistsError,
  existsByEmail,
  getAllUsers,
  getUserByEmail,
  hasAnyUser,
  saveFirstUser,
  saveUser,
  toPublicUser,
} from '../services/user.service.js';
import type { LoginResponseBody } from '../types/dto.js';
import { loginSchema, signupSchema } from './validation.js';

/** Replaces cyber.wissen.controller.UserController. Mounted at /auth. */
export const authRouter = Router();

const log = componentLogger('auth');

/**
 * Guard for account creation.
 *
 * This endpoint was unauthenticated *and* honoured a `role` of `ADMIN` from the
 * request body, so anyone who could reach the API could mint themselves an
 * administrator of a security monitoring tool. Verified against a running server:
 * one unauthenticated POST returned 201 with `"role":"ADMIN"`.
 *
 * Two callers are legitimate:
 *
 *  1. An authenticated ADMIN adding a colleague. This is the normal path.
 *  2. Nobody, on a brand-new installation with an empty users table — there is no
 *     administrator yet who could authorise the first one. That window closes the
 *     instant the first account exists, so it cannot be used to add a second.
 *
 * Anything else is rejected. `ALLOW_OPEN_SIGNUP` exists for a deployment that
 * genuinely wants public registration, and even then it cannot grant ADMIN.
 *
 * This function only establishes *who is asking*, from a verified token. The
 * decision itself lives in `services/signup-policy.ts`, kept pure so it can be
 * pinned by tests without a database or an HTTP server.
 */
async function authorizeSignup(req: Request, requestedRole: Role): Promise<SignupDecision> {
  const token = extractBearerToken(req.headers.authorization);
  let actorIsAdmin = false;
  let authenticatedButNotAdmin = false;

  if (token !== null) {
    let claims: { sub: string; role: string };
    try {
      claims = verifyAccessToken(token);
    } catch {
      // A presented-but-invalid token is its own answer: do not fall through to
      // the unauthenticated paths, or a garbage token would be treated as no token
      // and could reach the bootstrap or open-signup branch.
      throw new HttpError(401, 'Invalid or expired token.');
    }

    // Resolved against the users table, not read off the claim. `requireAuth` and
    // `requireRole` both re-read the row, and this endpoint cannot use them (the
    // bootstrap path has to work unauthenticated), so it has to do the same work
    // itself. Without this, a deleted or demoted administrator's unexpired token
    // — a day, by default — could still mint a fresh permanent ADMIN, and the
    // documented way to revoke access (`npm run user -- delete`) would not revoke
    // this one route.
    const actor = await getUserByEmail(claims.sub);
    if (!actor) throw new HttpError(401, 'Account no longer exists.');

    // Case-insensitive, matching requireRole, so the two cannot disagree about
    // what counts as an administrator.
    if (actor.role.toUpperCase() === 'ADMIN') actorIsAdmin = true;
    else authenticatedButNotAdmin = true;
  }

  // Only consulted when it can matter, so an admin request costs no extra query.
  const bootstrap = actorIsAdmin || authenticatedButNotAdmin ? false : !(await hasAnyUser());

  return decideSignup(
    { actorIsAdmin, bootstrap },
    requestedRole,
    env.allowOpenSignup,
    authenticatedButNotAdmin,
  );
}

/**
 * GET /auth/users
 *
 * The Java version was unauthenticated and serialised the whole User entity,
 * including every bcrypt hash. It now requires an ADMIN token and returns
 * password-free records.
 */
authRouter.get(
  '/users',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const users = await getAllUsers();
    res.json(users.map(toPublicUser));
  }),
);

/**
 * GET /auth/signup-allowed
 *
 * Lets the UI decide what to show without guessing. Returns whether an
 * unauthenticated caller may create an account, and why — so the sign-up screen can
 * present itself as first-time setup, as public registration, or not at all.
 *
 * Deliberately leaks nothing beyond "does this installation have any users yet",
 * which an attacker can already infer by attempting a login.
 */
authRouter.get(
  '/signup-allowed',
  asyncHandler(async (_req, res) => {
    const anyUserExists = await hasAnyUser();
    const mode = signupMode(anyUserExists, env.allowOpenSignup);
    res.json({ allowed: mode !== 'admin-only', mode });
  }),
);

/**
 * POST /auth/signup
 *
 * Creates an account. See `authorizeSignup` for who is permitted to call this and
 * why — it used to be nobody in particular, which was a privilege-escalation hole.
 */
authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    // Validate first, so an unauthenticated caller cannot distinguish "bad request"
    // from "not permitted" — but authorise before touching the database.
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const input = parsed.data;

    const decision = await authorizeSignup(req, input.role);
    if (!decision.allowed) {
      throw new HttpError(decision.status, decision.message);
    }

    if (await existsByEmail(input.email)) {
      throw new HttpError(409, 'Email is already in use.');
    }

    const values = {
      email: input.email,
      password: input.password,
      // From the policy, never from the body.
      role: decision.role,
      langCode: input.langCode,
      firstname: input.firstname,
      lastname: input.lastname,
    };

    try {
      let user: UserRow;

      if (decision.reason === 'bootstrap') {
        // Atomic: the emptiness test is part of the INSERT, so concurrent
        // anonymous requests on a fresh install cannot all win. `hasAnyUser()`
        // above authorises the request, and a plain check-then-insert would let
        // two callers pass the check and both become ADMIN.
        const created = await saveFirstUser(values);
        if (!created) {
          throw new HttpError(401, ADMIN_TOKEN_REQUIRED);
        }
        user = created;
        log.warn(
          { email: input.email },
          'First account created without authentication (empty users table). That window is now closed.',
        );
      } else {
        user = await saveUser(values);
      }

      res.status(201).json(toPublicUser(user));
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        throw new HttpError(409, 'Email is already in use.');
      }
      throw error;
    }
  }),
);

/**
 * POST /auth/login
 *
 * Response body keeps the old LoginResponse fields and adds `token`. The
 * `Authorization` response header is still set for any client that reads it.
 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const { email, password } = parsed.data;

    const user = await authenticateUser(email, password);
    if (!user) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const token = signAccessToken({ sub: user.email ?? email, uid: user.id, role: user.role });

    const body: LoginResponseBody = {
      id: user.id,
      email: user.email,
      firstName: user.firstname,
      lastName: user.lastname,
      role: user.role,
      token,
    };

    res.setHeader('Authorization', `Bearer ${token}`);
    res.json(body);
  }),
);

/** GET /auth/me — lets the UI validate a stored token on reload. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(toPublicUser(req.user!));
  }),
);
