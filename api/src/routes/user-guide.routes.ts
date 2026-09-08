import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, Router } from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { componentLogger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError, sendError } from '../middleware/error-handler.js';
import {
  GUIDE_COOKIE,
  GUIDE_COOKIE_PATH,
  isValidGuideSession,
  readCookie,
  signGuideSession,
} from '../services/guide-session.js';
import { extractBearerToken } from '../services/jwt.service.js';

const log = componentLogger('user-guide');

/**
 * The user guide, served only to somebody who has signed in.
 *
 * Two routers, because they are mounted at different places and only one of them
 * is behind the gate:
 *
 *   - `guideSessionRouter` at `/api/user-guide` — mints and clears the cookie,
 *     and is itself protected the ordinary way, by a Bearer token.
 *   - `userGuideRouter` at `/user-guide` — the files, behind the cookie.
 *
 * The files live at the repository root rather than in the UI's `public/`
 * directory, and that is the whole design rather than a filing preference:
 * anything under `public/` is copied into the bundle and served by nginx as a
 * static asset, where no check of ours runs. Putting them there is exactly how a
 * gate gets bypassed, so they are somewhere static serving cannot reach and the
 * application hands them out itself. The sibling `professional` project's
 * `user-guide-gate` says the same thing about its own help, in the same words:
 * deliberately NOT `public/`.
 *
 * Both the Vite dev server and nginx forward `/user-guide` here, so development
 * and production run the same gate rather than two that can drift.
 */

/** Where the guide's files are, whichever way this process was started. */
function resolveGuideDirectory(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));

  /*
   * Three roots, because the same code runs from three layouts: compiled under
   * `api/dist/routes` in the container, from `api/src/routes` under tsx in
   * development, and from wherever a test's working directory happens to be.
   * Checked rather than assumed — a wrong guess here would serve nothing and say
   * nothing about why.
   */
  const candidates = [
    path.resolve(here, '../../../user-guide'),
    path.resolve(here, '../../../../user-guide'),
    path.resolve(process.cwd(), 'user-guide'),
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) ?? null;
}

const guideDirectory = resolveGuideDirectory();

if (guideDirectory === null) {
  // Not fatal. The guide missing is a documentation problem, not a reason to
  // refuse to monitor a network — but it is invisible without this line, and the
  // symptom (a help link that 404s) says nothing about the cause.
  log.warn('User guide files were not found; /user-guide will answer 404');
}

/** `POST` and `DELETE /api/user-guide/session`. Bearer-authenticated as usual. */
export const guideSessionRouter = Router();

guideSessionRouter.use(requireAuth);

/**
 * Mints the guide session for the signed-in account.
 *
 * Called by the application once it knows who it is talking to, so that opening
 * the guide stays an ordinary link — a plain anchor the browser can middle-click,
 * copy, or open in a new tab, rather than a control that has to run code first.
 */
guideSessionRouter.post(
  '/session',
  asyncHandler(async (req: Request, res: Response) => {
    const email = req.user?.email ?? 'unknown';
    /*
     * Capped at whatever is left of the caller's access token.
     *
     * The two credentials had independent lifetimes and nothing linking them, so
     * a dashboard left open past its token's expiry kept a valid guide cookie:
     * the next request 401s, the sign-in screen renders, and `/user-guide/*` goes
     * on serving the whole guide — screenshots of a real dashboard, the delivery
     * configuration, the shape of the alerts table — to whoever next sits down.
     * The same "working credential left in the browser" the sign-out fix was
     * written for, reached through the adjacent door.
     *
     * Clearing it on a 401 cannot work, which is why this is a cap rather than a
     * revocation: the clear endpoint needs the access token, and the token is
     * precisely what has expired. The cookie is also scoped to `/user-guide`, so
     * the browser does not send it to `/api/user-guide/session` and the cookie
     * cannot authenticate its own removal. Capping the life removes the gap
     * instead of trying to close it after the fact, and the renewal loop re-caps
     * it every four hours while the session is alive.
     */
    const { value, maxAgeSeconds } = signGuideSession(email, remainingTokenSeconds(req));

    res.cookie(GUIDE_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      /*
       * Keyed on the actual scheme, not on `NODE_ENV`.
       *
       * It used to be `env.nodeEnv === 'production'`, which reads as the safe
       * default and is not: Compose sets `NODE_ENV: production` and serves plain
       * HTTP — nginx listens on 80 and the only published port is
       * `${HTTP_PORT:-8080}:80`, with no TLS anywhere in the file or the README.
       * A `Secure` cookie over an untrustworthy origin is discarded silently, so
       * the mint answered 204, nothing was stored, and every `/user-guide/*`
       * request redirected to `/login` — which now bounces an authenticated
       * reader back to the dashboard. Not a degraded guide: an inaccessible one,
       * with a loop and no explanation.
       *
       * The same localhost-only-works shape as the `upgrade-insecure-requests`
       * bug, surviving for the same reason — `localhost` is a trustworthy origin,
       * so the cookie is stored on the machine the feature was built on.
       *
       * `x-forwarded-proto` for the deployments that terminate TLS upstream;
       * `trust proxy` is already set for those in app.ts.
       */
      secure: req.secure || req.get('x-forwarded-proto') === 'https',
      path: GUIDE_COOKIE_PATH,
      maxAge: maxAgeSeconds * 1000,
    });

    res.status(204).end();
  }),
);

/**
 * Seconds left on the caller's access token, or `undefined` if it cannot be read.
 *
 * `requireAuth` has already verified the token by the time this runs, so `exp` is
 * present and in the future; the fallback exists because reading a claim off a
 * request should not be able to throw its way out of a route.
 */
