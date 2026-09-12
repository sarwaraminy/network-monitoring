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
let flowResolutionWithRecovery: typeof import('./flow-settings.service.js').flowResolutionWithRecovery;
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
    ({ saveFlowSettings, loadFlowSettings, flowResolutionWithRecovery } = await import(
      './flow-settings.service.js'
    ));
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

  it('does not claim a save for a retry that wrote nothing', async () => {
    /*
     * The empty patch is the retry button, and it is how that button reaches the
     * server at all — a form whose values are already correct produces no diff,
     * so there is nothing else to send.
     *
     * Throwing on this path told an administrator "the setting was saved and
     * will be used the next time the API starts" about a request that saved
     * nothing. The worse half is that the throw returns before the route's
     * `restartFlowCollector()`, so the one control provided for recovering a bad
     * bind failed to rebind and reported its failure as a successful save.
     */
    breakTheReadBack();

    const saved = await saveFlowSettings({}, ACTOR);

    assert.equal(saved.changed, false);
    // Unchanged before and after, so the route falls through to its stalled
    // check — which is the branch the retry exists to reach.
    assert.equal(saved.needsRebind, false);
    assert.equal(saved.allowlistChanged, false);
  });

  it('still refuses to report a real write it could not read back', async () => {
    // The distinction, from the other side: guarding on `wrote` must not turn
    // the case above into an excuse for the one that matters.
    breakTheReadBack();

    await assert.rejects(
      () => saveFlowSettings({ port: 4739 }, ACTOR),
      (error: unknown) => (error as { code?: string }).code === 'error.flow_saved_not_applied',
    );
  });

  it('re-reads for the settings form after a boot that could not', async () => {
    /*
     * A failed read at boot used to be permanent. Nothing tried again, and
     * `GET /settings` answers from the same in-memory cache — so an API that
     * started a few seconds ahead of Postgres reported every field as
     * `source: 'default'` over stored values anyone could see in the database,
     * for the life of the process, with a restart as the only way out.
     *
     * That row-versus-`source` disagreement is the one failure the three-layer
     * design exists to make impossible, and opening the form is exactly when
     * somebody is asking for the truth.
     */
    await database.pool!.query('INSERT INTO flow_settings (id, port, updated_by) VALUES (1, 9995, $1)', [
      'someone@example.test',
    ]);

    breakTheReadBack();
    await loadFlowSettings();

    // The stale cache: nothing was read, so the row's 9995 is nowhere in it.
    const { currentFlowResolution } = await import('./flow-settings.service.js');
    assert.equal(currentFlowResolution().port.source, 'default');

    // The database comes back, and the next read of the form recovers.
    mock.restoreAll();
    const recovered = await flowResolutionWithRecovery();

    assert.equal(recovered.port.value, 9995);
    assert.equal(recovered.port.source, 'database');
  });

  it('serves what it has when the retry fails too', async () => {
    // A settings form that will not open is worse than one reporting the layer
    // it fell back to — and the caller has no better answer to offer.
    breakTheReadBack();
    await loadFlowSettings();

    const resolution = await flowResolutionWithRecovery();
    assert.equal(resolution.port.source, 'default');
  });

  it('does not re-read when the cache is known to be good', async () => {
    /*
     * The other half of the flag, and the reason it is a flag rather than an
     * unconditional read: `GET /settings` is opened by a form, not by a hot
     * path, but a re-read on every call would still be a query per keystroke on
     * a refetching client for no gain.
     */
    await loadFlowSettings();

    const reads = mock.method(db, 'select');
    await flowResolutionWithRecovery();

    assert.equal(reads.mock.callCount(), 0);
  });
});
