import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase } from '../test/database.js';

/**
 * What `POST /api/notify/test` says about an email channel that cannot authenticate.
 *
 * The question this file exists for is not "does a test send work" — it is what the
 * operator is told when it does not, and specifically when *email* does not while
 * something else does. An incomplete OAuth2 mailbox never becomes a channel, so
 * `sendTest` cannot report on it: with a webhook also configured, the response was
 * `{delivered: n, attempted: n}` and read as a clean pass, having never attempted the
 * one channel the operator pressed the button to check.
 *
 * Real HTTP against the real router, for the same reason `auth-admission.test.ts`
 * uses it: the failure being guarded against is one of wiring — a helper that
 * computes the right answer and a route that does not reach it — and only the
 * assembled thing can show that.
 *
 * See the note in auth-admission.test.ts about setting these before the database is
 * opened: `env.ts` parses `process.env` once at module load.
 */
const SECRET = 'notify-test-send-secret-notify-test-send-secret';
process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';
// The environment layer wins over the row, so anything pinned here would make the
// settings this suite writes unreachable. Blanked rather than assumed absent.
process.env.SMTP_HOST = '';
process.env.SMTP_AUTH_METHOD = '';
process.env.NOTIFY_EMAIL_TO = '';
process.env.NOTIFY_EMAIL_FROM = '';
process.env.NOTIFY_WEBHOOK_URL = '';

const database = await openTestDatabase({ id: 'notify-test-send' });

let app: Express;
let server: Server;
let origin: string;
let signAccessToken: typeof import('../services/jwt.service.js').signAccessToken;
let adminToken: string;

interface TestSendResponse {
  message?: string;
  delivered?: number;
  attempted?: number;
  results?: Array<{ channel: string; ok: boolean; detail?: string }>;
}

/**
 * Writes the delivery row, reloads the cache and rebuilds the notifier.
 *
 * Both steps matter: the notifier reads its settings once at construction, so a row
 * that is loaded but not applied leaves the previous channels in place.
 */
async function configure(values: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(values);
  const assignments = columns.map((column, i) => `${column} = $${i + 1}`).join(', ');
  await database.pool!.query(
    `UPDATE delivery_settings SET ${assignments} WHERE id = 1`,
    Object.values(values),
  );

  const { loadDeliverySettings } = await import('../notify/settings.service.js');
  const { reloadNotifier } = await import('../notify/notifier.js');
  await loadDeliverySettings();
  await reloadNotifier();
}

const testSend = async (): Promise<{ status: number; body: TestSendResponse }> => {
  const response = await fetch(`${origin}/api/notify/test`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return { status: response.status, body: (await response.json()) as TestSendResponse };
};

describe('the test send, when email cannot authenticate', { skip: database.skip }, () => {
  before(async () => {
    ({ signAccessToken } = await import('../services/jwt.service.js'));
    const { rows } = await database.pool!.query<{ id: number }>(
      `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
       VALUES ('delivery-admin@example.test', 'not-a-real-hash', 'ADMIN', 'en', 'Test', 'Admin')
       RETURNING id`,
    );
    adminToken = signAccessToken({ sub: 'delivery-admin@example.test', uid: rows[0]!.id, role: 'ADMIN' });

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

  it('names the unset OAuth2 settings even when another channel delivers', async () => {
    /*
     * The finding this test is for. Email is pointed at a mailbox and set to OAuth2
     * without a refresh token, and a webhook is configured alongside it — the common
     * case, since email is usually the second channel. Before, the incomplete email
     * channel was simply absent from the results and the response read as a pass.
     *
     * The webhook points at a closed port so nothing leaves the machine; whether it
     * succeeds is beside the point, which is that email appears at all.
     */
    await configure({
      webhook_url: 'http://127.0.0.1:1/hook',
      email_host: 'smtp.office365.com',
      email_from: 'nmt@contoso.test',
      email_to: ['soc@contoso.test'],
      email_auth_method: 'oauth2',
      email_user: 'nmt@contoso.test',
      email_oauth_client_id: 'client-id',
      email_oauth_client_secret: 'client-secret',
      email_oauth_token_url: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
      email_oauth_refresh_token: null,
    });

    const { body } = await testSend();

    const email = body.results?.find((result) => result.channel === 'email');
    assert.ok(email, 'email must appear in the results, not be silently left out');
    assert.equal(email.ok, false);
    assert.match(email.detail ?? '', /SMTP_OAUTH_REFRESH_TOKEN/);
    // And it counts as attempted, so `delivered` cannot equal `attempted` while a
    // channel the operator is asking about was never tried.
    assert.ok((body.attempted ?? 0) >= 2, 'the skipped channel must be counted');
  });

  it('says nothing about OAuth2 once the mailbox is complete', async () => {
    /*
     * Everything points at a closed local port on purpose. The channel is now real,
     * so the request leaves the process — and left pointed at smtp.office365.com and
     * login.microsoftonline.com this case sat for two minutes waiting on timeouts it
     * was never going to beat, in a suite that says nothing about whether Microsoft
     * is reachable. What is being asserted is which *message* comes back: a
     * connection failure, not "you have not finished filling this in".
     */
    await configure({
      email_host: '127.0.0.1',
      email_port: 1,
      email_oauth_token_url: 'https://127.0.0.1:1/token',
      email_oauth_refresh_token: 'refresh-token',
    });

    const { body } = await testSend();

    const email = body.results?.find((result) => result.channel === 'email');
    assert.ok(email, 'a complete mailbox is a real channel and must be attempted');
    assert.doesNotMatch(email.detail ?? '', /SMTP_OAUTH_REFRESH_TOKEN/);
  });

  it('tells a blank install what it actually needs, not to fill in a refresh token', async () => {
    /*
     * The ordering finding. `emailAuthMethod` can be oauth2 on an install with no
     * host, no sender and no recipients — set in the environment, or left behind by
     * an earlier attempt — and the OAuth2 message would win and send that operator
     * to fill in credentials for a mailbox that does not exist.
     */
    await configure({
      webhook_url: null,
      email_host: null,
      email_from: null,
      email_to: null,
      email_auth_method: 'oauth2',
      email_user: null,
      email_oauth_client_id: null,
      email_oauth_client_secret: null,
      email_oauth_token_url: null,
      email_oauth_refresh_token: null,
    });

    const { status, body } = await testSend();

    assert.equal(status, 400);
    assert.match(body.message ?? '', /SMTP host with recipients/);
    assert.doesNotMatch(body.message ?? '', /SMTP_OAUTH/);
  });
});
