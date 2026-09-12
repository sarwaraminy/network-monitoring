import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * What a save is allowed to claim when the read-back fails.
 *
 * `loadFlowSettings` swallows a failed read and keeps the previous resolution,
 * and at boot that is right: a settings table that cannot be read must not stop
 * the collector binding, or an installation loses flow telemetry over a table it
 * could run perfectly well without.
 *
 * The same code on the path *after* a write means the opposite thing. The route
 * decides whether to rebind by diffing the resolution from before the write
 * against the one after it, so a stale resolution is compared against itself:
 * nothing differs, nothing needs rebinding, the response says "Saved, and in
 * force", and the collector serves the old port and the old allowlist out of its
 * cache until somebody restarts the API.
 *
 * Nothing available to the administrator contradicts that. The write committed,
 * the form confirmed it, and reopening the settings shows the new values, because
 * that reads the row rather than the cache.
 *
 * Both halves are asserted here, because the fix is a distinction rather than a
 * behaviour: the boot path must stay tolerant and the save path must not.
 *
 * `db.select` is mocked and `db.transaction` is not, which is exactly the seam
 * under test — the transaction uses its own `tx.select`, so the write really does
 * commit and only the read-back afterwards fails. That is the ordering the bug
 * needs, and it cannot be produced from outside the process.
 */

process.env.NODE_ENV = 'test';
process.env.SENSOR_ID = 'flow-save-sensor';
// Unset, or the environment would pin these and the save would be refused before
// it reached the read. Blank rather than deleted — see `test/env.ts` on dotenv.
process.env.FLOW_PORT = '';
process.env.FLOW_ENABLED = '';
process.env.FLOW_BIND_ADDRESS = '';
process.env.FLOW_EXPORTERS = '';

const database = await openTestDatabase({ id: 'flowsaveapply' });

let db: typeof import('../db/index.js').db;
let saveFlowSettings: typeof import('./flow-settings.service.js').saveFlowSettings;
let loadFlowSettings: typeof import('./flow-settings.service.js').loadFlowSettings;
let HttpError: typeof import('../middleware/error-handler.js').HttpError;

const ACTOR = { name: 'admin@example.test', id: 1 };

/** Makes the read-back fail while leaving the transaction's own reads working. */
function breakTheReadBack(): void {
  mock.method(db, 'select', () => {
    throw new Error('settings table is unreadable');
  });
}

describe('a flow save whose read-back fails', { skip: database.skip }, () => {
  before(async () => {
    ({ db } = await import('../db/index.js'));
    ({ saveFlowSettings, loadFlowSettings } = await import('./flow-settings.service.js'));
    ({ HttpError } = await import('../middleware/error-handler.js'));
  });

  beforeEach(async () => {
    mock.restoreAll();
    await database.pool!.query('DELETE FROM flow_settings');
    /*
     * And re-resolve, because the cache these functions diff against is module
     * state that has just been contradicted by the DELETE above. Without it a
     * case inherits the previous one's port as its "before" and reads an
     * allowlist edit as a socket change.
     */
    await loadFlowSettings();
    // The audit trail is not cleaned between cases: `audit_events` is append-only
    // by trigger, which is the point of it. The rows these saves write are
    // nobody's business here, and leaving them is cheaper than the exemption.
  });

  after(async () => {
    mock.restoreAll();
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('refuses to report a save it could not apply', async () => {
    breakTheReadBack();

    await assert.rejects(
      () => saveFlowSettings({ port: 4739 }, ACTOR),
      (error: unknown) => {
        assert.ok(error instanceof HttpError, 'a generic 500 would send the admin to undo a stored change');
        assert.equal((error as { status: number }).status, 500);
        assert.equal((error as { code?: string }).code, 'error.flow_saved_not_applied');
        // The English sentence travels with the key, and has to say both halves:
        // stored, and not applied.
        assert.match((error as Error).message, /saved and will be used/i);
        assert.match((error as Error).message, /previous settings/i);
        return true;
      },
    );
  });

  it('keeps the write, because the row really was committed', async () => {
    /*
     * The half the message has to be honest about. Rolling the write back is not
     * available — the transaction closed before the read was attempted — so the
     * setting IS stored and IS what the next boot will use. An error that implied
     * otherwise would be its own lie, in the opposite direction.
     */
    breakTheReadBack();
    await saveFlowSettings({ port: 4739 }, ACTOR).catch(() => undefined);

    const { rows } = await database.pool!.query<{ port: number }>(
      'SELECT port FROM flow_settings WHERE id = 1',
    );
    assert.equal(rows[0]?.port, 4739);
  });

  it('still tolerates the same failure at boot', async () => {
    // The distinction, from the other side. A database that cannot be read must
    // not stop the collector binding on the way up.
    breakTheReadBack();

    const settings = await loadFlowSettings();
    assert.equal(typeof settings.port, 'number');
  });

  it('reports the change normally when the read-back works', async () => {
    // The control. Without it the cases above would pass against a save that was
    // broken outright.
    const saved = await saveFlowSettings({ port: 4739 }, ACTOR);

    assert.equal(saved.changed, true);
    assert.equal(saved.needsRebind, true);
    assert.equal(saved.settings.port, 4739);
  });

  it('reports an allowlist edit as a change that needs no rebind', async () => {
    /*
     * The field that is deliberately not a socket property: it is a filter test
     * per datagram, so reopening a binding for it would drop what is in flight
     * for nothing. Flagged separately so the route can clear the refusal counter
     * that was measured against the list being replaced.
     */
    const saved = await saveFlowSettings({ exporters: '10.0.0.9' }, ACTOR);

    assert.equal(saved.changed, true);
    assert.equal(saved.needsRebind, false);
    assert.equal(saved.allowlistChanged, true);
  });

  it('does not flag an allowlist that did not move', async () => {
    await saveFlowSettings({ exporters: '10.0.0.9' }, ACTOR);
    const again = await saveFlowSettings({ exporters: '10.0.0.9', port: 4739 }, ACTOR);

    assert.equal(again.allowlistChanged, false);
    assert.equal(again.needsRebind, true);
  });
});
