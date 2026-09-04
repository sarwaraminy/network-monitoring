import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase } from '../test/database.js';

/**
 * Every protected route, ADMITTED — the other half of `auth-rejection.test.ts`.
 *
 * That file fires seven bad credentials at every authenticated route and asserts
 * 401, and says plainly why the positive case is not there with it: "it would
 * need a real user row". This is that case, now that there is a database to put
 * one in.
 *
 * The question worth asking over HTTP rather than against the guard directly is
 * where the role comes FROM. `requireRole` reads `req.user.role`, and `req.user`
 * is the row `requireAuth` fetched by email — not the `role` claim inside the
 * token. Those two are trivial to conflate, they agree in every normal session,
 * and if they were ever swapped the tests that drive the guard with a fabricated
 * `req.user` would all still pass. So the case that matters is a correctly
 * signed token whose claims CLAIM admin over a database row that says otherwise:
 * a self-signed promotion, refused by the row.
 *
 *  - a valid USER token on an admin route      -> 403, not 401 and not 200
 *  - a token claiming ADMIN over a USER row    -> 403, because the row decides
 *  - a valid USER token on a shared route      -> admitted (not 401/403)
 *  - a valid token whose row has been deleted  -> 401
 *
 * The last is the reason `requireAuth` reads the row at all: revoking an account
 * has to take effect before the token expires, and nothing else in the suite
 * proves that a deleted user actually stops being able to act.
 */

const SECRET = 'auth-admission-suite-secret';
const ADMIN_ONLY = '/api/audit';
/** Authenticated, no role guard — see `route-guards.test.ts` for the table. */
const ANY_ROLE = '/api/alerts';

/*
 * Set BEFORE the database is opened, not in a hook.
 *
 * The top-level `openTestDatabase` below imports the config chain, and `env.ts`
 * parses `process.env` once at module load — so a hook setting these runs after
 * they have been read and changes nothing. That made the old comment here
 * exactly inverted: rate limiting was LIVE for this suite rather than disabled,
 * and it passed only because the request volume stayed under the backstop
 * limiter. Add cases and the assertions start being about the limiter. The
 * signing secret agreed with the verifying secret by coincidence of
 * configuration rather than by construction, too.
 */
process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';

const database = await openTestDatabase({ id: 'auth-admission' });

let app: Express;
let server: Server;
let origin: string;
let signAccessToken: typeof import('../services/jwt.service.js').signAccessToken;

/** Inserts a user and returns a token that correctly identifies them. */
async function seedUser(
  email: string,
  role: 'USER' | 'ADMIN',
  claimedRole = role,
): Promise<{ token: string; email: string }> {
  const { rows } = await database.pool!.query<{ id: number }>(
    `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
     VALUES ($1, $2, $3, 'en', 'Test', 'User')
     RETURNING id`,
    // Never verified on this path: `requireAuth` checks the token's signature,
    // not the stored hash. A recognisable non-hash is better than a real one,
    // which would read as though something here depended on it.
    [email, 'not-a-real-hash', role],
  );

  // `claimedRole` is what goes in the TOKEN, which is the whole point of the
  // escalation case below: it is allowed to disagree with the row.
  return { token: signAccessToken({ sub: email, uid: rows[0]!.id, role: claimedRole }), email };
}

const authorised = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('authenticated admission', { skip: database.skip }, () => {
  before(async () => {
    ({ signAccessToken } = await import('../services/jwt.service.js'));
    const { createApp } = await import('../app.js');

    // `createApp` mounts every router itself and finishes by installing the 404
    // handler, so mounting them again here registered them AFTER that handler,
    // where nothing can reach them. Every request below is served by the mounts
    // inside `createApp` — which is what this suite should be exercising anyway.
    app = createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind a port');
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await database.pool?.end();
    // The APPLICATION's pool too. `db/index.ts` does not set `allowExitOnIdle`,
    // so `pg-pool` keeps its idle clients referenced and the process lingers
    // until the 30s idle timeout — half a minute added to every run of every
    // database file, which node:test reports as nothing at all.
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('refuses a plain user an admin route with 403, not 401', async () => {
    const { token } = await seedUser('plain-user@example.test', 'USER');

    const response = await fetch(`${origin}${ADMIN_ONLY}`, authorised(token));

    // The distinction carries information: 401 says "we do not know who you
    // are", 403 says "we do, and you may not". Answering 401 to an authenticated
    // user would send them back to a login screen that cannot help them.
    assert.equal(response.status, 403, `${ADMIN_ONLY} should refuse a USER with 403`);
  });

  it('refuses a token that claims a role its account does not have', async () => {
    // A correctly signed token — the holder's own — carrying `role: ADMIN` over
    // a row that says USER. If the guard ever read the claim instead of the row,
    // anyone able to obtain a token could promote themselves by editing what
    // they ask for, and every test that fabricates `req.user` would stay green.
    const { token } = await seedUser('self-promoted@example.test', 'USER', 'ADMIN');

    const response = await fetch(`${origin}${ADMIN_ONLY}`, authorised(token));

    assert.equal(response.status, 403, 'the database row must decide the role, not the token claim');
  });

  it('admits a plain user to a route their role allows', async () => {
    // The other direction, and the reason this file exists: a suite that only
    // ever asserts refusal would pass with authentication refusing everybody.
    const { token } = await seedUser('allowed-user@example.test', 'USER');

    const response = await fetch(`${origin}${ANY_ROLE}`, authorised(token));

    assert.notEqual(response.status, 401, 'a valid token was refused as unauthenticated');
    assert.notEqual(response.status, 403, 'a shared route refused a USER');
  });

  it('admits an administrator to the admin route', async () => {
    const { token } = await seedUser('real-admin@example.test', 'ADMIN');

    const response = await fetch(`${origin}${ADMIN_ONLY}`, authorised(token));

    assert.equal(response.status, 200, `${ADMIN_ONLY} refused a genuine ADMIN`);
  });

  it('stops accepting a token once its account is gone', async () => {
    // Why `requireAuth` reads the row at all rather than trusting the claims:
    // revoking an account has to take effect before the token expires.
    const { token, email } = await seedUser('deleted-user@example.test', 'ADMIN');
    assert.equal((await fetch(`${origin}${ADMIN_ONLY}`, authorised(token))).status, 200);

    await database.pool!.query('DELETE FROM users WHERE email = $1', [email]);

    const response = await fetch(`${origin}${ADMIN_ONLY}`, authorised(token));
    assert.equal(response.status, 401, 'a token outlived the account it names');
  });
});
