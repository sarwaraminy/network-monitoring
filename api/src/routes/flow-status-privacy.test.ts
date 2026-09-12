import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase } from '../test/database.js';

/**
 * Who gets to know which senders the flow collector will accept.
 *
 * `GET /api/flow/status` sits behind `requireAuth` rather than an admin gate,
 * deliberately: whether the collector is listening is not privileged, and the
 * operator watching the network is usually not the administrator. Reporting
 * `allowedExporters` beside the refusal count put the allowlist on that
 * response — and the allowlist is the collector's *only* access control, because
 * NetFlow authenticates nothing at all. Reachability plus that list is the whole
 * of it.
 *
 * So the addresses answer a precise question for anyone who can sign in: what
 * would I have to spoof for forged flow records to be accepted and turned into
 * findings? The bind address in the same response completes it.
 *
 * The count stays, because the refusals have to remain legible — "7 refused, 2
 * senders permitted" is still a diagnosis — and comparing a device's address
 * against the list is an administrator's step anyway, since only an
 * administrator can change it.
 *
 * The same shape `GET /api/packets/status` uses for `interrupted.startedBy` and
 * `GET /api/packets` for frame payloads: the response stays open, one field
 * inside it does not. Driven over real HTTP with real tokens, because what is
 * under test is what leaves the process.
 */

const SECRET = 'flow-status-privacy-secret';
const STATUS = '/api/flow/status';
const SETTINGS = '/api/flow/settings';

process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';
process.env.SENSOR_ID = 'flow-privacy-sensor';
process.env.FLOW_EXPORTERS = '10.0.0.1,10.0.0.2';

const database = await openTestDatabase({ id: 'flowstatusprivacy' });

let app: Express;
let server: Server;
let origin: string;
let signAccessToken: typeof import('../services/jwt.service.js').signAccessToken;

async function seedUser(email: string, role: 'USER' | 'ADMIN'): Promise<string> {
  const { rows } = await database.pool!.query<{ id: number }>(
    `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
     VALUES ($1, 'not-a-real-hash', $2, 'en', 'Test', 'User')
     RETURNING id`,
    [email, role],
  );
  return signAccessToken({ sub: email, uid: rows[0]!.id, role });
}

const authorised = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

interface StatusBody {
  listening: boolean;
  allowedExporterCount: number;
  allowedExporters?: string[];
}

describe('what the flow status tells a non-admin', { skip: database.skip }, () => {
  before(async () => {
    ({ signAccessToken } = await import('../services/jwt.service.js'));
    const { loadFlowSettings } = await import('../services/flow-settings.service.js');
    await loadFlowSettings();

    const { createApp } = await import('../app.js');
    app = createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind a port');
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('tells an administrator which senders are permitted', async () => {
    const token = await seedUser('flow-admin@example.test', 'ADMIN');
    const body = (await (await fetch(`${origin}${STATUS}`, authorised(token))).json()) as StatusBody;

    assert.deepEqual(body.allowedExporters, ['10.0.0.1', '10.0.0.2']);
    assert.equal(body.allowedExporterCount, 2);
  });

  it('does not tell a plain user', async () => {
    const token = await seedUser('flow-user@example.test', 'USER');
    const response = await fetch(`${origin}${STATUS}`, authorised(token));
    const body = (await response.json()) as StatusBody;

    assert.equal(response.status, 200);
    assert.equal(
      body.allowedExporters,
      undefined,
      'a USER polling status learned exactly which source addresses forge an accepted flow record',
    );
  });

  it('still tells a plain user how many there are', async () => {
    /*
     * The half that is not privileged, and the reason the field is not simply
     * withheld: "7 datagrams refused" with no idea whether the allowlist has two
     * entries or twenty is a number nobody can act on, and the refusal panel is
     * the one thing that explains a collector receiving and decoding nothing.
     */
    const token = await seedUser('flow-user-2@example.test', 'USER');
    const body = (await (await fetch(`${origin}${STATUS}`, authorised(token))).json()) as StatusBody;

    assert.equal(body.allowedExporterCount, 2);
    // And the rest of the status is untouched.
    assert.equal(typeof body.listening, 'boolean');
  });

  it('keeps the settings read for administrators', async () => {
    // The configuration, `FLOW_EXPORTERS` among it. Nothing but the form under
    // the administration gear reads this, and nobody else can open that.
    const admin = await seedUser('flow-admin-2@example.test', 'ADMIN');
    const user = await seedUser('flow-user-3@example.test', 'USER');

    assert.equal((await fetch(`${origin}${SETTINGS}`, authorised(admin))).status, 200);
    assert.equal((await fetch(`${origin}${SETTINGS}`, authorised(user))).status, 403);
  });
});
