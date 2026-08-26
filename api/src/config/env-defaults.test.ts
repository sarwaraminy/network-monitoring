import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

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

/** `NAME: ${NAME:-default}` from the Compose environment block. */
function parseComposeDefaults(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = /^\s*([A-Z0-9_]+):\s*\$\{[A-Z0-9_]+:-([^}]*)\}/gm;

  for (const match of text.matchAll(pattern)) {
    if (match[1]) values.set(match[1], (match[2] ?? '').trim());
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
  const pattern = /\b(?:bool|int|optional)\(\s*'([A-Z0-9_]+)'\s*,\s*([^),]*)\)/g;

  for (const match of text.matchAll(pattern)) {
    if (match[1]) values.set(match[1], (match[2] ?? '').trim());
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
 * Settings that must APPEAR in the Compose environment list.
 *
 * This is the direction the first version of the check missed. Both of its loops
 * iterated the example/Compose side and looked names up in the code map, so a
 * setting present in env.ts and simply absent from Compose was never examined —
 * and absence was the failure mode for two of the three cases this file cites.
 * `ALLOW_OPEN_SIGNUP` was never added to the api service's env list;
 * `INTEL_CACHE_DIR` was documented in the example and missing here.
 *
 * Hand-kept rather than derived: "security-relevant" is a judgement, and the
 * point is that adding one is a conscious act.
 */
const MUST_BE_IN_COMPOSE = [
  'ALLOW_OPEN_SIGNUP',
  'REDACT_PACKET_PAYLOAD',
  'TRUST_PROXY',
  'DB_AUTO_MIGRATE',
  'NOTIFY_INCLUDE_EVIDENCE',
  'INTEL_CACHE_DIR',
];

const ALLOWED_TO_DIFFER = new Set([
  // Compose runs migrations on boot by design; a host install may not want to.
  'DB_AUTO_MIGRATE',
  // On behind nginx, off for a direct host install. Both are correct in place,
  // which is exactly why both have to be stated rather than defaulted.
  'TRUST_PROXY',
  // Ports and hosts are deployment shape, not policy.
  'PORT',
  'API_PORT',
  'UI_PORT',
]);

describe('deployment defaults match the code', () => {
  const code = parseCodeDefaults(read('api/src/config/env.ts'));

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

  it('passes every security-relevant setting through to Compose', () => {
    // Absence, not contradiction. A setting missing from the Compose env list
    // silently takes whatever the image was built with, and a Docker operator
    // has no way to see or change it.
    const compose = read('docker-compose.yml');

    for (const name of MUST_BE_IN_COMPOSE) {
      // Anchored to the env-list indentation, not a bare substring: a mention in
      // a comment must not satisfy this.
      assert.match(
        compose,
        new RegExp(`^\\s{6}${name}:`, 'm'),
        `${name} is read by env.ts but absent from the docker-compose.yml environment list.`,
      );
    }
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
});
