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

    /*
     * Asserted on the header, because the header is the entire mechanism.
     *
     * The guide session is a stateless JWT with no server-side revocation —
     * `isValidGuideSession` checks signature, algorithm and expiry and nothing
     * else — so `Set-Cookie` with a past expiry is the only way signing out ends
     * guide access. The first version of this test fetched the page with no
     * cookie and asserted a 302, which is what the first test in this file
     * already proves: deleting `res.clearCookie(...)` outright left it green.
     */
    const setCookie = cleared.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /nmt_guide_session=/, 'the response did not clear the cookie');
    assert.match(setCookie, /Path=\/user-guide/, 'cleared at the wrong path, so the browser keeps it');
    // Either spelling of "immediately", both of which browsers honour.
    assert.match(setCookie, /Expires=Thu, 01 Jan 1970|Max-Age=0/, `the cookie was not expired: ${setCookie}`);

    // And the page is gone for a request that no longer carries it.
    const after = await fetch(`${origin}/user-guide/index.html`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    assert.equal(after.status, 302);
  });

  it('will not walk out of the guide directory', async () => {
    /*
     * Percent-encoded, because the plain form never leaves this process.
     *
     * `new URL('http://host/user-guide/../package.json').pathname` is
     * `/package.json` — the WHATWG parser resolves dot segments before the
     * request is sent, so the first version of this test asked for a path that
     * matches no route and got a 404 from the not-found handler. It would have
     * stayed green with the cookie gate removed, with `express.static`'s own
     * defence removed, or with `guideDirectory` pointed at the repository root.
     * `%2e%2e%2f` survives normalisation and is decoded after routing, which is
     * the request actually worth making.
     */
    const cookie = await mintGuideCookie();

    for (const attempt of [
      '/user-guide/%2e%2e%2f%2e%2e%2fpackage.json',
      '/user-guide/..%2f..%2fpackage.json',
      '/user-guide/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json',
    ]) {
      const response = await fetch(`${origin}${attempt}`, {
        headers: { cookie },
        redirect: 'manual',
      });

      assert.notEqual(response.status, 200, `${attempt} was served`);
      // And nothing that looks like the file it was reaching for.
      const body = await response.text();
      assert.doesNotMatch(body, /"name": "network-monitoring/, `${attempt} returned package.json`);
    }
  });

  it('never mints a cookie that outlives the token that asked for it', async () => {
    /*
     * The two credentials had independent lifetimes and nothing linking them, so
     * a dashboard left open past its access token's expiry kept a valid guide
     * cookie: the next request 401s, the sign-in screen renders, and
     * `/user-guide/*` goes on serving the whole guide — screenshots of a real
     * dashboard, the delivery configuration, the shape of the alerts table — to
     * whoever next sits down.
     *
     * Clearing it on the 401 cannot work, which is why the fix is a cap: the
     * clear endpoint needs the access token, and the token is what expired. The
     * cookie is scoped to `/user-guide`, so the browser never sends it to
     * `/api/user-guide/session` either — it cannot authenticate its own removal.
     */
    const jwt = (await import('jsonwebtoken')).default;
    const shortLived = jwt.sign({ sub: 'reader@example.test', uid: 1, role: 'USER' }, SECRET, {
      algorithm: 'HS512',
      expiresIn: 90,
    });

    const minted = await fetch(`${origin}/api/user-guide/session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${shortLived}` },
    });
    assert.equal(minted.status, 204);

    const setCookie = minted.headers.get('set-cookie') ?? '';
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1] ?? Number.NaN);

    assert.ok(Number.isFinite(maxAge), `no Max-Age on the cookie: ${setCookie}`);
    assert.ok(maxAge <= 90, `the cookie outlives the token by ${maxAge - 90}s`);
    // And is not zero-length either, which would pass the line above while making
    // the guide unopenable.
    assert.ok(maxAge > 0, 'the cookie expired immediately');
  });

  it('does not tell the guide to upgrade its own assets to https', async () => {
    /*
     * The app-wide policy was written for a process that served JSON only, and
     * helmet's defaults turn that into a header carrying
     * `upgrade-insecure-requests`. Free until this router started serving pages;
     * after that, on the plain-HTTP stack Compose actually ships, the guide
     * document rewrote its own stylesheet, scripts and screenshots to `https://`
     * where nothing listens — an unstyled page with no images, and `guard.js`
     * never running, which is the layer whose absence is invisible.
     *
     * Chrome exempts `localhost`, so this failed on every install except the one
     * it was written on. Asserted on the header rather than on the rendering,
     * because that is what the browser acts on.
     */
    const response = await fetch(`${origin}/user-guide/index.html`, {
      headers: { cookie: await mintGuideCookie() },
    });

    const csp = response.headers.get('content-security-policy') ?? '';
    assert.doesNotMatch(csp, /upgrade-insecure-requests/, `the guide would upgrade its assets: ${csp}`);
    // And it still permits what the guide actually loads, all of it same-origin.
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /img-src 'self'/);
  });
});
