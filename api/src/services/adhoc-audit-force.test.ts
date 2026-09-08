import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * "Write mode forces auditing to `all`", and the window in which it was not.
 *
 * `env.ts` states the rule and `effectiveAdhocSettings` applies it — to the
 * SETTINGS. Whether a statement can actually write is not a setting: it is the
 * identity of the role the pool authenticated as, which is `activeMode`. The two
 * are the same fact only while nothing is changing.
 *
 * `PUT /api/adhoc/settings` is where they come apart. It updates the settings
 * cache, awaits an INSERT into `audit_events` inside the same transaction, and
 * only then stops and restarts the pool. Turning write mode OFF therefore
 * loosens `audit` first and narrows the role second, and in the window between —
 * one round trip wide — a `POST /api/adhoc/query` read `audit: 'off'` from the
 * settings while the pool was still authenticated as the write role. A DELETE in
 * that window committed with no `adhoc.query` row.
 *
 * Turning write mode ON was never affected: there the setting tightens first and
 * the role widens second, so the two disagree in the harmless direction. That
 * asymmetry is the tell. A rule that holds in one direction only is not being
 * enforced.
 *
 * **Write mode comes from the stored row here, not from the environment**, and
 * that is the whole reason this is a separate file from `adhoc-write.test.ts`.
 * With `ADHOC_WRITE_ENABLED` set, the environment wins the resolution, so
 * `saveAdhocSettings` cannot move `writeEnabled` at all and the window cannot be
 * opened — the route answers 409 for a pinned field before it gets near one. The
 * defect arrived with V15 making the row a source too, which is exactly the
 * configuration reproduced below.
 */

process.env.ADHOC_ENABLED = 'true';
process.env.ADHOC_DB_PASSWORD = 'adhoc-audit-force-test-password';
// Deliberately NOT set: it would pin the field this test has to change.
process.env.ADHOC_WRITE_ENABLED = undefined as unknown as string;
delete process.env.ADHOC_WRITE_ENABLED;
delete process.env.ADHOC_AUDIT;

const database = await openTestDatabase({ id: 'adhocauditforce' });

let adhoc: typeof import('./adhoc.service.js');
let settings: typeof import('./adhoc-settings.service.js');

describe('the audit force follows the pool, not the settings', { skip: database.skip }, () => {
  before(async () => {
    adhoc = await import('./adhoc.service.js');
    settings = await import('./adhoc-settings.service.js');
  });

  after(async () => {
    await adhoc.stopAdhoc();
    await adhoc.revokeAdhocLogin(database.pool!);
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  /** Write mode on, from the row, with the pool actually authenticated for it. */
  async function writeConsole(): Promise<void> {
    await settings.saveAdhocSettings({ enabled: true, writeEnabled: true, audit: 'all' }, 'test');
    await adhoc.stopAdhoc();
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'the write console refused to start');
    assert.equal(adhoc.adhocStatus().mode, 'write', 'the row did not put the pool into write mode');
  }

  it('keeps auditing while the pool is still authenticated to write', async () => {
    await writeConsole();
    assert.equal(adhoc.currentAuditMode(), 'all');

    // Exactly what the route does first, stopping where it goes on to restart
    // the pool. `saveAdhocSettings` is the real function; nothing is simulated.
    await settings.saveAdhocSettings({ writeEnabled: false, audit: 'off' }, 'test');

    assert.equal(
      settings.currentAdhocSettings().audit,
      'off',
      'the settings really did loosen — otherwise this test proves nothing',
    );
    assert.equal(
      adhoc.adhocStatus().mode,
      'write',
      'the pool really is still a writer — otherwise there is no window to close',
    );

    // The point. A DELETE arriving here is audited, because the answer is read
    // from the role that would execute it rather than from the settings.
    assert.equal(adhoc.currentAuditMode(), 'all');
  });

  it('lets the force go once the pool is no longer a writer', async () => {
    await writeConsole();
    await settings.saveAdhocSettings({ writeEnabled: false, audit: 'off' }, 'test');
    await adhoc.stopAdhoc();

    // Forced, not stuck on. The force belongs to the live pool, so it lifts with
    // it — otherwise this would be a rule nobody could ever switch back off.
    assert.equal(adhoc.currentAuditMode(), 'off');
  });

  it('leaves a read-mode console reporting its own setting', async () => {
    await settings.saveAdhocSettings({ enabled: true, writeEnabled: false, audit: 'refused' }, 'test');
    await adhoc.stopAdhoc();
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'the read console refused to start');

    assert.equal(adhoc.adhocStatus().mode, 'read');
    // `refused` is the quieter mode and has to survive: a force that applied in
    // read mode would make the setting unreachable rather than safe.
    assert.equal(adhoc.currentAuditMode(), 'refused');
  });
});
