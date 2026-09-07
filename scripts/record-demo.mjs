/**
 * Records the product tour that the README links to.
 *
 * The README is two thousand lines, which is right for whoever installs and
 * changes this thing and wrong for whoever is deciding in ninety seconds
 * whether it is worth installing at all. This produces the thing that answers
 * that second question: a narrated, captioned walk through the screens, in the
 * order that explains them — a finding is raised, you open it, you read the
 * evidence, you declare the next one expected, and you send it somewhere.
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
 *   DEMO_VOICE     narration voice, by substring (default Zira)
 *   DEMO_RATE      -10 to 10, speech rate        (default -1, a little slow)
 *   DEMO_SILENT    set to any value to skip narration
 *   FFMPEG         ffmpeg binary                 (default `ffmpeg` on PATH)
 *
 * Playwright records WebM and cannot be talked out of it, so the conversion to
 * H.264 is a second pass. It needs a real ffmpeg: the one bundled with
 * Playwright's browsers is compiled down to VP8 and PNG only, which is enough
 * for Playwright and not enough for this. `npm i -D ffmpeg-static` and point
 * FFMPEG at it if the machine has none.
 *
 * The narration is spoken by Windows' own speech engine, offline — see
 * `demo/narrate.ps1` for why that rather than a cloud voice. It turns itself off
 * anywhere the engine is missing, and on request with DEMO_SILENT, and the
 * result is then the same tour with the captions carrying it alone. Every spoken
 * line is also on screen, so the video is watchable muted either way.
 *
 * Point it at a demo installation, and sign in with an account that exists only
 * to be filmed. Two reasons, and both matter:
 *
 * The tour types the address into the login form on camera, so a real
 * administrator's address would be in a video attached to a public README for
 * good. And the tour *writes*: the suppressions beat fills in the new-rule
 * dialog and saves it, because a tour of a screen that says "no rules" does not
 * show what suppression is for. It is signed in as an administrator throughout,
 * which is the level of access needed to film the administration screens and
 * exactly the level of access you do not hand to a script pointed at a
 * production database.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const URL = process.env.DEMO_URL ?? 'http://localhost:5173';
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
const OUT = process.env.DEMO_OUT ?? join(ROOT, 'user-guide', 'video');
const VOICE = process.env.DEMO_VOICE ?? 'Zira';
const RATE = process.env.DEMO_RATE ?? '-1';
const SILENT = process.env.DEMO_SILENT !== undefined;
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
 * What the voice says, all of it in one place.
 *
 * Kept apart from the captions rather than generated from them, because the two
 * are taken in at different speeds by different senses. A caption can afford an
 * em-dash aside that a synthetic voice reads as a full stop, and a spoken line
 * can afford a plain second sentence that would be padding on screen. They say
 * the same things in the same order; neither is a transcript of the other.
 *
 * Written for the engine as much as for the viewer: no parentheses, no dashes
 * mid-clause, and the abbreviations spelled how they should sound.
 */
