import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * The Ad Hoc Query console's cage, tested from inside it.
 *
 * Everything this feature is safe by is invisible when it fails. A migration
 * that did not run, a grant an operator "fixed", a role recreated by hand — each
 * leaves a console that works perfectly and is wide open, and nothing about the
 * screen looks different. So the assertions here are all of the form "this is
 * refused", and each names the specific damage it is refusing.
 *
 * Every one of them is asserted against a REAL Postgres holding the real grants
 * from V10, because that is where the enforcement lives. A version of this file
 * that mocked the driver would be asserting that we wrote the SQL we wrote.
 *
 * The application connects as the database owner — `postgres` in the default
 * compose file, a superuser. That is the thing being defended against: an
 * unsandboxed console on that connection is `COPY ... FROM PROGRAM`, which is a
 * shell on the database host.
 */

process.env.ADHOC_ENABLED = 'true';
// STATED, not inherited. `env.ts` loads `api/.env`, so a developer who has
// switched write mode on for their own machine would otherwise run this suite in
// the wrong mode — and its assertions are all about what read mode refuses, so
// they would fail with no hint that the mode was the reason.
process.env.ADHOC_WRITE_ENABLED = 'false';

process.env.ADHOC_DB_PASSWORD = 'adhoc-test-password';
// Short, so the timeout case does not spend ten seconds proving itself.
process.env.ADHOC_TIMEOUT_MS = '1500';
process.env.ADHOC_MAX_ROWS = '5';

const database = await openTestDatabase({ id: 'adhoc' });

let adhoc: typeof import('./adhoc.service.js');

/** Runs `sql` and returns the error message, failing if it somehow succeeded. */
async function refused(sql: string, why: string): Promise<string> {
  try {
    await adhoc.runAdhocQuery(sql);
  } catch (error) {
    return (error as Error).message;
  }
  return assert.fail(`the console allowed "${sql.slice(0, 60)}" — ${why}`);
}

