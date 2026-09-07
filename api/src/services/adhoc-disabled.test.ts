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
// STATED, not inherited. `env.ts` loads `api/.env`, so a developer who has
// switched write mode on for their own machine would otherwise run this suite in
// the wrong mode — and its assertions are all about what read mode refuses, so
// they would fail with no hint that the mode was the reason.
process.env.ADHOC_WRITE_ENABLED = 'false';

process.env.ADHOC_DB_PASSWORD = 'adhoc-disabled-test-password';

const database = await openTestDatabase({ id: 'adhocoff' });

let adhoc: typeof import('./adhoc.service.js');

/**
 * Whether one of the console's roles may log in, asked of the database.
 *
 * **The mode is required**, and that is the fix for a hole this file had. It used
 * to call `adhoc.adhocRole(name)` with no mode, taking the same `mode: 'read'`
 * default that caused the bug in `revokeAdhocLogin` — so the test and the code
 * shared the mistake and the guard could not see the thing it guards. Every
 * assertion about "the login is gone" was only ever about `nm_adhoc_<db>`, while
 * `nm_adhocrw_<db>` kept its login and its password.
 */
async function canLogIn(mode: 'read' | 'write'): Promise<boolean> {
  const { rows } = await database.pool!.query<{ name: string }>('SELECT current_database() AS name');
  const { rows: role } = await database.pool!.query<{ login: boolean }>(
    'SELECT rolcanlogin AS login FROM pg_roles WHERE rolname = $1',
    [adhoc.adhocRole(rows[0]!.name, mode)],
  );
  return role[0]?.login === true;
}

/** Re-resolves the settings the way a restart does. */
async function reload(): Promise<void> {
  const { loadAdhocSettings } = await import('./adhoc-settings.service.js');
  await loadAdhocSettings();
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
    assert.equal(await canLogIn('read'), true, 'the console started without provisioning a login');
  });

  it('takes the login away when the feature is switched off', async () => {
    /*
     * What an operator does: set the flag false and restart.
     *
     * This used to flip `env.adhoc.enabled` on the frozen object, which stopped
     * representing the path once the console started reading its settings from
     * three layers — the environment variable, a stored row, then the default.
     * Setting the variable and re-resolving is what a restart actually does, and
     * the environment wins over the row, so this is also the assertion that the
     * layering cannot be used to switch the console on where a deployment pinned
     * it off.
     *
     * `loadAdhocSettings` re-reads the row too; if that read fails it falls back
     * to the environment and the defaults, which for this suite is the same
     * answer.
     */
    process.env.ADHOC_ENABLED = 'false';
    await reload();

    try {
      assert.equal(await adhoc.startAdhoc(database.pool!), false, 'a disabled console started');
      assert.equal(
        await canLogIn('read'),
        false,
        'the role can still log in with the configured password after the console was switched off',
      );
    } finally {
      process.env.ADHOC_ENABLED = 'true';
      await reload();
    }
  });

  it('takes the WRITE login away when the feature is switched off', async () => {
    /*
     * The half this file could not see. `revokeAdhocLogin` resolved one role with
     * the `mode: 'read'` default, and this suite asserted against the same
     * default — so switching the console off left `nm_adhocrw_<db>` able to
     * authenticate with its installed password, holding INSERT, UPDATE and
     * DELETE on the operational tables from V12.
     *
     * That is a credential outliving the authorisation to use it: the console is
     * ADMIN-only, and this survived the administrator being demoted or
     * offboarded.
     *
     * Write mode has to be genuinely provisioned first, or the assertion passes
     * against a role that never had a login.
     */
    process.env.ADHOC_WRITE_ENABLED = 'true';
    await reload();
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'write mode refused to start');
    assert.equal(await canLogIn('write'), true, 'write mode started without provisioning its login');

    try {
      process.env.ADHOC_ENABLED = 'false';
      await reload();
      assert.equal(await adhoc.startAdhoc(database.pool!), false, 'a disabled console started');

      assert.equal(
        await canLogIn('write'),
        false,
        'the WRITE role can still log in after the console was switched off',
      );
      assert.equal(await canLogIn('read'), false, 'the read role can still log in');
    } finally {
      process.env.ADHOC_ENABLED = 'true';
      process.env.ADHOC_WRITE_ENABLED = 'false';
      await reload();
    }
  });

  it('strips the idle role when the mode changes, so a switch leaves nothing behind', async () => {
    /*
     * The other reachable path, and the one no off-switch covered: write→read
     * revoked nothing at all. The console came back as the read role while the
     * write role kept the password from when write mode was last on — so
     * rotating `dbPassword` in read mode left the write role authenticating with
     * the PREVIOUS one indefinitely, since only re-entering write mode updated
     * it.
     */
    process.env.ADHOC_WRITE_ENABLED = 'true';
    await reload();
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'write mode refused to start');
    assert.equal(await canLogIn('write'), true, 'write mode started without provisioning its login');

    try {
      // Back to read mode, which is what a `PUT /api/adhoc/settings` clearing
      // `writeEnabled` does: stop, then start again.
      process.env.ADHOC_WRITE_ENABLED = 'false';
      await reload();
      await adhoc.stopAdhoc();
      assert.equal(await adhoc.startAdhoc(database.pool!), true, 'read mode refused to start');

      assert.equal(await canLogIn('read'), true, 'the active role lost its login');
      assert.equal(
        await canLogIn('write'),
        false,
        'the write role kept its login after the console reverted to read mode',
      );
    } finally {
      process.env.ADHOC_WRITE_ENABLED = 'false';
      await reload();
    }
  });
});
