/**
 * Records the product tour that the README links to.
 *
 * The README is two thousand lines, which is right for whoever installs and
 * changes this thing and wrong for whoever is deciding in ninety seconds
 * whether it is worth installing at all. This produces the thing that answers
 * that second question: a silent, captioned walk through the screens, in the
 * order that explains them — a finding is raised, you open it, you read the
 * evidence, you suppress the scanner that raised it, you send it somewhere.
 *
 * It is a sibling of `capture-screenshots.mjs`, for the same reason that one
 * exists. A demo recorded by hand goes stale the first time a screen moves, and
 * a tour showing a screen which no longer exists is worse than no tour: it is
 * the one a reader trusts over the application in front of them. So this is a
 * script, and re-recording is a command rather than an afternoon.
 *
 *   FLOW_ENABLED=true INTEL_ENABLED=true \
 *     INTEL_FEEDS=demo=scripts/demo/indicators.txt npm run dev   # one terminal
 *   tsx scripts/demo/traffic.mts                                 # fill the screens
 *   node scripts/record-demo.mjs                                 # then record
 *
 * Options come from the environment, so no password is in a command line that a
 * shell history would keep:
 *
 *   DEMO_URL       origin of the UI              (default http://localhost:5173)
 *   DEMO_EMAIL     an ADMIN account              (required)
 *   DEMO_PASSWORD  its password                  (required)
 *   DEMO_OUT       where to write                (default user-guide/video)
 *   FFMPEG         ffmpeg binary                 (default `ffmpeg` on PATH)
 *
 * Playwright records WebM and cannot be talked out of it, so the conversion to
 * H.264 is a second pass. It needs a real ffmpeg: the one bundled with
 * Playwright's browsers is compiled down to VP8 and PNG only, which is enough
 * for Playwright and not enough for this. `npm i -D ffmpeg-static` and point
 * FFMPEG at it if the machine has none.
 *
 * Sign in with an account that exists only to be filmed. The tour types the
 * address into the login form on camera, and a real administrator's address
 * would then be in a video attached to a public README for good.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const URL = process.env.DEMO_URL ?? 'http://localhost:5173';
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
const OUT = process.env.DEMO_OUT ?? join(ROOT, 'user-guide', 'video');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

if (!EMAIL || !PASSWORD) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD to an administrator account.');
  process.exit(2);
}

/**
 * 1440x900, the shape the guide's screenshots are already in.
 *
 * Recorded at 1x rather than their 2x: Playwright's video comes out the size
 * given here whatever the device scale factor, so a 2x context would cost four
 * times the compositing work per frame to produce the same pixels — and a
 * recording that cannot keep up drops them.
 */
const VIEWPORT = { width: 1440, height: 900 };

const FILE = 'nmt-tour';

/**
 * Everything the captions and the drawn cursor need, injected into every page.
 *
 * `addInitScript` rather than a one-off `evaluate`, because a navigation throws
 * the page away and with it any overlay attached to the old one — and this tour
 * navigates nine times. Appended to `documentElement` rather than `body`, which
 * React owns and re-renders.
 *
 * The cursor is drawn rather than real. Playwright moves an input cursor that
 * the compositor never paints, so a recording of a real click is a recording of
 * a page changing for no visible reason. This one is a div, moved to wherever
 * the real mouse is about to be told to go, so a viewer sees the click land on
 * the control it lands on.
 */
