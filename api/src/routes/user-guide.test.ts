import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase } from '../test/database.js';

/**
 * The user guide is not readable by somebody who has not signed in.
 *
 * This is the whole reason the guide is served by the application at all. It
 * would have been less work to drop it in the UI's `public/` directory and let
 * nginx hand it out — and that is exactly what makes it worth a test: the failure
 * mode is silent. Nothing breaks, no error is logged, and the documentation for a
 * security tool (its detectors, its roles, the shape of its deployment) is simply
 * public. A test that fetches without a cookie is the only thing that notices.
 *
 * Both halves are asserted, because a gate that refuses everybody is as broken as
 * one that admits everybody, and only the first half fails loudly in normal use.
 *
 * See auth-admission.test.ts on setting these before the database is opened.
 */
const SECRET = 'user-guide-gate-secret-user-guide-gate-secret';
process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';

const database = await openTestDatabase({ id: 'user-guide' });

let app: Express;
let server: Server;
let origin: string;
let token: string;

/** The guide's own session cookie, as the browser would send it back. */
async function mintGuideCookie(): Promise<string> {
  const response = await fetch(`${origin}/api/user-guide/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 204, 'minting the guide session should succeed');

  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'a guide session must arrive as a cookie');
  return setCookie.split(';')[0]!;
}

describe('the user guide gate', { skip: database.skip }, () => {
  before(async () => {
    const { signAccessToken } = await import('../services/jwt.service.js');
    const { rows } = await database.pool!.query<{ id: number }>(
      `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
       VALUES ('reader@example.test', 'not-a-real-hash', 'USER', 'en', 'Test', 'Reader')
       RETURNING id`,
    );
    token = signAccessToken({ sub: 'reader@example.test', uid: rows[0]!.id, role: 'USER' });

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

  it('sends an anonymous reader to sign in rather than serving the guide', async () => {
    const response = await fetch(`${origin}/user-guide/index.html`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
    // And no page leaked in the body of the redirect.
    assert.doesNotMatch(await response.text(), /Network Monitoring User Guide/);
  });

  it('refuses the assets too, not just the page', async () => {
    /*
     * The gate has to cover every file. A stylesheet is uninteresting, but the
     * screenshots are not: they show a real dashboard, the delivery configuration
     * and the shape of the alerts table. Gating the HTML alone would leave those
     * readable by anybody who guessed a filename.
     */
    for (const asset of ['/user-guide/assets/guide.css', '/user-guide/screenshots/alerts.png']) {
      const response = await fetch(`${origin}${asset}`, { redirect: 'manual' });
      assert.equal(response.status, 401, `${asset} must not be served anonymously`);
    }
  });

  it('refuses a forged cookie', async () => {
    // Presence is not validity: the value is signed, and this one is not.
    const response = await fetch(`${origin}/user-guide/index.html`, {
      headers: { accept: 'text/html', cookie: 'nmt_guide_session=not-a-real-session' },
      redirect: 'manual',
    });

    assert.equal(response.status, 302);
  });

  it('refuses an access token presented as a guide session', async () => {
    /*
     * The two credentials grant different things and must not be interchangeable.
     * This direction is the one that matters less on its own — an access token
     * already opens more than the guide — but the same `purpose` claim is what
     * stops a *guide* cookie being replayed as a Bearer token, and one test
     * proves the claim is actually being checked.
     */
    const response = await fetch(`${origin}/user-guide/index.html`, {
      headers: { accept: 'text/html', cookie: `nmt_guide_session=${token}` },
      redirect: 'manual',
    });

    assert.equal(response.status, 302);
  });

  it('serves the guide to a signed-in reader', async () => {
    const cookie = await mintGuideCookie();

    const page = await fetch(`${origin}/user-guide/index.html`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Network Monitoring User Guide/);

    // A topic and an asset, so the whole tree is reachable and not just the entry.
    const topic = await fetch(`${origin}/user-guide/topics/access-and-roles.html`, { headers: { cookie } });
    assert.equal(topic.status, 200);

    const css = await fetch(`${origin}/user-guide/assets/guide.css`, { headers: { cookie } });
    assert.equal(css.status, 200);
  });

  it('stops serving it once the session is cleared', async () => {
    // What signing out does. The cookie is the only thing standing between the
    // two states, so its removal has to be enough.
    const cookie = await mintGuideCookie();
    assert.equal((await fetch(`${origin}/user-guide/index.html`, { headers: { cookie } })).status, 200);

    const cleared = await fetch(`${origin}/api/user-guide/session`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(cleared.status, 204);

    // The browser drops the cookie on that response; a request without it is
    // what the next navigation looks like.
    const after = await fetch(`${origin}/user-guide/index.html`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    assert.equal(after.status, 302);
  });

  it('will not walk out of the guide directory', async () => {
    // `express.static` resolves this itself; asserted because the consequence of
    // it ever not doing so is reading arbitrary files off the server.
    const response = await fetch(`${origin}/user-guide/../package.json`, {
      headers: { cookie: await mintGuideCookie() },
      redirect: 'manual',
    });

    assert.notEqual(response.status, 200);
  });
});
