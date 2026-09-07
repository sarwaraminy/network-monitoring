import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * The query console's settings, over HTTP, against a real database.
 *
 * The resolver's own tests cover which of the three layers wins. What only a
 * request can answer is what crosses the wire and what the row and the trail end
 * up holding:
 *
 *  - the password is never in the response, however the console is configured
 *  - a pinned field earns a 409 that names the ENVIRONMENT VARIABLE, which is
 *    what an operator can grep for, rather than the internal field key
 *  - the audit entry names the fields that changed, so "who turned the SQL
 *    console on" is answerable afterwards
 *  - `null` clears a field rather than storing a zero
 *
 * Worth stating why the pinned case is tested here as well as in the form: the
 * form disables the control, but a variable can be added to the environment and
 * the API restarted while somebody has the page open. The server refusing is the
 * only thing standing between that and a stored value the environment then
 * silently overrides.
 */

const SECRET = 'adhoc-settings-suite-secret';

/*
 * Set before the database is opened, for the reason `auth-admission.test.ts`
 * gives at length: `openTestDatabase` pulls in the config chain and `env.ts`
 * parses `process.env` once at module load, so a hook setting these would run
 * after they had been read.
 *
 * Every ADHOC_* variable is cleared, deliberately. A developer with
 * `ADHOC_ENABLED` in `api/.env` would otherwise have half these fields pinned
 * and the assertions below would be about their machine — and the failure would
 * look like a bug in the resolver rather than a leaked environment.
 */
process.env.JWT_SECRET = SECRET;
process.env.NODE_ENV = 'test';
for (const name of [
  'ADHOC_ENABLED',
  'ADHOC_WRITE_ENABLED',
  'ADHOC_TIMEOUT_MS',
  'ADHOC_MAX_ROWS',
  'ADHOC_MAX_QUERY_LENGTH',
  'ADHOC_AUDIT',
]) {
  delete process.env[name];
}
/*
 * A password, so `passwordConfigured` is true and the leak assertion has
 * something to leak. The console still cannot start: nothing has provisioned the
 * role in a test database, and `startAdhoc` refuses unless Postgres confirms the
 * role is sandboxed. That is the point — these endpoints have to work while the
 * console is off, which is when an administrator is trying to turn it on.
 */
const PASSWORD = 'not-a-real-console-password-9F3a';
process.env.ADHOC_DB_PASSWORD = PASSWORD;

const database = await openTestDatabase({ id: 'adhoc-settings' });

let app: Express;
let server: Server;
let origin: string;
let signAccessToken: typeof import('../services/jwt.service.js').signAccessToken;
let loadAdhocSettings: typeof import('../services/adhoc-settings.service.js').loadAdhocSettings;

const SETTINGS = '/api/adhoc/settings';

interface SettingsBody {
  settings: Record<string, { value: unknown; source: string; env: string }>;
  passwordConfigured: boolean;
  effective: Record<string, unknown>;
}

async function seedAdmin(email: string): Promise<string> {
  const { rows } = await database.pool!.query<{ id: number }>(
    `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
     VALUES ($1, 'not-a-real-hash', 'ADMIN', 'en', 'Test', 'Admin')
     RETURNING id`,
    [email],
  );
  return signAccessToken({ sub: email, uid: rows[0]!.id, role: 'ADMIN' });
}

const authorised = (token: string) => ({ authorization: `Bearer ${token}` });

async function get(token: string): Promise<SettingsBody> {
  const response = await fetch(`${origin}${SETTINGS}`, { headers: authorised(token) });
  // Read once. A response body is single-use, and an assertion message is
  // evaluated eagerly — so passing `await response.text()` as the message
  // consumed it before it could be parsed, turning any failure here into a
  // confusing "Body is unusable" instead of the status that was wrong.
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as SettingsBody;
}

/** Asserts 200 and surfaces the body when it is not, without consuming it twice. */
async function expectOk(response: Response, what: string): Promise<void> {
  const text = await response.text();
  assert.equal(response.status, 200, `${what}: ${text}`);
}

