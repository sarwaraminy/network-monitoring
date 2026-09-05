import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * Switching the console off takes its login away.
 *
 * `stopAdhoc`'s docblock says the role does not outlive the console, and for a
 * while that was a claim the file did not honour: the revoke only ran on
 * shutdown of a process that had the console ON, so the operator action that
 * actually matters — set `ADHOC_ENABLED=false`, restart — returned early and
 * revoked nothing. The role kept LOGIN and the configured password indefinitely
 * after the feature was switched off, with PUBLIC holding CONNECT by default.
 *
 * That is the shape of thing this PR keeps rediscovering: a small edit in a big
 * function, invisible to every other test, described correctly by a comment that
 * had stopped being true. So it is pinned here rather than fixed again.
 *
 * A separate file because `env.ts` freezes `process.env` at import and this suite
 * needs `ADHOC_ENABLED` to differ between the two halves — on to provision the
 * login, off to prove it is taken away.
 */

process.env.ADHOC_ENABLED = 'true';
process.env.ADHOC_DB_PASSWORD = 'adhoc-disabled-test-password';

const database = await openTestDatabase({ id: 'adhocoff' });

let adhoc: typeof import('./adhoc.service.js');

/** Whether the console's role may log in, asked of the database. */
async function canLogIn(): Promise<boolean> {
  const { rows } = await database.pool!.query<{ name: string }>('SELECT current_database() AS name');
  const { rows: role } = await database.pool!.query<{ login: boolean }>(
    'SELECT rolcanlogin AS login FROM pg_roles WHERE rolname = $1',
    [adhoc.adhocRole(rows[0]!.name)],
  );
  return role[0]?.login === true;
}

describe('turning the ad hoc console off', { skip: database.skip }, () => {
  before(async () => {
    adhoc = await import('./adhoc.service.js');
  });

  after(async () => {
    await adhoc.stopAdhoc();
    await adhoc.revokeAdhocLogin(database.pool!);
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('provisions a login while it is enabled', async () => {
    // The control. Without it the assertion below passes on a role that was
    // never given a login in the first place.
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'the console refused to start');
    assert.equal(await canLogIn(), true, 'the console started without provisioning a login');
  });

  it('takes the login away when the feature is switched off', async () => {
    // What an operator does: set the flag false and restart. `env` is read once
    // at import, so the flag is flipped on the frozen object the service reads —
    // the same state a restart would produce, without a second process.
    const { env } = await import('../config/env.js');
    (env.adhoc as { enabled: boolean }).enabled = false;

    try {
      assert.equal(await adhoc.startAdhoc(database.pool!), false, 'a disabled console started');
      assert.equal(
        await canLogIn(),
        false,
        'the role can still log in with the configured password after the console was switched off',
      );
    } finally {
      (env.adhoc as { enabled: boolean }).enabled = true;
    }
  });
});
