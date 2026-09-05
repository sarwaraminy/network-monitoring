import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * What the console says when it is out of connections.
 *
 * A separate file because it needs a statement timeout LONGER than the pool's
 * five-second connect timeout, and the main ad hoc suite deliberately runs a
 * short one so its timeout case does not cost ten seconds. With those two the
 * other way round — which is the shipped default, ten against five — a query can
 * still be running when the next caller gives up waiting for a connection, and
 * that is the path under test.
 *
 * It is a routine path, not an edge: the pool holds two connections and the
 * console's whole purpose is queries slow enough to be worth asking about, so
 * "two in flight and a third arriving" is an ordinary afternoon.
 *
 * What it proves is narrow and specific: a pool acquisition failure is a plain
 * `pg` Error rather than a Postgres one, so with the `connect()` outside the
 * service's `try` it escaped unmapped and `errorHandler` answered 500 "Internal
 * server error" — the generic-500 problem `AdhocError extends HttpError` exists
 * to end. This is the second time that connect has had to move inside; a test is
 * what stops there being a third.
 */

process.env.ADHOC_ENABLED = 'true';
process.env.ADHOC_DB_PASSWORD = 'adhoc-busy-test-password';
// Longer than the pool's 5s connect timeout, so a waiting caller gives up first.
process.env.ADHOC_TIMEOUT_MS = '20000';

const database = await openTestDatabase({ id: 'adhocbusy' });

let adhoc: typeof import('./adhoc.service.js');

describe('ad hoc console under load', { skip: database.skip }, () => {
  before(async () => {
    adhoc = await import('./adhoc.service.js');
    assert.equal(await adhoc.startAdhoc(database.pool!), true, 'the console refused to start');
  });

  after(async () => {
    await adhoc.stopAdhoc();
    await adhoc.revokeAdhocLogin(database.pool!);
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('reports a busy console rather than a server error', async () => {
    const { HttpError } = await import('../middleware/error-handler.js');

    // Two connections is the whole pool, held for longer than the third caller
    // will wait.
    const holding = [
      adhoc.runAdhocQuery('SELECT pg_sleep(7)').catch(() => undefined),
      adhoc.runAdhocQuery('SELECT pg_sleep(7)').catch(() => undefined),
    ];
    // Let both actually take their connections before the third asks.
    await new Promise((resolve) => setTimeout(resolve, 300));

    await assert.rejects(
      () => adhoc.runAdhocQuery('SELECT 1'),
      (error: unknown) =>
        error instanceof HttpError &&
        (error as { status: number }).status === 503 &&
        /busy/i.test((error as Error).message),
      'pool exhaustion must arrive as an AdhocError an operator can read, not a 500',
    );

    await Promise.all(holding);
  });
});