describe('ad hoc query console', { skip: database.skip }, () => {
  before(async () => {
    adhoc = await import('./adhoc.service.js');
    const started = await adhoc.startAdhoc(database.pool!);
    // Not `skip`: if the sandbox cannot be built, the thing to do is fail loudly.
    // A console that silently did not start is the state this suite exists to
    // distinguish from one that started unsafely.
    assert.equal(started, true, 'the console refused to start; its safety checks did not pass');

    await database.pool!.query(
      `INSERT INTO alerts (sensor_id, kind, severity, title, description, dedup_key, first_seen, last_seen)
       SELECT 'adhoc', 'port_scan', 'low', 'seed ' || n, 'seed', 'adhoc-seed-' || n, now(), now()
         FROM generate_series(1, 20) AS n`,
    );
    await database.pool!.query(
      `INSERT INTO users (email, password, role, lang_code, firstname)
       VALUES ('adhoc@example.test', 'hashed-secret-value', 'ADMIN', 'en', 'Ad')`,
    );
  });

  after(async () => {
    await adhoc.stopAdhoc();
    // The suite's password is committed in this file, so leaving the role able
    // to log in would leave the developer's cluster holding a credential anyone
    // reading the repository knows — and PUBLIC has CONNECT, so it would reach
    // their real database. A production shutdown must NOT do this (see
    // `stopAdhoc`); a test that owns the whole cluster should.
    await adhoc.revokeAdhocLogin(database.pool!);
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('reads what it is allowed to read', async () => {
    // The control: a console that refused everything would satisfy every
    // assertion below and be worthless.
    const result = await adhoc.runAdhocQuery('SELECT kind, severity FROM alerts ORDER BY id LIMIT 2');

    assert.deepEqual(
      result.columns.map((column) => column.name),
      ['kind', 'severity'],
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.truncated, false);
  });

  it('refuses to write, whatever the statement looks like', async () => {
    // Each of these is a different way of asking, and the role answers the same
    // way to all of them — which is the argument for enforcing in Postgres
    // rather than in a parser that would need to know all four shapes.
    for (const [sql, damage] of [
      [`UPDATE users SET role = 'ADMIN'`, 'privilege escalation'],
      ['DELETE FROM alerts', 'destroying the findings'],
      [
        `INSERT INTO alerts (sensor_id, kind, severity, title, description, dedup_key, first_seen, last_seen)
        VALUES ('adhoc', 'x', 'low', 'x', 'x', 'x', now(), now())`,
        'forging a finding',
      ],
      [
        `WITH forged AS (
          INSERT INTO known_devices (sensor_id, mac_address, first_seen, last_seen)
          VALUES ('adhoc', 'aa:bb:cc:dd:ee:ff', now(), now()) RETURNING *
        ) SELECT * FROM forged`,
        'a write hidden inside a CTE, which a "starts with SELECT" check would pass',
      ],
    ] as const) {
      await refused(sql, damage);
    }
  });

  it('refuses to disable the audit trail', async () => {
    // The specific attack the append-only trigger is defenceless against from a
    // superuser connection: switch the trigger off, rewrite history, switch it
    // back. V9's guarantee is only as good as the console's inability to do this.
    await refused(
      'ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_rewrite',
      'rewriting the audit trail',
    );
    await refused('DROP TABLE alerts', 'destroying the schema');
  });

  it('refuses to read the columns holding secrets', async () => {
    // Read-only is not enough on its own: these three are exfiltration, not
    // damage, and a console that could only SELECT would hand them over.
    const hash = await refused('SELECT password FROM users', 'password hashes are offline-crackable');
    assert.match(hash, /permission denied/i);

    await refused('SELECT email_password FROM delivery_settings', 'the SMTP password is in use');
    await refused(
      'SELECT webhook_url FROM delivery_settings',
      'a Slack/Teams webhook URL is a bearer credential',
    );

    // And `SELECT *` is refused rather than quietly returning the secret, which
    // is the whole reason the grant is column-level rather than table-level.
    await refused('SELECT * FROM users', 'SELECT * would include the password column');
  });

  it('still reads the non-secret columns of those same tables', async () => {
    // The other half: excluding a column must not cost the table.
    //
    // Filtered to this suite's own fixture rather than asserting a row COUNT.
    // Counting makes the test a hostage to how many rows the migrations happen
    // to seed — `users` is empty after V5 removes V2's accounts, but a future
    // migration seeding one would break an assertion that has nothing to do with
    // column grants.
    const result = await adhoc.runAdhocQuery(
      `SELECT email, role FROM users WHERE email = 'adhoc@example.test'`,
    );

    // Positional, matching `columns` — see `AdhocResult.rows`.
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], ['adhoc@example.test', 'ADMIN']);
  });

  it('keeps both columns when a query selects the same name twice', async () => {
    /*
     * The case object-keyed rows silently got wrong: a join whose two tables
     * both have `id`. Keyed by name, the second overwrites the first and the
     * grid shows the same value under both headers, with nothing indicating it.
     * A console is only worth having if what it prints is what the database
     * said.
     */
    const result = await adhoc.runAdhocQuery(
      `SELECT a.id, b.id FROM alerts a JOIN alerts b ON b.id = a.id ORDER BY a.id LIMIT 1`,
    );

    assert.equal(result.columns.length, 2, 'both columns must survive');
    assert.equal(result.rows[0]!.length, 2, 'the row lost a column to a name collision');
    assert.deepEqual(result.rows[0], [result.rows[0]![1], result.rows[0]![0]]);
  });

  it('refuses to reach outside the database', async () => {
    // `COPY ... FROM PROGRAM` is command execution on the database host, and
    // `pg_read_file` reads the server's filesystem. Both are superuser-only,
    // which is exactly why the boot check refuses to run as one.
    await refused(`COPY alerts FROM PROGRAM 'id'`, 'command execution on the database host');
    await refused(`SELECT pg_read_file('/etc/passwd')`, 'reading the database host filesystem');
  });

  it('stops a query that runs too long', async () => {
    const message = await refused('SELECT pg_sleep(10)', 'a slow query would hold a connection open');

    // The message has to say what to do about it: a bare "canceling statement"
    // reads as a malfunction rather than as a limit being applied.
    assert.match(message, /longer than 1500 ms|stopped/i);
  });

  it('caps the rows it returns, and says that it did', async () => {
    const result = await adhoc.runAdhocQuery('SELECT id FROM alerts ORDER BY id');

    assert.equal(result.rows.length, 5, 'the row cap was not applied');
    // Silently truncating would be worse than not capping: the operator would
    // read a partial answer as a complete one.
    assert.equal(result.truncated, true, 'the result was truncated without saying so');
  });

  it('does not truncate a result that fits', async () => {
    const result = await adhoc.runAdhocQuery('SELECT id FROM alerts ORDER BY id LIMIT 3');

    assert.equal(result.rows.length, 3);
    assert.equal(result.truncated, false, 'a complete result was reported as truncated');
  });

  it('rejects a second statement chained onto the first', async () => {
    // Belt to the role's braces. The role could do nothing with a second
    // statement anyway, which is why this is not the defence — but a console
    // that accepted `;` would at least be lying about what it ran.
    await refused('SELECT 1; SELECT 2', 'a chained statement');
  });

  it('refuses a query that is too long before it reaches the database', async () => {
    // `assertRunnable` is what the route calls before it writes to the audit
    // trail, so this bound is also what keeps the trail from carrying a
    // megabyte of rejected SQL.
    const message = await refused(`SELECT '${'x'.repeat(30_000)}'`, 'an over-long query');

    assert.match(message, /limited to/i);
  });

  it('carries a status the error handler will honour', async () => {
    // `AdhocError` has to extend `HttpError` or the handler falls through to its
    // 500 path — which in production replaces the message with "Internal server
    // error", switching off this feature's whole error design somewhere a
    // developer never sees it.
    const { HttpError } = await import('../middleware/error-handler.js');
    await assert.rejects(
      () => adhoc.runAdhocQuery('SELECT * FROM no_such_table'),
      (error: unknown) => error instanceof HttpError && (error as { status: number }).status === 400,
      'an ad hoc failure must carry a 4xx status, not fall through to the 500 path',
    );
  });

  it('explains a query instead of blaming its syntax', async () => {
    /*
     * `DECLARE … CURSOR FOR` takes a query, so an EXPLAIN wrapped in one came
     * back as `syntax error at or near "EXPLAIN"` — and this console passes
     * Postgres's message through verbatim, so the operator read a syntax error
     * about SQL that has none, with nothing pointing at the wrapper.
     *
     * The timing is what made it matter: an administrator reaches for EXPLAIN
     * exactly when a query has hit the timeout, and the console's own advice at
     * that moment is to narrow it.
     */
    const result = await adhoc.runAdhocQuery('EXPLAIN SELECT count(*) FROM alerts');

    assert.ok(result.rows.length > 0, 'EXPLAIN returned no plan');
    assert.match(String(result.rows[0]![0]), /Aggregate|Scan/i);
  });

  it('runs SHOW, which the cursor also cannot hold', async () => {
    const result = await adhoc.runAdhocQuery('SHOW statement_timeout');

    // And it ran inside the console's own transaction, so it reports the cage's
    // timeout rather than the server default — which is the proof that skipping
    // the cursor did not skip the rest.
    assert.equal(String(result.rows[0]![0]), '1500ms');
  });

  it('still refuses a write dressed up as something the cursor cannot wrap', async () => {
    // The unwrapped path must not become a way around the role. It is not the
    // wrapper that makes this safe, but worth pinning that skipping the wrapper
    // changes nothing.
    await refused('EXPLAIN DELETE FROM alerts', 'a write inside an EXPLAIN');
  });

  it('keeps the message Postgres gave, rather than hiding it', async () => {
    // An administrator debugging their own typo is the common case by a wide
    // margin, and "query failed" would send them guessing.
    const message = await refused('SELECT * FROM no_such_table', 'a nonexistent table');

    assert.match(message, /no_such_table/);
  });
});