function installOverlay() {
  const style = document.createElement('style');
  style.textContent = `
    #demo-caption, #demo-cursor, #demo-card {
      position: fixed; z-index: 2147483647; pointer-events: none;
      font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
    }
    #demo-caption {
      left: 40px; bottom: 40px; max-width: 640px;
      padding: 18px 24px 20px; border-radius: 14px;
      background: rgba(9, 14, 24, 0.9); color: #f8fafc;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(148, 163, 184, 0.28);
      opacity: 0; transform: translateY(14px);
      transition: opacity 420ms ease, transform 420ms ease;
    }
    #demo-caption[data-shown="yes"] { opacity: 1; transform: translateY(0); }
    #demo-caption .demo-kicker {
      font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
      color: #7dd3fc; margin-bottom: 7px; font-weight: 700;
    }
    #demo-caption .demo-title { font-size: 25px; font-weight: 700; line-height: 1.2; }
    #demo-caption .demo-body {
      font-size: 15.5px; line-height: 1.5; color: #cbd5e1; margin-top: 8px;
    }
    #demo-cursor {
      left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px;
      border-radius: 50%; border: 2px solid rgba(125, 211, 252, 0.95);
      background: rgba(125, 211, 252, 0.22);
      box-shadow: 0 0 0 6px rgba(125, 211, 252, 0.14);
      opacity: 0;
      transition: transform 480ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 260ms ease;
    }
    #demo-cursor[data-shown="yes"] { opacity: 1; }
    #demo-card {
      inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
      background: radial-gradient(circle at 50% 38%, #14283f 0%, #070b12 70%);
      color: #f8fafc; opacity: 0; transition: opacity 620ms ease;
    }
    #demo-card[data-shown="yes"] { opacity: 1; }
    #demo-card .demo-card-title { font-size: 60px; font-weight: 800; letter-spacing: -0.02em; }
    #demo-card .demo-card-rule {
      width: 76px; height: 4px; border-radius: 2px; background: #38bdf8; margin: 30px 0 0;
    }
    #demo-card .demo-card-sub {
      font-size: 22px; color: #94a3b8; margin-top: 26px; max-width: 820px; line-height: 1.45;
    }
  `;
  document.documentElement.append(style);

  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  caption.innerHTML =
    '<div class="demo-kicker"></div><div class="demo-title"></div><div class="demo-body"></div>';

  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';

  const card = document.createElement('div');
  card.id = 'demo-card';
  card.innerHTML =
    '<div class="demo-card-title"></div><div class="demo-card-rule"></div><div class="demo-card-sub"></div>';

  document.documentElement.append(caption, cursor, card);

  window.__demo = {
    caption(kicker, title, body) {
      caption.querySelector('.demo-kicker').textContent = kicker;
      caption.querySelector('.demo-title').textContent = title;
      caption.querySelector('.demo-body').textContent = body || '';
      caption.dataset.shown = 'yes';
    },
    hideCaption() {
      delete caption.dataset.shown;
    },
    cursorTo(x, y) {
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cursor.dataset.shown = 'yes';
    },
    press(x, y) {
      // Scaled about the same translation rather than replacing it, which would
      // send the ring back to the top-left corner for the length of the click.
      cursor.style.transform = `translate(${x}px, ${y}px) scale(0.72)`;
    },
    release(x, y) {
      cursor.style.transform = `translate(${x}px, ${y}px)`;
    },
    hideCursor() {
      delete cursor.dataset.shown;
    },
    card(title, sub) {
      card.querySelector('.demo-card-title').textContent = title;
      card.querySelector('.demo-card-sub').textContent = sub || '';
      card.dataset.shown = 'yes';
    },
    hideCard() {
      delete card.dataset.shown;
    },
  };
}

const wait = (page, ms) => page.waitForTimeout(ms);

function caption(page, kicker, title, body) {
  return page.evaluate(([k, t, b]) => window.__demo.caption(k, t, b), [kicker, title, body]);
}

/**
 * Moves the drawn cursor onto a target, then clicks it for real.
 *
 * The pause between the two is what makes a click legible: arriving and
 * actuating in the same frame reads as a jump cut, and the viewer never learns
 * which control was pressed.
 */
async function clickVisibly(page, locator, { settleMs = 700 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('target has no box on screen');

  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await page.evaluate(([px, py]) => window.__demo.cursorTo(px, py), [x, y]);
  await wait(page, 620);
  await page.evaluate(([px, py]) => window.__demo.press(px, py), [x, y]);
  await page.mouse.click(x, y);
  await wait(page, 170);
  await page.evaluate(([px, py]) => window.__demo.release(px, py), [x, y]);
  await wait(page, settleMs);
}

/**
 * Navigates by clicking the sidebar, and falls back to the URL.
 *
 * Clicking is the point — a tour where the nav never moves does not show that
 * these screens are one application — but a collapsed nav group or a renamed
 * label should cost this beat its click, not the whole take.
 */
async function visit(page, label, path) {
  const link = page.getByRole('link', { name: label, exact: true }).first();
  try {
    if (await link.isVisible({ timeout: 2_000 })) {
      await clickVisibly(page, link, { settleMs: 1_400 });
      await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 });
      return;
    }
  } catch {
    // Falls through to the URL below.
  }
  await page.goto(`${URL}${path}`, { waitUntil: 'networkidle' });
  await wait(page, 1_400);
}