const SCRIPT = {
  intro:
    'Network Monitoring Tool. Passive network security monitoring, for the networks that cloud tools cannot reach.',
  signIn:
    'Everything sits behind a session, including the user guide. A user reads findings. An administrator changes what the system does.',
  dashboard:
    'The dashboard. Findings grouped by severity, the detectors that raised them, and the hosts that keep appearing. The trend survives retention, because an expiring day is rolled up rather than deleted.',
  alerts:
    'Security alerts. Eight detectors write here, and each row is one finding rather than one packet. A scan of forty ports is a single alert carrying an occurrence count.',
  evidence:
    'Open a finding and it shows the evidence behind it. The ports that were touched, the window they were touched in, and the exporter that reported them. Passwords and payloads are never recorded.',
  threatIntel:
    'Threat intelligence. Local indicator files are first class, and downloaded feeds are cached to disk, so a monitoring host with no internet still starts from the last known good copy.',
  suppress:
    'Suppressions. The authorised nightly scan is not an incident, so declare it expected. A matching finding is dropped before storage, and nothing downstream ever sees it.',
  suppressReason:
    'A finding is suppressed only where every field you filled in matches. The reason is required, so a rule nobody remembers creating still explains itself a year later.',
  suppressCheck:
    'Before it is saved, the rule is replayed against recent findings. You learn what it would have hidden before it hides anything.',
  suppressSaved:
    'In force immediately. No file to edit and no restart. Each rule counts what it has hidden, which is how a stale one gets noticed.',
  adhoc:
    'The ad hoc query console, for the question the screens do not answer. Read only, administrators only, off by default, and every statement lands in the audit trail.',
  capture:
    'Packet capture. Pick an interface, set a snapshot length, and start. This is the feed for the detectors that have to see inside a packet, such as cleartext credentials and D N S tunnelling.',
  delivery:
    'Delivery. Email, syslog and C E F, with a severity floor, a digest window and a throttle, so a medium finding does not page anyone at three in the morning.',
  audit:
    'The audit trail. Who acknowledged what, who deleted what, and who changed which setting. It is append only, and the database itself refuses to modify a recorded event.',
  outro: 'Install notes are in the README. Every screen is explained in the user guide.',
};

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
  const CSS = `
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

  let parts = null;

  /**
   * Builds the overlay on first use, rather than now.
   *
   * An init script runs before the document does: `document.documentElement` is
   * still null at this point, and the first version of this appended to it and
   * left every caption call throwing on a `window.__demo` that was never
   * assigned. Rebuilt too if the nodes are ever found detached, so a page that
   * replaces the tree cannot silently take the captions with it.
   */
  function ensure() {
    if (parts?.caption.isConnected) return parts;

    const style = document.createElement('style');
    style.textContent = CSS;

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

    document.documentElement.append(style, caption, cursor, card);
    parts = { caption, cursor, card };
    return parts;
  }

  window.__demo = {
    caption(kicker, title, body) {
      const { caption } = ensure();
      caption.querySelector('.demo-kicker').textContent = kicker;
      caption.querySelector('.demo-title').textContent = title;
      caption.querySelector('.demo-body').textContent = body || '';
      caption.dataset.shown = 'yes';
    },
    hideCaption() {
      delete ensure().caption.dataset.shown;
    },
    cursorTo(x, y) {
      const { cursor } = ensure();
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cursor.dataset.shown = 'yes';
    },
    press(x, y) {
      // Scaled about the same translation rather than replacing it, which would
      // send the ring back to the top-left corner for the length of the click.
      ensure().cursor.style.transform = `translate(${x}px, ${y}px) scale(0.72)`;
    },
    release(x, y) {
      ensure().cursor.style.transform = `translate(${x}px, ${y}px)`;
    },
    hideCursor() {
      delete ensure().cursor.dataset.shown;
    },
    card(title, sub) {
      const { card } = ensure();
      card.querySelector('.demo-card-title').textContent = title;
      card.querySelector('.demo-card-sub').textContent = sub || '';
      card.dataset.shown = 'yes';
    },
    hideCard() {
      delete ensure().card.dataset.shown;
    },
  };
}

mkdirSync(OUT, { recursive: true });

/** Playwright names the WebM itself, so it gets a directory of its own to name it in. */
const RAW = join(OUT, '.raw');
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

/**
 * How long a WAV runs, read out of its own header.
 *
 * From the bytes rather than by asking ffmpeg, because this is wanted for all
 * fifteen clips before the browser opens — fifteen subprocesses to read a number
 * that sits in a header the file starts with. PCM only, which is all the speech
 * engine is asked to write.
 */
function wavSeconds(file) {
  const wav = readFileSync(file);
  let at = 12;
  let byteRate = 0;

  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ') byteRate = wav.readUInt32LE(at + 16);
    if (id === 'data' && byteRate > 0) return size / byteRate;
    // Chunks are word-aligned: an odd length is followed by a pad byte that is
    // not counted in it, and ignoring that walks the reader into the middle of
    // the next header.
    at += 8 + size + (size % 2);
  }
  return 0;
}

/**
 * Speaks every line in SCRIPT, and reports how long each one took.
 *
 * All of it up front, before a single frame is recorded, because the clip
 * lengths are what the tour is paced against: a caption has to stay up until
 * the sentence about it has finished, and the only honest way to know how long
 * that is is to have the sentence already.
 *
 * A missing speech engine is not a failure. Windows has one and other platforms
 * do not, so this returns an empty map and the tour records silent — the same
 * tour, with the captions carrying it.
 */
function speak() {
  if (SILENT) {
    console.log('narration: off (DEMO_SILENT)');
    return new Map();
  }

  const lines = Object.entries(SCRIPT).map(([key, text]) => ({
    key,
    text,
    file: join(RAW, `${key}.wav`),
  }));
  const manifest = join(RAW, 'narration.json');
  writeFileSync(
    manifest,
    JSON.stringify(
      lines.map(({ file, text }) => ({ file, text })),
      null,
      2,
    ),
  );

  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(HERE, 'demo', 'narrate.ps1'),
        '-Manifest',
        manifest,
        '-Voice',
        VOICE,
        '-Rate',
        RATE,
      ],
      { stdio: 'pipe' },
    );
  } catch (error) {
    const why = String(error.message).split('\n')[0];
    console.warn(`narration: unavailable, recording silent (${why})`);
    return new Map();
  }

  const clips = new Map(lines.map(({ key, file }) => [key, { file, seconds: wavSeconds(file) }]));
  const total = [...clips.values()].reduce((sum, clip) => sum + clip.seconds, 0);
  console.log(`narration: ${clips.size} lines, ${total.toFixed(1)}s of speech`);
  return clips;
}

const clips = speak();

/** Where each clip belongs on the finished timeline, filled in as the tour runs. */
const marks = [];
let startedAt = 0;

/**
 * The moment to take the poster frame from.
 *
 * Set by the dashboard beat, at a point where the screen has finished rendering
 * and no caption is over it yet. The captions sit in the bottom-left corner and
 * so does the poster's own label, so a frame taken during a beat gives a
 * thumbnail with two pieces of text on top of each other. Defaulted in case the
 * dashboard beat is the one that fails.
 */
let posterAt = 30_000;

const wait = (page, ms) => page.waitForTimeout(ms);

/** Notes that a clip belongs here, at this moment in the recording. */
function mark(line) {
  const clip = clips.get(line);
  if (!clip) return 0;
  marks.push({ at: Date.now() - startedAt, file: clip.file });
  // A second of air after the last word, so the next line does not tread on it.
  return clip.seconds * 1_000 + 1_000;
}

/**
 * Shows a caption, notes where its narration goes, and holds the shot.
 *
 * The hold is whichever is longer: the time the screen needs to be looked at,
 * or the time the sentence needs to be said. Cutting away mid-sentence is the
 * one artefact of a paced tour that a viewer cannot ignore.
 */
async function beat(page, { kicker, title, body, line, hold = 0 }) {
  await page.evaluate(([k, t, b]) => window.__demo.caption(k, t, b), [kicker, title, body]);
  await wait(page, Math.max(hold, mark(line)));
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
  /*
   * The caption goes first, and the ring goes last.
   *
   * Navigating between these screens does not reload the page, so nothing
   * clears the overlay on its own: the caption describing the screen being left
   * stayed up over the screen arriving, until the next beat happened to
   * overwrite its text. The ring is the opposite — it has to still be there
   * when the click lands, and gone once the new screen is the subject.
   */
  await page.evaluate(() => window.__demo.hideCaption());
  await wait(page, 420);

  const link = page.getByRole('link', { name: label, exact: true }).first();
  try {
    if (await link.isVisible({ timeout: 2_000 })) {
      await clickVisibly(page, link, { settleMs: 1_200 });
      await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 });
      await page.evaluate(() => window.__demo.hideCursor());
      return;
    }
  } catch {
    // Falls through to the URL below.
  }
  await page.goto(`${URL}${path}`, { waitUntil: 'networkidle' });
  await wait(page, 1_200);
}

/** Each beat: what to open, what to say about it, and what to leave on screen. */
const BEATS = [
  {
    name: 'dashboard',
    async run(page) {
      await visit(page, 'Dashboard', '/dashboard');
      // A beat of the finished screen with nothing written over it, and the
      // poster's frame taken from the middle of it.
      await wait(page, 900);
      posterAt = Date.now() - startedAt - 450;
      await beat(page, {
        kicker: 'Dashboard',
        title: 'What the network is doing',
        body: 'Findings by severity, the detectors that raised them, and a trend that survives retention — an expiring day is rolled up rather than deleted.',
        line: 'dashboard',
        hold: 6_500,
      });
      await page.mouse.wheel(0, 420);
      await wait(page, 4_000);
      await page.mouse.wheel(0, -420);
      await wait(page, 1_200);
    },
  },
  {
    name: 'alerts',
    async run(page) {
      await visit(page, 'Security Alerts', '/alerts');
      await beat(page, {
        kicker: 'Security alerts',
        title: 'Findings, not a packet log',
        body: 'Eight detectors write here. Each row is one finding with a severity and an occurrence count — a scan of forty ports is one alert, not forty.',
        line: 'alerts',
        hold: 7_000,
      });
    },
  },
  {
    name: 'evidence',
    async run(page) {
      await clickVisibly(page, page.getByRole('button', { name: /expand/i }).first(), {
        settleMs: 1_000,
      });
      await beat(page, {
        kicker: 'Evidence',
        title: 'Why it fired',
        body: 'Every finding carries the structured evidence behind it — the ports touched, the window they were touched in, the exporter that reported them.',
        line: 'evidence',
        hold: 7_500,
      });
    },
  },
  {
    name: 'threat-intel',
    async run(page) {
      await visit(page, 'Threat Intel', '/threat-intel');
      await beat(page, {
        kicker: 'Threat intelligence',
        title: 'Feeds that work offline',
        body: 'Local indicator files are first-class and downloaded feeds cache to disk, so a monitoring host with no outbound internet still starts from the last known-good copy.',
        line: 'threatIntel',
        hold: 7_000,
      });
    },
  },
  {
    name: 'suppressions',
    async run(page) {
      await visit(page, 'Suppressions', '/suppressions');
      await beat(page, {
        kicker: 'Suppressions',
        title: 'Silence the authorised scanner',
        body: 'The nightly vulnerability scan is not an incident. Declare it expected here and a matching finding is dropped before storage, so nothing downstream ever sees it.',
        line: 'suppress',
        hold: 5_000,
      });

      await clickVisibly(page, page.getByRole('button', { name: /new rule/i }), { settleMs: 900 });
      await page.getByLabel(/source address or range/i).pressSequentially('10.10.30.99', { delay: 55 });
      await wait(page, 400);
      await clickVisibly(page, page.getByLabel(/finding kind/i), { settleMs: 400 });
      await clickVisibly(page, page.getByRole('option', { name: /port scan/i }), { settleMs: 600 });
      await page
        .getByLabel(/why is this expected/i)
        .pressSequentially('Authorised internal scanner, ticket OPS-1421', { delay: 34 });
      await beat(page, {
        kicker: 'Suppressions',
        title: 'Every rule carries its reason',
        body: 'A finding is suppressed only where every field filled in matches. The reason is required, so a rule nobody remembers creating still explains itself a year later.',
        line: 'suppressReason',
        hold: 4_000,
      });

      await clickVisibly(page, page.getByRole('button', { name: /check against recent alerts/i }), {
        settleMs: 1_800,
      });
      await beat(page, {
        kicker: 'Suppressions',
        title: 'Checked before it is saved',
        body: 'The rule is replayed against recent findings first, so you learn what it would have hidden before it hides anything.',
        line: 'suppressCheck',
        hold: 5_000,
      });

      await clickVisibly(page, page.getByRole('button', { name: /create rule/i }), {
        settleMs: 2_000,
      });
      await beat(page, {
        kicker: 'Suppressions',
        title: 'In force immediately',
        body: 'No file to edit and no restart. Each rule counts what it has hidden, which is how a stale one gets noticed.',
        line: 'suppressSaved',
        hold: 5_500,
      });
    },
  },
  {
    name: 'adhoc',
    async run(page) {
      await visit(page, 'Ad Hoc Query', '/adhoc');
      await beat(page, {
        kicker: 'Ad hoc query',
        title: 'Read-only SQL, when you need it',
        body: 'For the question the screens do not answer. Administrators only, off by default, and every statement lands in the audit trail.',
        line: 'adhoc',
        hold: 7_000,
      });
    },
  },
  {
    name: 'capture',
    async run(page) {
      await visit(page, 'Capture by Interface', '/capture-packets');
      await beat(page, {
        kicker: 'Packet capture',
        title: 'Full packets, when you need payload',
        body: 'Pick an interface, set a snapshot length, start. This is the feed for the detectors that must see inside a packet — cleartext credentials, DNS tunnelling — where flow collection covers the rest with one line of switch config.',
        line: 'capture',
        hold: 7_000,
      });
    },
  },
  {
    name: 'delivery',
    async run(page) {
      await visit(page, 'Delivery', '/delivery');
      await beat(page, {
        kicker: 'Delivery',
        title: 'Out to where people are looking',
        body: 'Email, syslog and CEF, with a severity floor so a medium finding does not page anyone at three in the morning. Send a test before you trust it.',
        line: 'delivery',
        hold: 7_000,
      });
    },
  },
  {
    name: 'audit',
    async run(page) {
      await visit(page, 'Audit Trail', '/activity');
      await beat(page, {
        kicker: 'Audit trail',
        title: 'Append-only, enforced by the database',
        body: 'Who acknowledged what, who deleted what, who changed which setting. The database itself refuses to modify a recorded event.',
        line: 'audit',
        hold: 7_000,
      });
    },
  },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: RAW, size: VIEWPORT },
});
await context.addInitScript(installOverlay);

const page = await context.newPage();
/*
 * Recording begins with the page, so this is frame zero as far as the narration
 * is concerned and every mark is an offset from it. Approximate by a frame or
 * two, which is the tolerance a spoken line under a caption has anyway.
 */
startedAt = Date.now();

const failed = [];

/** Holds a full-screen card, and speaks over it. */
async function cardBeat(title, sub, line, holdMs) {
  await page.evaluate(([t, s]) => window.__demo.card(t, s), [title, sub]);
  await wait(page, Math.max(holdMs, mark(line)));
}

try {
  await page.goto(`${URL}/login`, { waitUntil: 'networkidle' });

  await cardBeat(
    'Network Monitoring Tool',
    'Passive network security monitoring for the networks cloud tools cannot reach',
    'intro',
    4_800,
  );
  await page.evaluate(() => window.__demo.hideCard());
  await wait(page, 900);

  await beat(page, {
    kicker: 'Sign in',
    title: 'Accounts and roles',
    body: 'Two roles: a user reads findings, an administrator changes what the system does. Every screen sits behind a session — including the user guide.',
    line: 'signIn',
    hold: 2_000,
  });

  // Typed rather than filled, because a form that fills itself instantly reads
  // as a screenshot with a caption on it rather than as software being used.
  await page.getByLabel(/email/i).pressSequentially(EMAIL, { delay: 55 });
  await wait(page, 400);
  await page.getByLabel(/password/i).pressSequentially(PASSWORD, { delay: 55 });
  await wait(page, 600);
  await clickVisibly(page, page.getByRole('button', { name: /sign in|log in/i }), { settleMs: 400 });
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await wait(page, 1_800);

  for (const step of BEATS) {
    try {
      await step.run(page);
      console.log(`ok   ${step.name}`);
    } catch (error) {
      // Named, and the tour continues. One broken selector should cost its own
      // beat rather than the eight around it — a three-minute take is expensive
      // enough that finishing it and reading the report beats failing fast.
      console.error(`FAIL ${step.name}: ${error.message.split('\n')[0]}`);
      failed.push(step.name);
      // A beat that died with a dialog open would otherwise leave it open over
      // every beat after it, and one broken selector would cost the whole take.
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  await page.evaluate(() => {
    window.__demo.hideCaption();
    window.__demo.hideCursor();
  });
  await wait(page, 700);
  await cardBeat(
    'Read the rest when you need it',
    'Install notes in the README · every screen explained in the user guide',
    'outro',
    5_200,
  );
} finally {
  // The WebM is only written out — and only has a path — once the context that
  // is recording it has closed.
  await context.close();
  await browser.close();
}

const webm = join(RAW, 'tour.webm');
renameSync(await page.video().path(), webm);

const silent = join(RAW, 'silent.mp4');
const mp4 = join(OUT, `${FILE}.mp4`);
const poster = join(OUT, `${FILE}-poster.png`);

/*
 * H.264 in yuv420p, the pairing that plays everywhere — including GitHub's own
 * file viewer, which is where the README's thumbnail sends people.
 *
 * `-crf 24` at `slow`, because this is a screen recording: long stretches of it
 * are a still page, so the encoder has almost nothing to spend bits on between
 * transitions and the result stays small enough to live in a repository.
 * `+faststart` moves the index to the front so playback can start before the
 * download finishes. The scale filter is a rounding guard — H.264 needs even
 * dimensions, and a viewport is only even by luck.
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
    silent,
  ],
  { stdio: 'inherit' },
);

/*
 * Lays the narration onto the finished picture.
 *
 * Each clip is delayed to the moment its caption appeared. `amix` rather than
 * `concat` because those offsets are the whole point: the gaps between lines
 * are the pauses, and concatenating the clips would slide every line after the
 * first out of step with the screen it describes. `normalize=0` because mixing
 * fifteen inputs that never overlap would otherwise divide every one of them by
 * fifteen and leave the narration inaudible.
 *
 * The picture is copied rather than re-encoded: it was encoded once, correctly,
 * and a second pass would cost quality for nothing.
 */
function mix() {
  const filters = marks.map((at, index) => `[${index + 1}:a]adelay=${at.at}:all=1[a${index}]`);
  const chain = marks.map((_unused, index) => `[a${index}]`).join('');

  execFileSync(
    FFMPEG,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      silent,
      ...marks.flatMap((at) => ['-i', at.file]),
      '-filter_complex',
      `${filters.join(';')};${chain}amix=inputs=${marks.length}:normalize=0[a]`,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { stdio: 'inherit' },
  );
}

if (marks.length > 0) {
  console.log('mixing narration...');
  mix();
} else {
  copyFileSync(silent, mp4);
}

/**
 * How long the finished thing runs, off ffmpeg's own report.
 *
 * Asked of the file rather than timed around the tour, which would measure the
 * script's wall clock — encode included — and print a number a viewer could
 * check against the player and find wrong. `-i` with no output is ffmpeg's way
 * of being asked: it prints what it found and then exits non-zero complaining
 * about the missing output file, so the answer arrives via the error.
 */
function runtime() {
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', mp4], { stdio: 'pipe' });
    return null;
  } catch (error) {
    const found = /Duration: (\d+):(\d+):(\d+)/.exec(String(error.stderr ?? ''));
    if (!found) return null;
    const [, hours, minutes, seconds] = found.map(Number);
    const total = hours * 3_600 + minutes * 60 + seconds;
    return total >= 60 ? `${Math.floor(total / 60)} min ${total % 60} s` : `${total} s`;
  }
}

/*
 * The poster is a frame of the tour rather than a fresh screenshot, so the
 * thumbnail is honestly a picture of the video it plays. The frame is the one
 * the dashboard beat set aside: the dashboard is the screen that says what this
 * is, and that moment is the one with no caption in the corner the poster wants
 * for its own label.
 */
const frame = join(RAW, 'frame.png');
execFileSync(
  FFMPEG,
  [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    (posterAt / 1_000).toFixed(2),
    '-i',
    mp4,
    '-frames:v',
    '1',
    frame,
  ],
  { stdio: 'inherit' },
);

/**
 * Puts a play button on the frame.
 *
 * The README links the poster at the video, and a bare screenshot gives a
 * reader no reason to think it is a link at all — GitHub renders it as one more
 * illustration in a file that already has eleven of them. Composed in the
 * browser rather than with ffmpeg's drawing filters, because a circle, a
 * triangle and a line of anti-aliased text are four lines of CSS and a fight
 * with `geq` and font paths.
 *
 * The frame is inlined as a data URI rather than linked as a `file://` URL: a
 * document built with `setContent` has no origin worth the name, and Chromium
 * refuses to let it load local files — silently, which is how the first poster
 * came out as a play button over an empty grey gradient.
 */
