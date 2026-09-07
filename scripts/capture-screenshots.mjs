/**
 * Recaptures the user guide's screenshots.
 *
 * They were taken by hand, which is why they went stale: commit e14c47e had to
 * recapture the lot after the MUI rewrite, and moving the delivery settings
 * under the administration gear invalidated three more. A screenshot in a guide
 * that shows a screen which no longer exists is worse than no screenshot — it is
 * the one a reader trusts over the application in front of them.
 *
 * So this is a script rather than a chore. Point it at a running dev stack:
 *
 *   npm run dev                       # in another terminal
 *   node scripts/capture-screenshots.mjs
 *   node scripts/capture-screenshots.mjs delivery administration-settings
 *
 * Options come from the environment so nothing secret is in the command line
 * that a shell history would keep:
 *
 *   SHOT_URL       origin of the UI          (default http://localhost:5173)
 *   SHOT_EMAIL     an ADMIN account          (required)
 *   SHOT_PASSWORD  its password              (required)
 *   SHOT_OUT       where to write            (default user-guide/screenshots)
 *
 * Every shot signs in fresh. Slower, and worth it: a shot that depended on the
 * state the previous one left behind is a shot that changes when the order does,
 * and the failure looks like a UI bug rather than a script bug.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const URL = process.env.SHOT_URL ?? 'http://localhost:5173';
const EMAIL = process.env.SHOT_EMAIL;
const PASSWORD = process.env.SHOT_PASSWORD;
const OUT = process.env.SHOT_OUT ?? join(ROOT, 'user-guide', 'screenshots');

if (!EMAIL || !PASSWORD) {
  console.error('Set SHOT_EMAIL and SHOT_PASSWORD to an administrator account.');
  process.exit(2);
}

/**
 * 1440x900 at 2x.
 *
 * The guide is read on a laptop and the existing shots are this shape, so a new
 * one at a different size stands out as much as a stale one. 2x because the
 * screenshots carry small text — the settings labels are the content.
 */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

/** Each shot: where to go, what to do when it gets there. */
const SHOTS = {
  'administration-settings': {
    route: '/dashboard',
    async prepare(page) {
      await page.getByRole('button', { name: /administration settings/i }).click();
      // Wait for the panel's own content rather than a timeout: the popover
      // animates, and photographing it mid-transition is how a shot comes out
      // half-transparent.
      await page.getByText('Query console settings').waitFor({ state: 'visible' });
    },
  },
  'delivery-settings': {
    route: '/dashboard',
    async prepare(page) {
      await page.getByRole('button', { name: /administration settings/i }).click();
      await page.getByText('Delivery settings').click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
      // A field from the form itself, so this cannot photograph an empty dialog
      // that is still fetching.
      await page.getByLabel(/minimum severity/i).waitFor({ state: 'visible' });
    },
  },
  'delivery-settings-oauth2': {
    route: '/dashboard',
    async prepare(page) {
      await page.getByRole('button', { name: /administration settings/i }).click();
      await page.getByText('Delivery settings').click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });

      /*
       * The OAuth2 fields are hidden until the method selects them — the form
       * shows one auth method's fields at a time, deliberately, so a password
       * box on an OAuth2 mailbox is not offered. So this has to switch the
       * method rather than just scroll.
       *
       * Nothing is saved: the shot is of the form's state, and the dialog is
       * discarded with the context.
       */
      await page.getByLabel('Authentication').click();
      await page.getByRole('option', { name: 'oauth2' }).click();

      const refreshToken = page.getByLabel(/refresh token/i);
      await refreshToken.waitFor({ state: 'visible' });
      // Into view, so the section this shot is named for is the section in it.
      await refreshToken.scrollIntoViewIfNeeded();
    },
  },
  'query-console-settings': {
    route: '/dashboard',
    async prepare(page) {
      await page.getByRole('button', { name: /administration settings/i }).click();
      await page.getByText('Query console settings').click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
      await page.getByRole('switch', { name: 'Query console' }).waitFor({ state: 'visible' });
    },
  },
  delivery: {
    route: '/delivery',
    async prepare(page) {
      await page
        .getByRole('heading', { name: /delivery/i })
        .first()
        .waitFor({ state: 'visible' });
      // The status panel resolves a request; without waiting the shot catches
      // skeletons, which is a picture of the loading state rather than the page.
      await page.getByRole('button', { name: /send test/i }).waitFor({ state: 'visible' });
    },
  },
  'adhoc-query': {
    route: '/adhoc',
    async prepare(page) {
      await page
        .getByRole('heading', { name: /ad hoc/i })
        .first()
        .waitFor({ state: 'visible' });
    },
  },
};

/**
 * Freezes every transition, then waits for a paint.
 *
 * Playwright's `waitFor({ state: 'visible' })` returns the moment an element is
 * in the layout, which for a MUI popover or dialog is the first frame of its
 * fade-and-scale. The first run of this script photographed the administration
 * panel half-transparent and mid-slide, overlapping the dashboard behind it —
 * a picture of an animation rather than of a panel.
 *
 * `transition: none` snaps whatever is in flight to its final state, so this
 * does not race the animation so much as end it. Injected before each shot
 * rather than once, because a navigation discards the tag.
 */
async function settle(page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      transition: none !important;
      animation: none !important;
    }`,
  });
  // One frame, so the style is in effect for the composite the screenshot takes.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
}

async function signIn(page) {
  await page.goto(`${URL}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // The dashboard is where a successful sign-in lands. Waiting on the URL rather
  // than on content, so a slow first paint is not read as a failed sign-in.
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(SHOTS);

const unknown = names.filter((name) => !(name in SHOTS));
if (unknown.length > 0) {
  console.error(`No such shot: ${unknown.join(', ')}`);
  console.error(`Known: ${Object.keys(SHOTS).join(', ')}`);
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let failed = 0;

for (const name of names) {
  const shot = SHOTS[name];
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    // Belt and braces with `settle`: some MUI transitions honour this, and the
    // ones that do not are caught by the injected stylesheet.
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  try {
    await signIn(page);
    await page.goto(`${URL}${shot.route}`, { waitUntil: 'networkidle' });
    await shot.prepare(page);
    await settle(page);

    const file = join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`ok   ${name}.png`);
  } catch (error) {
    // Named, and the run continues: one broken selector should not cost the
    // other four shots, and knowing which one broke is the whole report.
    console.error(`FAIL ${name}: ${error.message.split('\n')[0]}`);
    failed += 1;
  } finally {
    await context.close();
  }
}

await browser.close();
process.exit(failed === 0 ? 0 : 1);