/** Each beat: what to open, what to say about it, how long to leave it up. */
const BEATS = [
  {
    name: 'dashboard',
    async run(page) {
      await visit(page, 'Dashboard', '/dashboard');
      await caption(
        page,
        'Dashboard',
        'What the network is doing',
        'Findings by severity, the detectors that raised them, and a trend that survives retention — an expiring day is rolled up rather than deleted.',
      );
      await wait(page, 7_500);
      await page.mouse.wheel(0, 420);
      await wait(page, 4_500);
      await page.mouse.wheel(0, -420);
      await wait(page, 1_200);
    },
  },
  {
    name: 'alerts',
    async run(page) {
      await visit(page, 'Security Alerts', '/alerts');
      await caption(
        page,
        'Security alerts',
        'Findings, not a packet log',
        'Eight detectors write here. Each row is one finding with a severity and an occurrence count — a scan of forty ports is one alert, not forty.',
      );
      await wait(page, 8_000);
    },
  },
  {
    name: 'evidence',
    async run(page) {
      await clickVisibly(page, page.getByRole('button', { name: /expand/i }).first(), {
        settleMs: 1_000,
      });
      await caption(
        page,
        'Evidence',
        'Why it fired',
        'Every finding carries the structured evidence behind it — the ports touched, the window they were touched in, the exporter that reported them.',
      );
      await wait(page, 8_500);
    },
  },
  {
    name: 'threat-intel',
    async run(page) {
      await visit(page, 'Threat Intel', '/threat-intel');
      await caption(
        page,
        'Threat intelligence',
        'Feeds that work offline',
        'Local indicator files are first-class and downloaded feeds cache to disk, so a monitoring host with no outbound internet still starts from the last known-good copy.',
      );
      await wait(page, 8_000);
    },
  },
  {
    name: 'suppressions',
    async run(page) {
      await visit(page, 'Suppressions', '/suppressions');
      await caption(
        page,
        'Suppressions',
        'Silence the authorised scanner',
        'The nightly vulnerability scan is not an incident. Suppress it by source, kind and severity, so the alerts table keeps meaning something to whoever is on call.',
      );
      await wait(page, 8_000);
    },
  },
  {
    name: 'adhoc',
    async run(page) {
      await visit(page, 'Ad Hoc Query', '/adhoc');
      await caption(
        page,
        'Ad hoc query',
        'Read-only SQL, when you need it',
        'For the question the screens do not answer. Administrators only, off by default, and every statement lands in the audit trail.',
      );
      await wait(page, 8_000);
    },
  },
  {
    name: 'capture',
    async run(page) {
      await visit(page, 'Capture by Interface', '/capture-packets');
      await caption(
        page,
        'Packet capture',
        'Full packets, when you need payload',
        'Capture from an interface for the detectors that must see inside a packet — cleartext credentials, DNS tunnelling. Flow collection covers the rest with one line of switch config.',
      );
      await wait(page, 8_000);
    },
  },
  {
    name: 'delivery',
    async run(page) {
      await visit(page, 'Delivery', '/delivery');
      await caption(
        page,
        'Delivery',
        'Out to where people are looking',
        'Email, syslog and CEF, with a severity floor so a medium finding does not page anyone at three in the morning. Send a test before you trust it.',
      );
      await wait(page, 8_000);
    },
  },
  {
    name: 'audit',
    async run(page) {
      await visit(page, 'Audit Trail', '/activity');
      await caption(
        page,
        'Audit trail',
        'Append-only, enforced by the database',
        'Who acknowledged what, who deleted what, who changed which setting. The database itself refuses to modify a recorded event.',
      );
      await wait(page, 8_000);
    },
  },
];

