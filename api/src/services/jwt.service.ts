import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenClaims {
  /** User email — the same value the Spring implementation put in `sub`. */
  sub: string;
  uid: number;
  role: string;
}

/**
 * Replaces cyber.wissen.service.JwtService.
 *
 * Two deliberate changes from the Java version:
 *  - the signing key comes from JWT_SECRET instead of being a string literal;
 *  - the user's plaintext password is no longer stored as a `pass` claim.
 */
export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.jwtSecret, {
    algorithm: 'HS512',
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS512'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new jwt.JsonWebTokenError('Token is missing a subject claim');
  }
  return {
    sub: payload.sub,
    uid: Number(payload.uid),
    role: String(payload.role ?? ''),
  };
}

/** Accepts `Bearer <jwt>`, the legacy `CyberWissenBearer <jwt>`, or a bare token. */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const value = authorizationHeader.trim();
  if (value === '') return null;

  for (const prefix of ['Bearer ', 'CyberWissenBearer ']) {
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) {
      const token = value.slice(prefix.length).trim();
      return token === '' ? null : token;
    }
  }
  return value.includes(' ') ? null : value;
}
