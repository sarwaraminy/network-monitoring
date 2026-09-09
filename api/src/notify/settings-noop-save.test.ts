import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * A save that changes nothing must leave the row alone.
 *
 * `saveDeliverySettings` diffed the patch to decide whether to write an *audit*
 * entry, and ran the upsert either way. Every field of the patch schema is
 * optional and the form resubmits what it is showing, so pressing Save with
 * nothing edited rewrote `updated_at` and overwrote `updated_by` with whoever
 * pressed it — reattributing the last real change to somebody who did not make
 * it. "Who last changed where our alerts go" is precisely what that column is
 * read for.
 *
 * `saveAdhocSettings` already skipped the write for this reason and its own
 * docblock named this path as the gap. This is that gap closed, and the test
 * that says so.
 *
 * Asserted on the columns rather than through the API, because the defect is in
 * what reaches the row: the response body was correct throughout, which is why
 * this was invisible from the interface.
 */

const database = await openTestDatabase({ id: 'deliverynoopsave' });

let settingsService: typeof import('./settings.service.js');

interface Stamp {
  updated_at: Date;
  updated_by: string | null;
  webhook_url: string | null;
}

const stamp = async (): Promise<Stamp> =>
  (
    await database.pool!.query<Stamp>(
      'SELECT updated_at, updated_by, webhook_url FROM delivery_settings WHERE id = 1',
    )
  ).rows[0]!;

const actor = (name: string) => ({ id: 1, name });

describe('saving delivery settings with nothing changed', { skip: database.skip }, () => {
  before(async () => {
    settingsService = await import('./settings.service.js');
    // A real change first, so there is a stamp worth preserving to compare against.
    await settingsService.saveDeliverySettings(
      { webhookUrl: 'https://hooks.example.com/original' },
      actor('alice'),
    );
  });

  after(async () => {
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('leaves updated_at and updated_by as the last real change left them', async () => {
    const before = await stamp();
    assert.equal(before.updated_by, 'alice');

    // The shape the form sends: the values it is already displaying.
    await settingsService.saveDeliverySettings(
      { webhookUrl: 'https://hooks.example.com/original' },
      actor('bob'),
    );

    const after = await stamp();
    assert.equal(after.updated_by, 'alice', 'a no-op save reattributed the change to whoever pressed Save');
    assert.deepEqual(after.updated_at, before.updated_at, 'a no-op save bumped updated_at');
  });

  it('leaves them alone for an empty patch too', async () => {
    const before = await stamp();
    await settingsService.saveDeliverySettings({}, actor('carol'));

    const after = await stamp();
    assert.equal(after.updated_by, 'alice');
    assert.deepEqual(after.updated_at, before.updated_at);
  });

  it('still records a real change, and attributes it to whoever made it', async () => {
    // The other half. Skipping a no-op must not have made the write conditional
    // on something that could also swallow an edit.
    const before = await stamp();
    await settingsService.saveDeliverySettings(
      { webhookUrl: 'https://hooks.example.com/moved' },
      actor('dave'),
    );

    const after = await stamp();
    assert.equal(after.webhook_url, 'https://hooks.example.com/moved');
    assert.equal(after.updated_by, 'dave');
    assert.ok(after.updated_at > before.updated_at, 'a real change did not advance updated_at');
  });

  it('writes one audit row for the real change and none for the no-ops', async () => {
    const { rows } = await database.pool!.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_events WHERE action = 'delivery_settings.update'`,
    );
    // Two real changes across this suite — alice's in `before`, dave's above —
    // and three saves that changed nothing.
    assert.equal(Number(rows[0]!.n), 2);
  });
});
