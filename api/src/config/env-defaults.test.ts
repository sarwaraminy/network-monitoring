import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DELIVERY_DEFAULTS, DELIVERY_FIELDS, type DeliveryField } from '../notify/settings.js';

/**
 * The example files and Compose must not contradict the code's own defaults.
 *
 * This has now gone wrong three times — `ALLOW_OPEN_SIGNUP`, `INTEL_CACHE_DIR`
 * and `REDACT_PACKET_PAYLOAD` — always the same way and always with a security
 * consequence. The pattern is worth stating because it is not obvious:
 *
 *   `bool()` and friends return the fallback only when the variable is UNSET.
 *   Compose passing the literal `"false"`, or an operator copying
 *   `.env.example`, sets it. So a hardened code default is silently undone for
 *   every deployment that follows the documentation, and the code looks right
 *   while every real install is wrong.
 *
 * A reviewer caught all three. This is the check that means the fourth does not
 * need one — and the reason it compares TEXT rather than importing `env` is that
 * importing it reads `process.env`, which is exactly the layer under test.
 *
 * Delivery settings (#28) briefly had a second copy of this same shape: env.ts's
 * own `notify` block duplicated `DELIVERY_DEFAULTS` from notify/settings.ts, and a
 * test in notify/settings.test.ts compared the two. That block is gone now — it
 * was dead code that could still crash boot on a malformed value, which was worse
 * than the duplication it existed to reconcile — and deleting it silently dropped
 * every delivery setting out of `code` below, since `parseCodeDefaults` only reads
 * env.ts's source text. A missing entry is invisible to every check in this file:
 * they all skip a name absent from `code` rather than failing on it.
 *
 * So `code` now folds in `DELIVERY_DEFAULTS` directly — the real object, not text
 * scraped from a second copy of it, because there is no second copy left to scrape.
 * That keeps every check below covering the delivery fields exactly as it covers
 * every other setting, with `DELIVERY_DEFAULTS` rather than env.ts as that corner's
 * source of truth.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const read = (relative: string) => readFileSync(join(REPO, relative), 'utf8');

/** `NAME=value` from a dotenv-style file, ignoring comments and blanks. */
function parseDotenv(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    values.set(trimmed.slice(0, equals).trim(), trimmed.slice(equals + 1).trim());
  }

  return values;
}

/**
 * Environment entries from the Compose file, in both forms.
 *
 * `NAME: ${NAME:-default}` is the overridable form. `NAME: literal` is pinned —
 * an operator cannot change it — and it was invisible to every check here, which
 * left `DB_AUTO_MIGRATE: 'true'` in a blind spot: hardcoded against a code
 * default, agreeing today, and unable to be seen if it ever stopped agreeing.
 * That is exactly the class this file exists to catch, in the one form it could
 * not observe.
 */
