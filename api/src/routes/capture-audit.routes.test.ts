import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import express, { type Express } from 'express';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * What `POST /start` and `POST /stop` put in the audit trail, over real HTTP.
 *
 * `capture-lifecycle.test.ts` covers what the *service* records. This covers the
 * decision the route makes, which is a different thing and was wrong: the handler
 * carried a paragraph explaining that a `running` outcome must not be audited —
 * a retry after a slow response, a second administrator on the screen, a script
 * that starts idempotently — and then called `auditCaptureStarted`
 * unconditionally. `starting` throws its 409 above and `running` falls straight
 * through, so every idempotent retry filed a row claiming to have started a
 * capture it did not. Nothing failed, because no route-level test reached the
 * `running` outcome at all.
 *
 * **Driven through `createPacketRouter` with a stubbed capture**, not through the
 * registry singleton. `startCapture` needs a pcap handle on a real interface,
 * which CI does not have and a developer machine does not have reliably — and
 * what is under test here is not pcap, it is which of three outcomes the route
 * writes a row for. The stub is scripted per test and the assertions are against
 * `audit_events` in Postgres.
 */

const SECRET = 'capture-audit-routes-secret';

process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';
process.env.SENSOR_ID = 'capture-audit-sensor';

const database = await openTestDatabase({ id: 'captureauditroutes' });

let app: Express;
let server: Server;
let origin: string;
let signAccessToken: typeof import('../services/jwt.service.js').signAccessToken;
let token: string;

type StartOutcome = 'started' | 'starting' | 'running';
type StopResult = { interfaceName: string | null } | null;

/**
 * What the route is allowed to see of a capture.
 *
 * Deliberately the five members the two handlers touch and nothing else — a
 * fuller fake would be a second implementation of the service, and the next
 * person to change the real one would have two to keep in step.
 */
const stub = {
  scope: 'interface',
  startOutcome: 'started' as StartOutcome,
  stopResult: { interfaceName: 'eth0' } as StopResult,
  startCalls: [] as string[],
  startCapture: async (interfaceName: string) => {
    stub.startCalls.push(interfaceName);
    return stub.startOutcome;
  },
  stopCapture: async () => stub.stopResult,
  getStatus: () => ({ capturing: stub.startOutcome !== 'started', interfaceName: 'eth0' }),
};

const auditRows = async () =>
  (
    await database.pool!.query<{ action: string; subject: string | null; detail: Record<string, unknown> }>(
      "SELECT action, subject, detail FROM audit_events WHERE action LIKE 'capture.%' ORDER BY id",
    )
  ).rows;

const post = (path: string) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ interfaceName: 'eth0', snaplength: 65_535, timeout: 1000 }),
  });

describe('what a capture route records', { skip: database.skip }, () => {
  before(async () => {
    ({ signAccessToken } = await import('../services/jwt.service.js'));
    const { createPacketRouter } = await import('./packets.routes.js');
    const { PacketCaptureService } = await import('../services/packet-capture.service.js');

    app = express();
    app.use(express.json());
    app.use(
      '/api/packets',
      createPacketRouter(stub as unknown as InstanceType<typeof PacketCaptureService>, {
        requireIpFilter: false,
      }),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind a port');
    origin = `http://127.0.0.1:${address.port}`;

    const { rows } = await database.pool!.query<{ id: number }>(
      `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
       VALUES ('capture-admin@example.test', 'not-a-real-hash', 'ADMIN', 'en', 'Test', 'Admin')
       RETURNING id`,
    );
    token = signAccessToken({ sub: 'capture-admin@example.test', uid: rows[0]!.id, role: 'ADMIN' });
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  beforeEach(async () => {
    // `truncateAll` takes the append-only trigger down for the length of its own
    // statement, which is the one context where that is allowed — and it restores
    // the seeded rows, so the account is re-created below.
    await truncateAll(database.pool!);
    const { rows } = await database.pool!.query<{ id: number }>(
      `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
       VALUES ('capture-admin@example.test', 'not-a-real-hash', 'ADMIN', 'en', 'Test', 'Admin')
       RETURNING id`,
    );
    token = signAccessToken({ sub: 'capture-admin@example.test', uid: rows[0]!.id, role: 'ADMIN' });
    stub.startCalls.length = 0;
  });

  it('records a start that started something', async () => {
    stub.startOutcome = 'started';

    const response = await post('/api/packets/start');

    assert.equal(response.status, 200);
    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, 'capture.start');
    assert.equal(rows[0]!.subject, 'eth0');
    // The values as they were asked for, matching `capture_session` rather than
    // what `capture-limits.ts` clamps them to.
    assert.deepEqual(rows[0]!.detail, {
      scope: 'interface',
      snapshotLength: 65_535,
      timeoutMs: 1000,
      filterIp: null,
    });
  });

  it('records nothing for a start that found the capture already running', async () => {
    /*
     * The finding. `running` is answered 200 with the live status on purpose —
     * the caller has what it asked for — and the handler's own comment says a
     * trail recording these "would show a row of starts for one capture and give
     * an operator no way to tell which was the real one".
     */
    stub.startOutcome = 'running';

    const response = await post('/api/packets/start');

    assert.equal(response.status, 200, 'a start that reached a running capture is not an error');
    assert.deepEqual(await auditRows(), [], 'an idempotent retry was recorded as having started a capture');
  });

  it('records nothing for a start that lost a race, and says so with a 409', async () => {
    stub.startOutcome = 'starting';

    const response = await post('/api/packets/start');

    assert.equal(response.status, 409);
    assert.deepEqual(await auditRows(), []);
  });

  it('records a stop, naming the interface the stop itself reported', async () => {
    /*
     * From `stopCapture`'s return, not from a status read either side of it. The
     * route cannot work the interface out: `this.interfaceName` is set when a
     * capture opens and never cleared, so reading it before the stop yields the
     * previous capture's interface inside the start window and null on the first
     * one, and reading it after yields a concurrent start's.
     */
    stub.stopResult = { interfaceName: 'wlan3' };

    const response = await post('/api/packets/stop');

    assert.equal(response.status, 200);
    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, 'capture.stop');
    assert.equal(rows[0]!.subject, 'wlan3');
    assert.deepEqual(rows[0]!.detail, { scope: 'interface' });
  });

  it('records nothing for a stop that stopped nothing', async () => {
    // Pressing Stop on an idle screen. The route answers 200 with the status, as
    // it always did, and files nothing.
    stub.stopResult = null;

    const response = await post('/api/packets/stop');

    assert.equal(response.status, 200);
    assert.deepEqual(await auditRows(), []);
  });

  it('records a stop it cannot name rather than skipping it', async () => {
    // `wasCapturing` true with the session already detached — a second stop
    // entering behind the first. Something was stopped, so it is an event; the
    // subject is null because this call genuinely does not know which capture.
    stub.stopResult = { interfaceName: null };

    await post('/api/packets/stop');

    const rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, 'capture.stop');
    assert.equal(rows[0]!.subject, null);
  });
});
