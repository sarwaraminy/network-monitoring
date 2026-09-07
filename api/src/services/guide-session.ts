import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * The user guide's own session, and why it needs one.
 *
 * The guide is static HTML served at `/user-guide`, and it must not be readable
 * by somebody who has not signed in. Every other protected thing here is fetched
 * by the application with an `Authorization: Bearer` header — but this is a plain
 * navigation. A browser following a link, or loading the stylesheet and the
 * screenshots that page references, sends no header the application can add: the
 * access token lives in `localStorage`, which only JavaScript on the page can
 * read, and there is no JavaScript involved in `GET /user-guide/assets/guide.css`.
 *
 * So the gate needs a credential the browser carries on its own, which means a
 * cookie. This is that cookie, and it is deliberately not the access token:
 *
 *   - **A signing key of its own**, and this is the one that matters. The first
 *     version signed with `env.jwtSecret` and distinguished the two by a `purpose`
 *     claim — but `verifyAccessToken` never looked at that claim, so the cookie was
 *     a fully working `Authorization: Bearer` token for the same user, on every
 *     authenticated route including the ADMIN ones, for its whole twelve hours. The
 *     comment here said it was refused; nothing refused it. A separate key makes
 *     the two non-interchangeable by signature rather than by a check somebody has
 *     to remember, and `verifyAccessToken` now also rejects anything carrying a
 *     `purpose` claim, so the two defences are independent.
 *
 *     Derived from `JWT_SECRET` rather than configured separately: an operator who
 *     has to add a second secret before documentation works will not, and a
 *     defaulted second secret is worse than none. Rotating `JWT_SECRET` rotates
 *     both, which is the behaviour anyone would expect.
 *   - **`Path=/user-guide`.** The browser sends it to nothing else, so it cannot
 *     reach the API even if it were somehow accepted there.
 *   - **`HttpOnly`.** Script cannot read it, so a cross-site scripting bug on the
 *     application cannot lift it out and replay it.
 *   - **`SameSite=Lax`.** It rides a top-level navigation from our own page,
 *     which is exactly how the guide is opened, and not a cross-site request.
 *
 * The shape follows the `user-guide-gate` in the sibling `professional` project:
 * a session minted only after an authenticated sign-in, checked server-side on
 * every request for a guide file, with a client-side guard inside the guide pages
 * as the second layer for the case a cookie cannot see — a sign-out that happened
 * in another tab while the guide sat open.
 */

/** The cookie's name. Prefixed, so it is obvious in a browser's cookie list. */
export const GUIDE_COOKIE = 'nmt_guide_session';

/** Scoped to the guide alone: the browser sends it nowhere else. */
export const GUIDE_COOKIE_PATH = '/user-guide';

/**
 * How long a guide session lasts.
 *
 * Deliberately short-ish and independent of the access token's lifetime. The
 * consequence of it expiring is being bounced to the sign-in page while reading
 * documentation, which is a small cost; the consequence of it outliving the
 * account's access is a former employee reading the manual, which is a small harm
 * but not one worth carrying for a week.
 */
const TTL_SECONDS = 12 * 60 * 60;

/**
 * This session's signing key: HMAC-derived from `JWT_SECRET` under a fixed label.
 *
 * Domain separation, so a guide cookie cannot verify as an access token and an
 * access token cannot verify as a guide cookie — not because a claim is checked,
 * but because neither signature is valid under the other's key. The label is
 * versioned so the derivation can change later without silently accepting tokens
 * minted under the old one.
 */
const GUIDE_KEY = createHmac('sha256', env.jwtSecret).update('nmt:user-guide-session:v1').digest();

interface GuideClaims {
  sub: string;
  /**
   * Fixed. Belt to the separate key's braces: `verifyAccessToken` refuses any token
   * carrying this claim, so even a future token type that shared the signing key
   * could not be replayed as API access.
   */
  purpose: 'user-guide';
}

/**
 * Mints a session, never outliving `capSeconds` when one is given.
 *
 * The cap is the caller's remaining access-token life — see the mint route. Two
 * credentials with independent lifetimes meant the shorter-lived-by-design one
 * could outlive the session that authorised it, which is the opposite of what
 * "deliberately short" was for.
 */
export function signGuideSession(
  email: string,
  capSeconds?: number,
): { value: string; maxAgeSeconds: number } {
  const ttl = capSeconds === undefined ? TTL_SECONDS : Math.max(0, Math.min(TTL_SECONDS, capSeconds));
  const claims: GuideClaims = { sub: email, purpose: 'user-guide' };
  const value = jwt.sign(claims, GUIDE_KEY, { algorithm: 'HS512', expiresIn: ttl });
  return { value, maxAgeSeconds: ttl };
}

/** True when the value is a guide session this server issued and it has not expired. */
export function isValidGuideSession(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const payload = jwt.verify(value, GUIDE_KEY, { algorithms: ['HS512'] });
    return (
      typeof payload === 'object' && payload !== null && (payload as GuideClaims).purpose === 'user-guide'
    );
  } catch {
    // Expired, tampered with, signed by somebody else, or not a token at all.
    return false;
  }
}

/**
 * One cookie's value out of a `Cookie` header.
 *
 * Hand-parsed rather than adding `cookie-parser`: this is the only cookie the
 * application has, and a dependency that runs on every request to read one
 * header is not worth it. Values are URL-encoded on the way out, so they are
 * decoded here; a name that appears twice takes the first, matching how browsers
 * order the more specific path first.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is not a session; treat it as absent rather
      // than throwing out of a request that only wanted to read a cookie.
      return undefined;
    }
  }

  return undefined;
}