function parseComposeDefaults(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const match of text.matchAll(/^\s*([A-Z0-9_]+):\s*\$\{[A-Z0-9_]+:-([^}]*)\}/gm)) {
    if (match[1]) values.set(match[1], (match[2] ?? '').trim());
  }

  // Pinned literals. Quotes stripped so `'true'` compares against a code default
  // of `true`. Anything interpolated is already handled above.
  for (const match of text.matchAll(/^\s{6}([A-Z0-9_]+):\s*(?!\$\{)(\S+)\s*$/gm)) {
    const name = match[1];
    if (name && !values.has(name)) {
      values.set(name, (match[2] ?? '').replace(/^['"]|['"]$/g, '').trim());
    }
  }

  return values;
}

/** `bool('NAME', true)` / `int('NAME', 42)` / `optional('NAME', 'x')` from env.ts. */
/**
 * `optional` is included deliberately. Leaving it out is why the first version
 * of this check could not have caught `INTEL_CACHE_DIR`: it is an `optional()`
 * setting, so it never entered the map and nothing could be asserted about it.
 */
function parseCodeDefaults(text: string): Map<string, string> {
  const values = new Map<string, string>();
  /*
   * `retentionDays` belongs in that alternation for the reason this file exists.
   *
   * It is a thin wrapper around `int()` that clamps to a floor, and adding it made
   * two settings invisible to every check below — including ALERT_RETENTION_DAYS,
   * which decides what gets deleted — because they no longer matched a bare `int()`
   * call. The suite still passed. Any future parser helper has to be added here too,
   * or it quietly takes its settings out of this guard's view.
   */
  // The default may itself be a quoted string containing commas —
  // CORS_ORIGIN's is a comma-separated list — so match a quoted form first.
  const pattern =
    /\b(?:bool|int|optional|retentionDays|sweepHours)\(\s*'([A-Z0-9_]+)'\s*,\s*('[^']*'|[^),]*)\)/g;
  const requiredPattern = /\brequired\(\s*'([A-Z0-9_]+)'\s*\)/g;

  for (const match of text.matchAll(pattern)) {
    if (match[1]) values.set(match[1], (match[2] ?? '').trim());
  }

  /*
   * And a guard on the guard: a helper this pattern does not know about takes
   * its settings out of view SILENTLY, which is how `oneOf` arrived and
   * `ADHOC_AUDIT` became invisible the moment it was written. It passed only
   * because the setting happened to be in Compose already — deleting it from
   * there would have left the suite green, which is the exact drift this file
   * exists to catch.
   *
   * So any `something('SETTING_NAME'` that the alternation above did not match
   * is a failure here rather than a quiet omission. The comment above used to
   * say "any future parser helper has to be added here too"; this is what makes
   * that true instead of hopeful.
   */
  const KNOWN_HELPERS = new Set([
    'bool',
    'int',
    'optional',
    'oneOf',
    'required',
    'retentionDays',
    'sweepHours',
  ]);
  const unknown = [...text.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]*)\(\s*'([A-Z0-9_]{2,})'/g)]
    .filter((match) => !KNOWN_HELPERS.has(match[1]!) && !values.has(match[2]!))
    .map((match) => `${match[1]}('${match[2]}')`);

  assert.deepEqual(
    [...new Set(unknown)],
    [],
    'env.ts reads settings through a helper this guard does not recognise, so they are ' +
      'invisible to the Compose and example checks. Add the helper to the pattern above.',
  );

  /*
   * Bare `process.env.NAME` too, which the helpers do not cover.
   *
   * The whole inversion rests on "a new setting fails by default", and a
   * setting read this way did not fail — it failed to APPEAR, which is silence
   * rather than a failure. `DATABASE_URL` and `PGPASSWORD` are read this way.
   */
  for (const match of text.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\['([A-Z0-9_]+)'\])/g)) {
    const name = match[1] ?? match[2];
    if (name && !values.has(name)) values.set(name, '<read directly>');
  }

  // `required()` carries no default, but it is still a setting the code reads
  // and a deployment has to supply.
  for (const match of text.matchAll(requiredPattern)) {
    if (match[1] && !values.has(match[1])) values.set(match[1], '<required>');
  }

  return values;
}

/**
 * `DELIVERY_DEFAULTS`, keyed by the environment variable that pins each field, in
 * the same `{name: text}` shape `parseCodeDefaults` produces.
 *
 * Read from the real object rather than scraped from source text — unlike env.ts,
 * there is no `process.env` read to avoid here, `DELIVERY_DEFAULTS` is a plain
 * literal, so importing it is exact rather than an approximation of it.
 */
function deliveryCodeDefaults(): Map<string, string> {
  const values = new Map<string, string>();

  for (const field of Object.keys(DELIVERY_FIELDS) as DeliveryField[]) {
    const value = DELIVERY_DEFAULTS[field];
    // NOTIFY_EMAIL_TO is the one list-shaped field; an empty list is how its
    // variable spells "unset", the same as every empty-string default here.
    if (Array.isArray(value)) {
      values.set(DELIVERY_FIELDS[field].env, "''");
      continue;
    }
    values.set(DELIVERY_FIELDS[field].env, typeof value === 'string' ? `'${value}'` : String(value));
  }

  return values;
}

/**
 * Settings an example file may legitimately differ on.
 *
 * Only where the difference is the POINT of the example — never where it merely
 * happens to differ, which is the bug this file exists to catch.
 */
/**
 * Settings that deliberately do NOT reach the Compose environment list.
 *
 * INVERTED, and that is the whole point. The previous version kept a hand-written
 * list of names that must be present, and defended it as "a conscious act" —
 * sound in principle, and it failed immediately: the syslog feature shipped in
 * the very commit that added the list, with none of its eight settings in either
 * the list or Compose, so the flagship feature of two commits could not be
 * switched on under the primary documented deployment at all. Fourth instance of
 * this class after ALLOW_OPEN_SIGNUP, INTEL_CACHE_DIR and REDACT_PACKET_PAYLOAD.
 *
 * A default of "must be present" cannot be forgotten. Adding a setting to env.ts
 * now fails this test until it is either passed through to Compose or explicitly
 * excused here, and excusing it is the act that has to be conscious.
 */
