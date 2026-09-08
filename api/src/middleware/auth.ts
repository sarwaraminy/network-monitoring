import type { NextFunction, Request, Response } from 'express';
import type { UserRow } from '../db/schema.js';
import { extractBearerToken, verifyAccessToken } from '../services/jwt.service.js';
import { getUserByEmail } from '../services/user.service.js';
import { HttpError, sendError } from './error-handler.js';

declare global {
  // Express's own types are declared as a namespace, so augmenting Request has to
  // follow suit. There is no module-style alternative.
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

/**
 * The Java controllers each repeated "extract the email from the header, look the
 * user up, 404 if absent". That is now one middleware which also actually verifies
 * the signature and expiry before trusting the token.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) {
    sendError(res, HttpError.of(401, 'error.missing_authorization'));
    return;
  }

  let email: string;
  try {
    email = verifyAccessToken(token).sub;
  } catch {
    sendError(res, HttpError.of(401, 'error.token_invalid'));
    return;
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      sendError(res, HttpError.of(401, 'error.account_gone'));
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** A role guard, carrying the roles it enforces so a routing table can be inspected. */
export type RoleGuard = ((req: Request, res: Response, next: NextFunction) => void) & {
  /** Lowercased roles this guard admits. */
  readonly requiredRoles: readonly string[];
};

/** Use after requireAuth. Roles are compared case-insensitively, e.g. 'ADMIN'. */
export function requireRole(...allowed: string[]): RoleGuard {
  const permitted = new Set(allowed.map((role) => role.toLowerCase()));

  const guard = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, HttpError.of(401, 'error.not_authenticated'));
      return;
    }
    if (!permitted.has(req.user.role.toLowerCase())) {
      sendError(res, HttpError.of(403, 'error.insufficient_permissions'));
      return;
    }
    next();
  };

  /*
   * Tagged, so a test can ask a router which of its routes are gated.
   *
   * Not decoration. The recurring bug in this codebase is the fix that stops one
   * step short — capture `/start` was gated on ADMIN while `GET /` stayed open —
   * and that class is invisible to a unit test of the guard itself, which passes
   * either way. What catches it is asserting the shape of the routing table, and
   * an anonymous closure cannot be told apart from any other handler. See
   * routes/route-guards.test.ts.
   */
  return Object.assign(guard, { requiredRoles: [...permitted] as readonly string[] });
}