function remainingTokenSeconds(req: Request): number | undefined {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) return undefined;

  const payload = jwt.decode(token);
  if (typeof payload !== 'object' || payload === null) return undefined;

  const exp = (payload as { exp?: number }).exp;
  if (typeof exp !== 'number') return undefined;

  return Math.max(0, exp - Math.floor(Date.now() / 1000));
}

/** Clears it, so signing out closes the guide too. */
guideSessionRouter.delete(
  '/session',
  asyncHandler(async (_req: Request, res: Response) => {
    res.clearCookie(GUIDE_COOKIE, { path: GUIDE_COOKIE_PATH, httpOnly: true, sameSite: 'lax' });
    res.status(204).end();
  }),
);

/** `/user-guide` — the files themselves, behind the cookie. */
export const userGuideRouter = Router();

/**
 * The guide's own Content-Security-Policy, replacing the application's.
 *
 * The app-wide policy was written for a process that "serves JSON only", and
 * helmet's defaults turn that into a header carrying `upgrade-insecure-requests`.
 * That was free while nothing here was a page. It is not free now: the shipped
 * stack is plain HTTP end to end — Compose publishes `${HTTP_PORT:-8080}:80` and
 * there is no TLS anywhere in it — so on any real install the guide document's
 * own policy rewrote its stylesheet, its two scripts and its twelve screenshots
 * to `https://host:8080/…`, where nothing is listening.
 *
 * What that looked like: an unstyled page with no contents list, no pager and no
 * images — and `guard.js` never running, so the second layer that returns the tab
 * to `/login` after a sign-out in another tab was silently gone. Chrome exempts
 * `localhost` from the upgrade, so it worked on the machine that took the
 * screenshots and failed everywhere else.
 *
 * `useDefaults: false` because the point is to control the whole list rather than
 * inherit a directive that is wrong here. Everything the guide loads is a file
 * next to it, so same-origin is the whole policy; there are no inline styles or
 * scripts in these pages, so neither needs an exception.
 */
userGuideRouter.use(
  helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      /*
       * The guide's first page embeds the product tour, and `media-src` has no
       * fallback but `default-src` — which is `'none'` here, so without this
       * line the video element loads nothing and reports no reason. Same failure
       * mode as the upgrade-insecure-requests one above: fine on the machine
       * that recorded it, an empty black rectangle on every install.
       */
      mediaSrc: ["'self'"],
    },
  }),
);

/**
 * The gate.
 *
 * Applied to every request for a guide file, not only the entry page: a
 * stylesheet and a dozen screenshots are separate requests, and gating the HTML
 * alone would leave the illustrations readable by anybody.
 *
 * Refused either way; what differs is only which unhelpful answer is the more
 * useful one. A request for a *page* is redirected to the sign-in screen, because
 * somebody is looking at a browser window and that is where they have to end up
 * anyway. A request for a stylesheet or a screenshot gets the status code, since
 * a redirect in an `<img>` is just a broken image.
 *
 * Decided on the path rather than on `Accept`, which does not separate the two:
 * `fetch` and several browsers send `Accept: * / *` for a sub-resource, and
 * content negotiation reads that as "html is fine" — so every asset was being
 * answered with a redirect to the sign-in page.
 */
function looksLikeAPage(pathname: string): boolean {
  return pathname === '/' || pathname.endsWith('/') || pathname.endsWith('.html');
}

userGuideRouter.use((req, res, next) => {
  if (isValidGuideSession(readCookie(req.headers.cookie, GUIDE_COOKIE))) {
    next();
    return;
  }

  if (looksLikeAPage(req.path)) {
    res.redirect(302, '/login');
    return;
  }

  sendError(res, HttpError.of(401, 'error.guide_sign_in'));
});

if (guideDirectory !== null) {
  userGuideRouter.use(
    express.static(guideDirectory, {
      // `index.html` is served explicitly below for the bare path, so that a
      // directory request cannot bypass anything by a different route.
      index: false,
      // Documentation, and the screenshots are the bulk of it. Revalidated
      // rather than held, so a corrected topic is not stuck in a cache.
      maxAge: 0,
      etag: true,
      // No directory listings, and no serving of dotfiles.
      dotfiles: 'ignore',
      redirect: false,
    }),
  );

  /*
   * `/user-guide` and `/user-guide/` have to converge, and only one of them can
   * be served directly.
   *
   * Served for both, the no-slash spelling gave the document a base URL of
   * `/user-guide` rather than `/user-guide/`, so every relative reference
   * resolved one level up: `assets/guide.css` became `/assets/guide.css` and
   * `topics/about.html` became `/topics/about.html`. Those miss this router
   * entirely and land on the SPA fallback, which answers each with the
   * application shell at 200 — the browser gets HTML where it asked for CSS, the
   * page renders unstyled with dead links, and `guard.js` never runs. A 200 with
   * the right title, so it looks like it worked.
   *
   * Express gives this route `/` for both spellings, so the distinction cannot
   * come from the route: `originalUrl` is the only place it survives. The static
   * layer keeps `redirect: false` — it should not be emitting redirects of its
   * own — and this one redirect is enough to make the two agree.
   */
  userGuideRouter.get('/', (req, res) => {
    const [pathOnly = ''] = req.originalUrl.split('?');
    if (!pathOnly.endsWith('/')) {
      res.redirect(301, `${GUIDE_COOKIE_PATH}/`);
      return;
    }
    res.sendFile(path.join(guideDirectory, 'index.html'));
  });

  userGuideRouter.get('/index.html', (_req, res) => {
    res.sendFile(path.join(guideDirectory, 'index.html'));
  });
}