const NOT_IN_COMPOSE = new Set([
  // Set by the Compose file itself or by the container, not by an operator.
  'PORT',
  'NODE_ENV',
  'DATABASE_URL',
  // Secrets belong in the .env file Compose reads, never in a committed default.
  'JWT_SECRET',
  // Read, but Compose-irrelevant: nginx serves the UI on the same origin.
  'CORS_ORIGIN',
  // The discrete PG* variables are the host-install alternative to DATABASE_URL,
  // which Compose sets instead. Passing both invites them to disagree.
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  // Read straight from a file path, not configured per deployment.
  'ARP_TRUSTED_MAPPINGS',
]);

/**
 * Settings deliberately absent from `api/.env.example`.
 *
 * Kept as a list with reasons rather than a loose match, so "not documented" is
 * always a decision somebody made rather than something that fell out.
 */
const NOT_IN_HOST_EXAMPLE = new Set<string>([]);

/**
 * Compose entries that need not appear in `.env.docker.example`.
 *
 * Kept honest by the self-check below, because the first version of this list was
 * four inert entries — all four already in the example, so it excused nothing —
 * added by the very commit that fixed that problem for the other two lists. One
 * of them, `POSTGRES_PASSWORD`, had its reason backwards: it is marked required
 * with no default precisely BECAUSE the operator must supply it, so it is the
 * setting they most need to find, not one they have no reason to see.
 */
const COMPOSE_OWNS = new Set([
  // Fixed by the image, and overriding it would break the volume mount.
  'INTEL_CACHE_DIR',
  // Set by Compose itself. Pinned literals, so putting them in the example would
  // offer an operator a knob that does nothing.
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'DB_AUTO_MIGRATE',
]);

const ALLOWED_TO_DIFFER = new Set([
  // On behind nginx, off for a direct host install. Both are correct in place,
  // which is exactly why both have to be stated rather than defaulted.
  'TRUST_PROXY',
  // A port is deployment shape, not policy.
  'PORT',
]);

