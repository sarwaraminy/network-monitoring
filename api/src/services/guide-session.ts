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
 *   - **A different purpose claim.** A guide cookie presented as a Bearer token
 *     is refused by `verifyAccessToken`, and an access token pasted into the
 *     cookie is refused here. Two credentials that grant different things must
 *     not be interchangeable, or the narrower one becomes a way to hold the
 *     wider one.
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

interface GuideClaims {
  sub: string;
  /** Fixed, and the thing that stops this being usable as an access token. */
  purpose: 'user-guide';
}

export function signGuideSession(email: string): { value: string; maxAgeSeconds: number } {
  const claims: GuideClaims = { sub: email, purpose: 'user-guide' };
  const value = jwt.sign(claims, env.jwtSecret, { algorithm: 'HS512', expiresIn: TTL_SECONDS });
  return { value, maxAgeSeconds: TTL_SECONDS };
}

/** True when the value is a guide session this server issued and it has not expired. */
export function isValidGuideSession(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const payload = jwt.verify(value, env.jwtSecret, { algorithms: ['HS512'] });
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
