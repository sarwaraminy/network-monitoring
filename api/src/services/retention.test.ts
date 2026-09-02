import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * Retention, in the parts that do not need Postgres.
 *
 * The substance of this feature is SQL — aggregate a day, delete it, both in one
 * transaction — and mocking a database to assert that SQL would be testing the mock.
 * That half is verified against a real Postgres and written up in the pull request;
 * what is pinned here is everything around it, which is where the two failure modes
 * that would actually hurt live:
 *
 *  - **A disabled sweep must not touch anything.** `RETENTION_ENABLED=false` is the
 *    escape hatch for an installation that must keep every finding — a compliance
 *    requirement, or simply a decision — and an escape hatch that still deletes is
 *    worse than none, because the operator has been told they are safe.
 *  - **A scheduler must not run when disabled, and must stop when asked.** A timer
 *    that survives shutdown holds the process open; one that fires when the feature
 *    is off deletes data nobody authorised.
 *
 * The environment is set before the import because `env.ts` reads `process.env` once,
 * at module load. This file runs in its own process, so the setting cannot leak into
 * another suite.
 */

let retention: typeof import('./retention.service.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  process.env.RETENTION_ENABLED = 'false';
  // Deliberately unreachable. Nothing here should open a connection, and if the
  // disabled path ever started issuing queries this would make it obvious rather
  // than quietly slow.
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/should-never-connect';
  retention = await import('./retention.service.js');
});

describe('retention when disabled', () => {
  it('reports that it skipped rather than that it found nothing', async () => {
    // The distinction matters for anyone reading a log or a status response: "swept,
    // deleted 0" and "did not sweep" are different states, and only one of them
    // means the operator's setting is being honoured.
    const result = await retention.sweepRetention();

    assert.equal(result.skipped, true);
    assert.equal(result.alertsDeleted, 0);
    assert.equal(result.devicesForgotten, 0);
    assert.equal(result.daysProcessed, 0);
  });

  it('deletes nothing even when called directly and repeatedly', async () => {
    // `sweepRetention` swallows its own errors, so a query attempt against the
    // unreachable database above would come back as `skipped: false` with zero
    // counts. Asserting the flag is what proves it returned before the first query
    // rather than after a failed one.
    for (let i = 0; i < 3; i += 1) {
      const result = await retention.sweepRetention();
      assert.equal(result.skipped, true, `call ${i + 1} did not skip`);
    }
  });

  it('schedules nothing, and says so', () => {
    // Asserted on the return value, not on the process's handle count. The timer is
    // `unref`'d, so it never appears in `getActiveResourcesInfo()` — the first
    // version of this test compared handle counts and passed even with the disabled
    // check deleted, which is a test that reads as coverage and provides none.
    assert.equal(retention.startRetention(), false);
    // And again, because the second call takes a different branch.
    assert.equal(retention.startRetention(), false);
  });

  it('can be stopped without having been started', () => {
    // Shutdown calls this unconditionally, including on a process that never
    // started a sweep, and it must not throw there.
    retention.stopRetention();
    retention.stopRetention();
  });
});