describe('deployment defaults match the code', () => {
  // env.ts's own defaults, plus the delivery fields' — env.ts no longer declares
  // those at all, so without this half the settings on the Delivery page would be
  // invisible to every check below rather than covered by them.
  const code = new Map([...parseCodeDefaults(read('api/src/config/env.ts')), ...deliveryCodeDefaults()]);

  it('excuses only Compose entries that Compose actually has', () => {
    // The same self-check as below, for the third list. It was left out when
    // COMPOSE_OWNS was added, which is how all four of its entries came to be
    // inert without anything noticing.
    const compose = parseComposeDefaults(read('docker-compose.yml'));
    const unknown = [...COMPOSE_OWNS].filter((name) => !compose.has(name));

    assert.deepEqual(unknown, [], `excused but not in the Compose environment list: ${unknown.join(', ')}`);
  });

  it('excuses only settings that env.ts actually reads', () => {
    /*
     * Fail-closed, applied to the list itself.
     *
     * The inversion's argument is that excusing a setting has to be a conscious
     * act. An excusal nobody checks is where that erodes: a third of these
     * entries were inert — some naming settings env.ts does not read at all,
     * some kept out by the parser rather than by the exclusion — each carrying a
     * reason comment that read as active policy. The next inert entry could be a
     * real setting with a mistyped name, excused in silence.
     */
    const unknown = [...NOT_IN_COMPOSE, ...ALLOWED_TO_DIFFER].filter((name) => !code.has(name));

    assert.deepEqual(
      unknown,
      [],
      `excused but not read by env.ts: ${unknown.join(', ')}. ` +
        'Remove them, or correct the name — an exclusion for a setting that does ' +
        'not exist is one that will eventually cover a setting that does.',
    );
  });

  it('finds the code defaults at all, so a passing run means something', () => {
    // Guards the regex: if env.ts is reformatted and nothing parses, every
    // assertion below passes vacuously and the check quietly stops working.
    assert.ok(code.size > 20, `parsed only ${code.size} defaults from env.ts`);
    assert.equal(code.get('REDACT_PACKET_PAYLOAD'), 'true');
  });

  for (const file of ['api/.env.example', '.env.docker.example']) {
    it(`${file} does not contradict a boolean default`, () => {
      const example = parseDotenv(read(file));

      for (const [name, value] of example) {
        const expected = code.get(name);
        if (expected === undefined) continue;
        if (ALLOWED_TO_DIFFER.has(name)) continue;
        // Only booleans: an example may reasonably show a sample port or path.
        if (expected !== 'true' && expected !== 'false') continue;

        assert.equal(
          value,
          expected,
          `${file} sets ${name}=${value}, overriding the code default of ${expected}. ` +
            'An example that contradicts a hardened default silently un-hardens ' +
            'every deployment that follows the documentation.',
        );
      }
    });
  }

  it('offers every setting env.ts reads in api/.env.example', () => {
    /*
     * The host-install example, checked for COMPLETENESS rather than only for
     * contradiction.
     *
     * Nothing compared this file against `env.ts` before, and the gap showed:
     * `ADHOC_MAX_QUERY_LENGTH` reached Compose and `.env.docker.example` and was
     * missing here alone, so somebody configuring a host install had no
     * indication the setting existed. That is the second ad hoc setting to land
     * in some examples and not others, which is the sort of drift a person
     * cannot be relied on to catch by eye.
     *
     * Commented-out lines count. An example's job is to name the setting and its
     * default, and `# NAME=value` does that without changing anyone's
     * configuration — which is the right form for anything optional.
     */
    const example = read('api/.env.example');
    const named = new Set(
      [...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]!),
    );

    const missing = [...code.keys()].filter((name) => !named.has(name) && !NOT_IN_HOST_EXAMPLE.has(name));

    assert.deepEqual(
      missing,
      [],
      'read by env.ts but absent from api/.env.example: ' +
        `${missing.join(', ')}. Add them there (commented out, with the default), ` +
        'or add them to NOT_IN_HOST_EXAMPLE with a reason.',
    );
  });

  it('passes every setting env.ts reads through to Compose', () => {
    /*
     * Absence, not contradiction — the failure mode that shipped three of the
     * four cases this file exists for. A setting missing from the environment
     * list silently takes whatever the image was built with, and a Docker
     * operator has no way to see or change it.
     *
     * Iterating the CODE side is what makes this catch a new feature. The
     * previous version iterated the example/Compose side and looked names up in
     * the code map, so a setting present in env.ts and simply absent from Compose
     * was invisible to it.
     */
    const compose = read('docker-compose.yml');
    const missing: string[] = [];

    for (const name of code.keys()) {
      if (NOT_IN_COMPOSE.has(name)) continue;
      // Anchored to the env-list indentation: a mention in a comment must not
      // satisfy this.
      if (!new RegExp(`^\\s{6}${name}:`, 'm').test(compose)) missing.push(name);
    }

    assert.deepEqual(
      missing,
      [],
      `read by env.ts but absent from the docker-compose.yml environment list: ${missing.join(', ')}. ` +
        'Add them there, or add them to NOT_IN_COMPOSE with a reason.',
    );
  });

  it('docker-compose.yml does not contradict a boolean default', () => {
    const compose = parseComposeDefaults(read('docker-compose.yml'));
    assert.ok(compose.size > 0, 'parsed no interpolated defaults from docker-compose.yml');

    for (const [name, value] of compose) {
      const expected = code.get(name);
      if (expected === undefined) continue;
      if (ALLOWED_TO_DIFFER.has(name)) continue;
      if (expected !== 'true' && expected !== 'false') continue;

      assert.equal(
        value,
        expected,
        `docker-compose.yml passes ${name}=${value}, overriding the code default of ${expected}. ` +
          'Compose passes the literal, and bool() only falls back when a variable is unset.',
      );
    }
  });

  it('offers every Compose setting in .env.docker.example', () => {
    /*
     * One level out, same failure in a new place. The check above enforces
     * env.ts -> Compose; nothing enforced Compose -> the file the README tells a
     * Docker operator to copy. The twelve DETECT_* and RATE_LIMIT_* knobs were
     * reachable and undiscoverable, which is most of the way back to the original
     * problem.
     */
    const compose = parseComposeDefaults(read('docker-compose.yml'));
    const example = parseDotenv(read('.env.docker.example'));
    const missing = [...compose.keys()].filter((name) => !COMPOSE_OWNS.has(name) && !example.has(name));

    assert.deepEqual(
      missing,
      [],
      `interpolated in docker-compose.yml but absent from .env.docker.example: ${missing.join(', ')}. ` +
        'An operator copying the example cannot discover a setting that is not in it.',
    );
  });
});
