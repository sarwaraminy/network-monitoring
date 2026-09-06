import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * The console in WRITE mode, and — more importantly — what write mode still
 * cannot do.
 *
 * Read-write was asked for deliberately, after the read-only trade-off was put
 * and declined. The design answer is a SECOND role rather than new grants on the
 * first: `ADHOC_WRITE_ENABLED` chooses which role to authenticate as, so a
 * read-only install stays read-only in the database rather than behind an `if`,
 * and the flag is never the only thing between a browser session and a DELETE.
 *
 * Most of what follows is therefore about the boundary rather than the feature.
 * A console that can delete findings is a reasonable thing to want; one that can
 * also rewrite the audit trail, read password hashes or change who is an
 * administrator is not, and "we granted writes" is exactly the moment those stop
 * being separate questions.
 */

process.env.ADHOC_ENABLED = 'true';
process.env.ADHOC_WRITE_ENABLED = 'true';
process.env.ADHOC_DB_PASSWORD = 'adhoc-write-test-password';
process.env.ADHOC_TIMEOUT_MS = '2000';

const database = await openTestDatabase({ id: 'adhocwrite' });

let adhoc: typeof import('./adhoc.service.js');

async function refused(sql: string, why: string): Promise<string> {
  try {
    await adhoc.runAdhocQuery(sql);
  } catch (error) {
    return (error as Error).message;
  }
  return assert.fail(`write mode allowed "${sql.slice(0, 60)}" — ${why}`);
}

const countAlerts = async () =>
  Number((await database.pool!.query<{ n: string }>('SELECT count(*) AS n FROM alerts')).rows[0]!.n);

describe('ad hoc console in write mode', { skip: database.skip }, () => {
  before(async () => {
    adhoc = await import('./adhoc.service.js');
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'the write console refused to start');
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
    await database.pool!.query(
      `INSERT INTO alerts (kind, severity, title, description, dedup_key, first_seen, last_seen)
       SELECT 'port_scan', 'low', 'seed ' || n, 'seed', 'write-seed-' || n, now(), now()
         FROM generate_series(1, 5) AS n`,
    );
  });

  after(async () => {
    await adhoc.stopAdhoc();
    await adhoc.revokeAdhocLogin(database.pool!);
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('deletes rows, and says how many', async () => {
    const result = await adhoc.runAdhocQuery(`DELETE FROM alerts WHERE dedup_key LIKE 'write-seed-%'`);

    // A DELETE returns no rows, so the count IS the answer — without it the
    // console replies to a destructive statement with a blank grid.
    assert.equal(result.command, 'DELETE');
    assert.equal(result.rowsAffected, 5);
    assert.equal(await countAlerts(), 0);
  });

  it('commits, rather than reporting a change it rolled back', async () => {
    // The read path runs in a transaction it always rolls back. Carrying that
    // into write mode would have produced the worst possible outcome: "5 rows"
    // on screen and nothing changed in the database.
    await adhoc.runAdhocQuery(`UPDATE alerts SET severity = 'high'`);

    const { rows } = await database.pool!.query<{ n: string }>(
      `SELECT count(*) AS n FROM alerts WHERE severity = 'high'`,
    );
    assert.equal(Number(rows[0]!.n), 5, 'the update was reported and then rolled back');
  });

  it('still reads, and still caps and reports what it read', async () => {
    const result = await adhoc.runAdhocQuery('SELECT id FROM alerts ORDER BY id');

    // `FETCH` is our cursor, not the operator's statement.
    assert.equal(result.command, 'SELECT');
    assert.equal(result.rowsAffected, undefined, 'a SELECT must not report rows "affected"');
    assert.equal(result.rows.length, 5);
  });

  it('cannot touch the audit trail', async () => {
    // The guarantee write mode must not cost. A console that can rewrite the
    // trail is one whose own use cannot be investigated — which is the whole
    // point of V9, and this console writes an entry for every query it runs.
    await refused('DELETE FROM audit_events', 'the audit trail must stay append-only');
    await refused(`UPDATE audit_events SET actor = 'someone else'`, 'rewriting history');
  });

  it('cannot change who can log in', async () => {
    await refused(`UPDATE users SET role = 'ADMIN'`, 'privilege escalation');
    await refused(`DELETE FROM users`, 'removing accounts');
  });

  it('cannot change where findings are delivered', async () => {
    // Delivery settings have their own screen and their own audit entry. A
    // console UPDATE here would redirect alerts with no record beyond the query.
    await refused(
      `UPDATE delivery_settings SET webhook_url = 'https://elsewhere.test'`,
      'redirecting alerts',
    );
  });

  it('still cannot read the columns holding secrets', async () => {
    // Being able to write is not a reason to be able to read a password hash.
    await refused('SELECT password FROM users', 'password hashes');
    await refused('SELECT email_password FROM delivery_settings', 'the SMTP password');
  });

  it('still cannot reach outside the database', async () => {
    await refused(`COPY alerts FROM PROGRAM 'id'`, 'command execution on the database host');
    await refused('DROP TABLE alerts', 'destroying the schema');
  });

  it('explains what it refused in write-mode terms', async () => {
    // The read-only sentence would be false here and would send the operator
    // looking for the wrong thing.
    const message = await refused('DELETE FROM audit_events', 'the trail');

    assert.match(message, /operational tables/i);
    assert.doesNotMatch(message, /read-only/i);
  });
});
