import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, Router } from 'express';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import {
  GUIDE_COOKIE,
  GUIDE_COOKIE_PATH,
  isValidGuideSession,
  readCookie,
  signGuideSession,
} from '../services/guide-session.js';

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
    const { value, maxAgeSeconds } = signGuideSession(email);

    res.cookie(GUIDE_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      // Only over TLS in production. Left off otherwise, or development over
      // plain http would set a cookie the browser then refuses to send back.
      secure: env.nodeEnv === 'production',
      path: GUIDE_COOKIE_PATH,
      maxAge: maxAgeSeconds * 1000,
    });

    res.status(204).end();
  }),
);

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

  res.status(401).json({ message: 'Sign in to read the user guide.' });
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

  userGuideRouter.get(['/', '/index.html'], (_req, res) => {
    res.sendFile(path.join(guideDirectory, 'index.html'));
  });
}