mkdirSync(OUT, { recursive: true });

/** Playwright names the WebM itself, so it gets a directory of its own to name it in. */
const RAW = join(OUT, '.raw');
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: RAW, size: VIEWPORT },
});
await context.addInitScript(installOverlay);

const page = await context.newPage();
const failed = [];

try {
  await page.goto(`${URL}/login`, { waitUntil: 'networkidle' });

  await page.evaluate(() =>
    window.__demo.card(
      'Network Monitoring Tool',
      'Passive network security monitoring for the networks cloud tools cannot reach',
    ),
  );
  await wait(page, 4_800);
  await page.evaluate(() => window.__demo.hideCard());
  await wait(page, 900);

  await caption(
    page,
    'Sign in',
    'Accounts and roles',
    'Two roles: a user reads findings, an administrator changes what the system does. Every screen sits behind a session — including the user guide.',
  );
  await wait(page, 1_800);

  // Typed rather than filled, because a form that fills itself instantly reads
  // as a screenshot with a caption on it rather than as software being used.
  await page.getByLabel(/email/i).pressSequentially(EMAIL, { delay: 55 });
  await wait(page, 400);
  await page.getByLabel(/password/i).pressSequentially(PASSWORD, { delay: 55 });
  await wait(page, 600);
  await clickVisibly(page, page.getByRole('button', { name: /sign in|log in/i }), { settleMs: 400 });
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await wait(page, 1_800);

  for (const beat of BEATS) {
    try {
      await beat.run(page);
      console.log(`ok   ${beat.name}`);
    } catch (error) {
      // Named, and the tour continues. One broken selector should cost its own
      // beat rather than the eight around it — a two-minute take is expensive
      // enough that finishing it and reading the report beats failing fast.
      console.error(`FAIL ${beat.name}: ${error.message.split('\n')[0]}`);
      failed.push(beat.name);
    }
  }

  await page.evaluate(() => {
    window.__demo.hideCaption();
    window.__demo.hideCursor();
  });
  await wait(page, 700);
  await page.evaluate(() =>
    window.__demo.card(
      'Read the rest when you need it',
      'Install notes in the README · every screen explained in the user guide',
    ),
  );
  await wait(page, 5_200);
} finally {
  // The WebM is only written out — and only has a path — once the context that
  // is recording it has closed.
  await context.close();
  await browser.close();
}

const webm = join(RAW, 'tour.webm');
renameSync(await page.video().path(), webm);

const mp4 = join(OUT, `${FILE}.mp4`);
const poster = join(OUT, `${FILE}-poster.png`);

/*
 * H.264 in yuv420p, the pairing that plays everywhere — including GitHub's own
 * file viewer, which is where the README's thumbnail sends people.
 *
 * `-crf 24` at `slow`, because this is a screen recording: long stretches
 * of it are a still page, so the encoder has almost nothing to spend bits on
 * between transitions and the result stays small enough to live in a
 * repository. `+faststart` moves the index to the front so playback can start
 * before the download finishes. The scale filter is a rounding guard — H.264
 * needs even dimensions, and a viewport is only even by luck.
 */
console.log('\nencoding...');
execFileSync(
  FFMPEG,
  [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    webm,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ],
  { stdio: 'inherit' },
);

/*
 * The poster is a frame of the tour rather than a fresh screenshot, so the
 * thumbnail is honestly a picture of the video it plays. Taken half a minute
 * in: far enough to be the dashboard rather than the title card or the login
 * form, which is the frame that says what this is.
 */
execFileSync(
  FFMPEG,
  ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '30', '-i', mp4, '-frames:v', '1', poster],
  { stdio: 'inherit' },
);

rmSync(RAW, { recursive: true, force: true });

console.log(`\nwrote ${mp4}`);
console.log(`wrote ${poster}`);
if (failed.length > 0) {
  console.error(`\nBeats that did not record: ${failed.join(', ')}`);
  process.exit(1);
}
