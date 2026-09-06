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

/**
 * One job's block, from its `  <name>:` line to the next job at that indent.
 *
 * Scoped rather than searched, and that is the whole correction this file needed:
 * the first version matched `services:`, `image: postgres:` and the health check
 * ANYWHERE in `ci.yml`, and the pre-existing `docker` job already declares a
 * Postgres service carrying all three. Deleting the entire service block from the
 * `test` job left this suite green — a standing check that did not check the
 * thing it was named for.
 *
 * Extracted by indentation rather than parsed, because there is no YAML parser in
 * this project's dependencies and adding one to read five keys would be the
 * heavier mistake. The family this file belongs to — `test-glob.test.ts`,
 * `env-defaults.test.ts` — is text in, no library, on purpose.
 */
function job(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `ci.yml has no "${name}" job; this guard is now blind`);
  const rest = ci.slice(start + 1);
  // The next line at exactly two spaces of indent is the next job.
  const end = rest.search(/\n {2}\S[^\n]*:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The step that runs the API suite, from its `- name:` to the next step's. */
function apiTestStep(): string {
  const block = job('test');
  const start = block.indexOf('- name: Test (API)');
  assert.notEqual(start, -1, 'the "test" job no longer has a "Test (API)" step; this guard is now blind');
  const rest = block.slice(start + 1);
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
    //
    // `DATABASE_URL` specifically, not `TEST_DATABASE_URL`: the harness honours
    // an explicit test URL exactly as given, so setting that one would put both
    // database suites back in a single database truncating each other. The base
    // URL is what lets it derive a per-suite name. Asserting the right variable
    // is the whole value of this check.
    // This pattern also matches `TEST_DATABASE_URL:`, which is why the second
    // assertion is not optional: together they say "a base URL, and not the
    // verbatim one". Either alone would pass on the wrong variable.
    assert.match(
      apiTestStep(),
      /DATABASE_URL:\s*\S+/,
      'the API test step must set DATABASE_URL so the harness can derive per-suite databases',
    );
    assert.doesNotMatch(
      apiTestStep(),
      /TEST_DATABASE_URL:/,
      'TEST_DATABASE_URL is honoured verbatim, which would share one database between the suites',
    );
  });

  it('declares a Postgres service on the job that runs them', () => {
    // On the `test` job specifically. Another job's database is not one these
    // suites can reach, and matching the file as a whole is how this assertion
    // used to pass on the `docker` job's service while the `test` job had none.
    const block = job('test');
    assert.match(block, /services:/, 'the "test" job declares no services');
    assert.match(
      block,
      /image:\s*postgres:/,
      'the "test" job must run a Postgres service container for the database-backed suites',
    );
  });

  it('waits for that service to be ready', () => {
    // A container that has accepted a TCP connection may still be initialising.
    // Without a health check the job races it, and the failure is intermittent —
    // the worst kind to debug and the easiest to re-run until it passes.
    assert.match(
      job('test'),
      /--health-cmd/,
      'the "test" job needs a health check on its Postgres service, or the job races it',
    );
  });

  it('runs the same major version as docker-compose', () => {
    // Two different databases between CI and a developer's machine is how a
    // version-specific SQL bug gets found by whichever one nobody was watching.
    const compose = readFileSync(join(REPO, 'docker-compose.yml'), 'utf8');
    const major = (text: string) => /image:\s*postgres:(\d+)/.exec(text)?.[1];

    assert.equal(
      major(job('test')),
      major(compose),
      'CI and docker-compose must run the same Postgres major',
    );
  });
});