async function composePoster(length) {
  const shell = await chromium.launch();
  const shellContext = await shell.newContext({ viewport: VIEWPORT });
  const shellPage = await shellContext.newPage();
  const sound = marks.length > 0 ? 'narrated, and captioned' : 'no sound — captions on screen';

  await shellPage.setContent(`
    <style>
      html, body {
        margin: 0; width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px; overflow: hidden;
      }
      .frame {
        position: absolute; inset: 0;
        background: url("data:image/png;base64,${readFileSync(frame).toString('base64')}")
          center / cover no-repeat;
      }
      .veil {
        position: absolute; inset: 0;
        background: linear-gradient(
          180deg,
          rgba(6, 10, 18, 0.12) 0%,
          rgba(6, 10, 18, 0.34) 52%,
          rgba(6, 10, 18, 0.86) 100%
        );
      }
      .play {
        position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%);
        width: 132px; height: 132px; border-radius: 50%;
        background: rgba(248, 250, 252, 0.94);
        box-shadow: 0 24px 70px rgba(2, 6, 14, 0.55);
        display: flex; align-items: center; justify-content: center;
      }
      .play svg { margin-left: 9px; }
      .label {
        position: absolute; left: 58px; bottom: 54px; color: #f8fafc;
        font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
      }
      .label .kicker {
        font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase;
        color: #7dd3fc; font-weight: 700;
      }
      .label .title { font-size: 46px; font-weight: 800; letter-spacing: -0.02em; margin-top: 10px; }
      .label .sub { font-size: 19px; color: #cbd5e1; margin-top: 12px; }
    </style>
    <div class="frame"></div>
    <div class="veil"></div>
    <div class="play">
      <svg width="46" height="52" viewBox="0 0 46 52" aria-hidden="true">
        <path d="M2 2 L44 26 L2 50 Z" fill="#0b1220" />
      </svg>
    </div>
    <div class="label">
      <div class="kicker">Network Monitoring Tool</div>
      <div class="title">A tour of the application</div>
      <div class="sub">${length ? `${length} · ` : ''}${sound}</div>
    </div>
  `);

  // The background is a local file the layout has to have finished loading, or
  // the poster comes out as a gradient over nothing.
  await shellPage.waitForLoadState('load');
  await shellPage.screenshot({ path: poster });

  await shellContext.close();
  await shell.close();
}

const length = runtime();
await composePoster(length);

rmSync(RAW, { recursive: true, force: true });

console.log(`\nwrote ${mp4}${length ? ` (${length})` : ''}`);
console.log(`wrote ${poster}`);
if (failed.length > 0) {
  console.error(`\nBeats that did not record: ${failed.join(', ')}`);
  process.exit(1);
}
