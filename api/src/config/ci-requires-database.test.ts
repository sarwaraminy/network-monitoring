import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * CI must actually require the database-backed suites.
 *
 * Those suites skip when no Postgres answers, so a contributor without one can
 * still run `npm test` and get a useful result. That kindness is also the danger:
 * if CI honours the same skip, the suites evaporate and the tick stays green.
 * "Nothing failed" and "nothing ran" are indistinguishable from outside, which is
 * exactly how the quoted-glob bug ran 456 of 496 tests for as long as the script
 * had existed — see `test-glob.test.ts`, whose family this file joins.
 *
 * `REQUIRE_DB_TESTS=1` is the promise that they ran. This is the standing check
 * that the promise is still made, and that there is something to make it to.
 *
 * Text in, no library, no network, no database — deliberately, since this has to
 * keep working on the machine where the database is the thing that is missing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const WORKFLOW = join(REPO, '.github', 'workflows', 'ci.yml');

const ci = readFileSync(WORKFLOW, 'utf8');

/** The step that runs the API suite, from its `- name:` to the next step's. */
function apiTestStep(): string {
  const start = ci.indexOf('- name: Test (API)');
  assert.notEqual(start, -1, 'ci.yml no longer has a "Test (API)" step; this guard is now blind');
  const rest = ci.slice(start + 1);
  const end = rest.indexOf('\n      - name:');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('CI runs the database-backed suites for real', () => {
  it('sets REQUIRE_DB_TESTS on the API test step', () => {
    // On the step, not merely somewhere in the file: an env var set on a
    // different job would leave this one skipping.
    assert.match(
      apiTestStep(),
      /REQUIRE_DB_TESTS:\s*'?1'?/,
      'the API test step must set REQUIRE_DB_TESTS=1, or the database suites skip in CI too',
    );
  });

  it('gives that step a database to reach', () => {
    // The flag alone would turn a missing service into a hard failure rather
    // than silence, which is better — but the point is that the tests RUN.
    assert.match(
      apiTestStep(),
      /TEST_DATABASE_URL:\s*\S+/,
      'the API test step must point TEST_DATABASE_URL at the service container',
    );
  });

  it('declares a Postgres service on the job that runs them', () => {
    assert.match(ci, /services:/, 'ci.yml declares no services');
    assert.match(
      ci,
      /image:\s*postgres:/,
      'ci.yml must run a Postgres service container for the database-backed suites',
    );
  });

  it('waits for that service to be ready', () => {
    // A container that has accepted a TCP connection may still be initialising.
    // Without a health check the job races it, and the failure is intermittent —
    // the worst kind to debug and the easiest to re-run until it passes.
    assert.match(ci, /--health-cmd/, 'the Postgres service needs a health check, or the job races it');
  });

  it('runs the same major version as docker-compose', () => {
    // Two different databases between CI and a developer's machine is how a
    // version-specific SQL bug gets found by whichever one nobody was watching.
    const compose = readFileSync(join(REPO, 'docker-compose.yml'), 'utf8');
    const major = (text: string) => /image:\s*postgres:(\d+)/.exec(text)?.[1];

    assert.equal(major(ci), major(compose), 'CI and docker-compose must run the same Postgres major');
  });
});