async function put(token: string, patch: Record<string, unknown>): Promise<Response> {
  return fetch(`${origin}${SETTINGS}`, {
    method: 'PUT',
    headers: { ...authorised(token), 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

describe('the query console settings endpoints', { skip: database.skip }, () => {
  before(async () => {
    ({ signAccessToken } = await import('../services/jwt.service.js'));
    ({ loadAdhocSettings } = await import('../services/adhoc-settings.service.js'));
    const { createApp } = await import('../app.js');

    app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind a port');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
    // The service caches the row, and `truncateAll` has just removed it — so
    // without this the cache would still describe the previous test's settings
    // and each case would depend on the order they ran in.
    await loadAdhocSettings();
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('never returns the console password', async () => {
    /*
     * The assertion worth having even though nothing in the handler puts it
     * there. `ADHOC_DB_PASSWORD` is the credential this whole design keeps in the
     * environment, and the obvious way to break that is not malice — it is
     * somebody adding it to `ADHOC_FIELDS` so the page can show it, at which
     * point it is in a response body, in the browser's memory, and in whatever
     * logs the patch.
     */
    const token = await seedAdmin('reads-settings@example.test');

    const response = await fetch(`${origin}${SETTINGS}`, { headers: authorised(token) });
    const text = await response.text();

    assert.equal(response.status, 200, text);
    assert.ok(!text.includes(PASSWORD), 'the console password appeared in the settings response');
    // Whether one is set is reported, because the form has to explain why
    // turning the console on changed nothing.
    assert.equal((JSON.parse(text) as SettingsBody).passwordConfigured, true);
  });

  it('reports where each value came from', async () => {
    // Provenance is part of the contract rather than decoration: it is what the
    // form disables a control on.
    const token = await seedAdmin('reads-provenance@example.test');

    const body = await get(token);

    assert.equal(body.settings.enabled?.source, 'default');
    assert.equal(body.settings.enabled?.value, false);
    assert.equal(body.settings.enabled?.env, 'ADHOC_ENABLED');
  });

  it('stores a change, and reports it as coming from the database', async () => {
    const token = await seedAdmin('writes-settings@example.test');

    await expectOk(await put(token, { maxRows: 25 }), 'storing maxRows');

    const body = await get(token);
    assert.equal(body.settings.maxRows?.value, 25);
    assert.equal(body.settings.maxRows?.source, 'database');
    assert.equal(body.effective.maxRows, 25);
  });

  it('clears a field with null rather than storing a zero', async () => {
    // `null` means "stop deciding this here", so the environment or the default
    // takes over again. Storing 0 would be a row the database's CHECK refuses,
    // and if it did not, a row cap of zero.
    const token = await seedAdmin('clears-settings@example.test');

    await put(token, { maxRows: 25 });
    await expectOk(await put(token, { maxRows: null }), 'clearing maxRows');

    const body = await get(token);
    assert.equal(body.settings.maxRows?.value, 1000);
    assert.equal(body.settings.maxRows?.source, 'default');
  });

  it('records which fields changed in the audit trail', async () => {
    /*
     * "Who turned the SQL console on" has to be answerable, and this is the only
     * place it is written down. Field names and their new values: none of these
     * is a credential, and a trail saying merely "the console settings changed"
     * would be worth nothing for the one setting that decides whether a browser
     * can run SQL against production.
     */
    const token = await seedAdmin('audited@example.test');

    await put(token, { enabled: true, maxRows: 25 });

    const { rows } = await database.pool!.query<{ action: string; actor: string; detail: unknown }>(
      "SELECT action, actor, detail FROM audit_events WHERE action = 'adhoc_settings.update'",
    );

    assert.equal(rows.length, 1, 'the change was not recorded');
    assert.equal(rows[0]!.actor, 'audited@example.test');
    assert.deepEqual(rows[0]!.detail, { changed: { enabled: true, maxRows: 25 } });
  });

  it('refuses a value the database would not accept, without storing it', async () => {
    // The bounds are V14's CHECK constraints, validated before the write so the
    // failure is a 400 naming the field rather than a 500 from Postgres.
    const token = await seedAdmin('out-of-bounds@example.test');

    const response = await put(token, { maxRows: 999_999 });

    assert.equal(response.status, 400);
    const body = await get(token);
    assert.equal(body.settings.maxRows?.source, 'default');
  });

  it('refuses an unknown field rather than ignoring it', async () => {
    // `.strict()` on the schema. A typo silently accepted is a setting somebody
    // believes they changed.
    const token = await seedAdmin('unknown-field@example.test');

    const response = await put(token, { maxRowz: 25 });

    assert.equal(response.status, 400);
  });

  /**
   * The same endpoints with a variable set — the case the form cannot fully
   * cover on its own.
   *
   * Nested rather than a second top-level suite: the outer `after` ends the
   * pool, and node:test runs top-level suites in sequence, so a sibling would
   * have started against a closed one.
   */
  describe('a field the environment has pinned', () => {
    let pinnedToken: string;

    before(async () => {
      /*
       * Set here, unlike the variables at the top of this file. The resolver
       * reads `process.env` at each resolve (`adhocEnvironmentSource`) rather
       * than a value frozen at import, which is what makes a change visible
       * without a restart in the first place — so this takes effect, and the
       * first assertion below checks that it did rather than assuming it.
       */
      process.env.ADHOC_MAX_ROWS = '250';
      await loadAdhocSettings();
    });

    /*
     * Per test, not once. The outer `beforeEach` truncates every table — which
     * includes `users` — so an account seeded in this suite's `before` was gone
     * by the time the first request used it, and `requireAuth` answered 401
     * "Account no longer exists". Correct behaviour from the guard, and the right
     * shape of bug to hit once: node:test runs the outer hook before the inner
     * one, so the seed has to be in the inner one.
     */
    beforeEach(async () => {
      pinnedToken = await seedAdmin('pinned@example.test');
    });

    after(async () => {
      delete process.env.ADHOC_MAX_ROWS;
      await loadAdhocSettings();
    });

    it('reports it as pinned, naming the variable', async () => {
      const body = await get(pinnedToken);

      assert.equal(body.settings.maxRows?.source, 'environment', 'the variable did not take effect');
      assert.equal(body.settings.maxRows?.value, 250);
    });

    it('refuses a change to it with 409, naming the variable rather than the field', async () => {
      /*
       * The variable is what somebody can grep for in a Compose file. Naming
       * `maxRows` instead — the mistake the delivery settings' own 409 made —
       * tells an operator which control was refused and nothing about where to
       * go and fix it.
       */
      const response = await put(pinnedToken, { maxRows: 25 });

      assert.equal(response.status, 409);
      const { message } = (await response.json()) as { message: string };
      assert.match(message, /ADHOC_MAX_ROWS/);
      assert.doesNotMatch(message, /maxRows/);
    });

    it('leaves the other fields writable', async () => {
      // A pin is per field, not per form.
      await expectOk(await put(pinnedToken, { maxQueryLength: 5000 }), 'an unpinned field');
    });
  });
});
