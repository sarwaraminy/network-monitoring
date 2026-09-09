import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase } from '../test/database.js';

/**
 * Who gets to know which administrator started a capture.
 *
 * `GET /api/packets/status` sits behind `requireAuth`, not `requireRole('ADMIN')`
 * — that gate covers `/start`, `/stop` and `/clear` only, deliberately, because a
 * USER watching a capture is the ordinary case. Adding `interrupted` to the status
 * put an administrator's email address on that response, so any authenticated
 * account polling it learned who had started the capture.
 *
 * Two routes above, `GET /` already strips packet payloads for a non-admin. Same
 * class, same shape, and the pattern was adjacent to the change that broke it.
 *
 * The rest of the notice stays visible to everyone on purpose. "Monitoring
 * stopped unexpectedly" is the point of the feature and is not privileged;
 * only the name is.
 *
 * Driven over real HTTP with real tokens rather than against the handler, because
 * what is under test is what leaves the process.
 */

const SECRET = 'capture-status-privacy-secret';
const STATUS = '/api/packets/status';

process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';
process.env.SENSOR_ID = 'privacy-sensor';

const database = await openTestDatabase({ id: 'capturestatusprivacy' });

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
  interrupted: { interfaceName: string; startedAt: string; startedBy?: string } | null;
}

describe('what the capture status tells a non-admin', { skip: database.skip }, () => {
  before(async () => {
    ({ signAccessToken } = await import('../services/jwt.service.js'));
    const { createApp } = await import('../app.js');
    app = createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind a port');
    origin = `http://127.0.0.1:${address.port}`;

    // An interrupted session for this sensor, as a previous process would have
    // left it: started, never stopped.
    const sessions = await import('../services/capture-session.service.js');
    await sessions.recordCaptureStarted('interface', {
      interfaceName: 'eth0',
      snapshotLength: 65_535,
      timeoutMs: 1000,
      filterIp: null,
      startedAt: new Date('2026-09-09T03:14:00.000Z'),
      startedBy: 'admin@example.test',
    });

    const { interfaceCapture } = await import('../services/packet-capture.registry.js');
    await interfaceCapture.reportInterruptedCapture();
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('tells an administrator whose capture it was', async () => {
    const token = await seedUser('the-admin@example.test', 'ADMIN');
    const response = await fetch(`${origin}${STATUS}`, authorised(token));
    const body = (await response.json()) as StatusBody;

    assert.equal(response.status, 200);
    assert.equal(body.interrupted?.startedBy, 'admin@example.test');
  });

  it('does not tell a plain user', async () => {
    const token = await seedUser('plain-user@example.test', 'USER');
    const response = await fetch(`${origin}${STATUS}`, authorised(token));
    const body = (await response.json()) as StatusBody;

    assert.equal(response.status, 200);
    assert.equal(
      body.interrupted?.startedBy,
      undefined,
      'a USER polling status learned which administrator started the capture',
    );
  });

  it('still tells a plain user that monitoring stopped', async () => {
    // The half that is not privileged, and the reason the whole notice is not
    // simply withheld: a USER seeing the capture screen needs to know it is not
    // running, and why.
    const token = await seedUser('another-user@example.test', 'USER');
    const body = (await (await fetch(`${origin}${STATUS}`, authorised(token))).json()) as StatusBody;

    assert.equal(body.interrupted?.interfaceName, 'eth0');
    assert.equal(body.interrupted?.startedAt, '2026-09-09T03:14:00.000Z');
  });
});
