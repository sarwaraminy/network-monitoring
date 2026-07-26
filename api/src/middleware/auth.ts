import type { NextFunction, Request, Response } from 'express';
import type { UserRow } from '../db/schema.js';
import { extractBearerToken, verifyAccessToken } from '../services/jwt.service.js';
import { getUserByEmail } from '../services/user.service.js';

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
    res.status(401).json({ message: 'Missing Authorization header' });
    return;
  }

  let email: string;
  try {
    email = verifyAccessToken(token).sub;
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      res.status(401).json({ message: 'Account no longer exists' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Use after requireAuth. Roles are compared case-insensitively, e.g. 'ADMIN'. */
export function requireRole(...allowed: string[]) {
  const permitted = new Set(allowed.map((role) => role.toLowerCase()));

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    if (!permitted.has(req.user.role.toLowerCase())) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
