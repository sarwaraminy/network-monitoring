import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * The retention scheduler, with retention *enabled*.
 *
 * `retention.test.ts` covers the disabled case and cannot cover this one: `env.ts`
 * reads `process.env` once at import, so a suite that needs `RETENTION_ENABLED=true`
 * has to be a separate file with its own process.
 *
 * What is under test is shutdown. Two handles are armed — the recurring interval and
 * a one-shot first sweep a minute out — and the first version cleared only the
 * interval. That left a sweep able to start *after* `closeDb()`, and a stop/start
 * cycle able to arm a second bootstrap timeout while the first was still pending,
 * which is two concurrent sweeps deleting the same days.
 *
 * None of that is observable from the process's resource list, because both handles
 * are `unref`'d and so never appear in `getActiveResourcesInfo()` — the mistake an
 * earlier test in this feature already made once. `stopRetention` returns how many
 * handles it cancelled instead, which the shutdown path logs.
 */

let retention: typeof import('./retention.service.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  process.env.RETENTION_ENABLED = 'true';
  // Deliberately unreachable, and nothing here should ever get as far as a query:
  // the first sweep is a minute out and every test cancels it immediately. If one
  // ever did fire, this makes it a connection error in the log rather than a
  // silent deletion from whatever database the developer had configured.
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/should-never-connect';
  // Long enough that the recurring sweep cannot fire during the suite either.
  process.env.RETENTION_SWEEP_HOURS = '24';
  retention = await import('./retention.service.js');
});

describe('retention scheduling', () => {
  it('schedules both the recurring sweep and the first one', () => {
    assert.equal(retention.startRetention(), true);

    // Two: the interval, and the one-shot that runs a minute after boot. This is
    // the assertion that fails if either is dropped, and the one that failed when
    // `stopRetention` cleared the interval alone.
    assert.equal(retention.stopRetention(), 2);
  });

  it('has nothing left to cancel afterwards', () => {
    // A second stop is not an error — shutdown can be reached from more than one
    // path — but it must not report work it did not do.
    assert.equal(retention.stopRetention(), 0);
  });

  it('does not stack handles when started twice', () => {
    assert.equal(retention.startRetention(), true);
    // Already running: this must be a no-op rather than a second interval and a
    // second bootstrap sweep.
    assert.equal(retention.startRetention(), true);

    assert.equal(retention.stopRetention(), 2);
  });

  it('arms a fresh pair after a stop, not a leftover one', () => {
    // The stop/start cycle from the review. If the bootstrap handle survived the
    // stop, the restart would leave three timers behind and two sweeps would run
    // over the same days.
    retention.startRetention();
    retention.stopRetention();
    retention.startRetention();

    assert.equal(retention.stopRetention(), 2);
  });
});
