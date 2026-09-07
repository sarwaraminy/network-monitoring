import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { openTestDatabase, truncateAll } from './database.js';

/**
 * The harness itself, since the suites that rely on it cannot see it fail.
 *
 * Every database suite starts from `truncateAll`, so a fixture it gets wrong is
 * a fixture every one of them inherits — and silently. The specific failure this
 * pins: `TRUNCATE` removes the rows MIGRATIONS seeded, and `runMigrations` does
 * not put them back, because the migration stays recorded as applied. V7 seeds
 * `delivery_settings` id 1, so without a restore the very first truncate leaves
 * the process in a state production cannot reach — where the settings row does
 * not exist. A suite touching delivery settings then exercises the "no row to
 * update" branch: a test passing against that is asserting the wrong behaviour,
 * and one failing against it is chasing a condition that does not exist.
 */

const database = await openTestDatabase({ id: 'harness' });

const countOf = async (table: string) =>
  Number((await database.pool!.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

describe('the database test harness', { skip: database.skip }, () => {
  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  after(async () => {
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('leaves the rows migrations seeded in place', async () => {
    // Named against `delivery_settings` because that is the one that exists
    // today, but asserted as "what migrations left", which is what the restore
    // actually captures — a future seeded table is covered without an edit here.
    assert.equal(await countOf('delivery_settings'), 1, 'the migration-seeded settings row is gone');
  });

  it('still empties the tables the tests own', async () => {
    // The other half: a restore that put everything back would make truncation
    // useless, and every suite would inherit the previous test's rows.
    await database.pool!.query(
      `INSERT INTO alerts (sensor_id, kind, severity, title, description, dedup_key, first_seen, last_seen)
       VALUES ('harness', 'port_scan', 'low', 'x', 'x', 'harness-1', now(), now())`,
    );
    assert.equal(await countOf('alerts'), 1);

    await truncateAll(database.pool!);

    assert.equal(await countOf('alerts'), 0, 'truncation did not empty a table the tests own');
  });

  it('restores the seeded row after a test has changed it', async () => {
    await database.pool!.query('DELETE FROM delivery_settings');
    assert.equal(await countOf('delivery_settings'), 0);

    await truncateAll(database.pool!);

    assert.equal(await countOf('delivery_settings'), 1, 'the seeded row was not restored');
  });

  it('keeps the append-only trigger armed after truncating', async () => {
    // `truncateAll` disables the TRUNCATE trigger on `audit_events` to do its
    // job. If it ever failed to re-enable one, a later suite would "prove" the
    // audit trail is append-only against a table where nothing enforces it —
    // the worst kind of passing test.
    await database.pool!.query(
      `INSERT INTO audit_events (actor, action, subject) VALUES ('harness', 'alert.delete', '1')`,
    );

    await assert.rejects(
      () => database.pool!.query('UPDATE audit_events SET actor = $1', ['someone-else']),
      /append-only/,
      'audit_events accepted an UPDATE; the trigger was left disabled',
    );
  });
});
