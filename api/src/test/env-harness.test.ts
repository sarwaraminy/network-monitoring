import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { unsetForTest } from './env.js';

/**
 * The other half of the harness, and the one the suites that rely on it cannot
 * see fail.
 *
 * Several suites have to run with a variable *absent* — a three-layer resolver
 * has no way to fall through to its stored row while the environment is pinning
 * the field, so a leaked `ADHOC_WRITE_ENABLED` does not make those tests fail
 * loudly, it makes them assert the wrong layer. Both files that needed it wrote
 * `delete process.env.X` and both carried a docblock warning that a leak would
 * look like a bug in the resolver rather than a leaked environment. Which is
 * exactly what happened: five tests that passed in CI and failed on any machine
 * with an `api/.env`, for two years, reported as a resolver returning
 * `'environment'` where `'default'` was expected.
 *
 * `unsetForTest` fixes it by writing a blank, and that rests on two facts about
 * code this repository does not own. Neither is visible from a test that depends
 * on it, and if either changes the suites go quietly wrong again in the same way
 * — so both are pinned here rather than trusted.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ENV = join(HERE, '..', '..', '.env');

describe('unsetting an environment variable for a test', () => {
  it('leaves a value the config parsers read as absent', () => {
    /*
     * The convention this relies on, stated from the other side in the README
     * and the user guide: `NOTIFY_ENABLED=` with nothing after it is somebody who
     * has not decided, not somebody who chose "no". `env.ts`'s `int` and `bool`
     * return their fallback for a value that trims to empty, and
     * `parseFieldValue` returns `undefined`, which is what "the environment says
     * nothing about this field" means to the resolver.
     */
    unsetForTest('NM_TEST_ABSENT_VARIABLE');

    const raw = process.env.NM_TEST_ABSENT_VARIABLE;
    assert.equal(typeof raw, 'string', 'the variable must still be present to survive dotenv');
    assert.equal(raw?.trim(), '', 'a non-blank value would pin the field this is meant to free');
  });

  it('survives a later dotenv.config(), which is the whole point', () => {
    /*
     * The ordering that defeated `delete`. A test's top-level statements run
     * BEFORE `config/env.ts` is loaded — that happens through
     * `openTestDatabase`, or through the dynamic `import()` in a `before` hook —
     * and that module calls `dotenv.config()` on `api/.env`. So a deleted
     * variable is deleted and then restored.
     *
     * A blank survives because dotenv's `populate` skips any key
     * `hasOwnProperty` already reports, and that is true of an empty string.
     * Asserted against the real dotenv rather than reasoned about, because it is
     * a default (`override: false`) that a major version could change.
     */
    process.env.NM_TEST_DOTENV_TARGET = 'from-the-environment';
    unsetForTest('NM_TEST_DOTENV_TARGET');

    dotenv.populate(process.env as Record<string, string>, {
      NM_TEST_DOTENV_TARGET: 'from-the-dotenv-file',
    });

    assert.equal(
      process.env.NM_TEST_DOTENV_TARGET,
      '',
      'dotenv overwrote a blanked variable, so every test relying on one being absent is leaking again',
    );
  });

  it('is what a deleted variable is not', () => {
    // The failure itself, so the fix is not taken on trust. `delete` removes the
    // key, dotenv then finds it missing and sets it — which is how `api/.env`
    // reached the tests that had explicitly cleared it.
    process.env.NM_TEST_DELETED_TARGET = 'from-the-environment';
    delete process.env.NM_TEST_DELETED_TARGET;

    dotenv.populate(process.env as Record<string, string>, {
      NM_TEST_DELETED_TARGET: 'from-the-dotenv-file',
    });

    assert.equal(
      process.env.NM_TEST_DELETED_TARGET,
      'from-the-dotenv-file',
      'if this ever stops holding, `delete` has become safe and this file can go',
    );
  });

  it('is needed because a developer .env really does set these', () => {
    /*
     * The environmental half, and why this was invisible in CI. Skipped where
     * there is no `api/.env` — which is CI, and is precisely the configuration
     * under which the five broken tests passed.
     *
     * Asserted as "the file sets something the query-console suites clear",
     * rather than naming one variable: the point is that the shipped example
     * environment is expected to pin these, so a test must not depend on their
     * being absent by default.
     */
    let file: string;
    try {
      file = readFileSync(API_ENV, 'utf8');
    } catch {
      return; // No api/.env here. Nothing to leak, which is CI's situation.
    }

    const parsed = dotenv.parse(file);
    const cleared = ['ADHOC_ENABLED', 'ADHOC_WRITE_ENABLED', 'ADHOC_AUDIT'];
    const present = cleared.filter((name) => (parsed[name] ?? '').trim() !== '');

    assert.ok(
      present.length > 0,
      'this api/.env pins none of the query-console fields, so it would not have exposed the bug ' +
        'either — not a failure, but this case is asserting nothing on this machine',
    );
  });
});
