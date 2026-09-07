import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Express } from 'express';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * Changing an account's role, over HTTP, against a real database.
 *
 * Role was previously settable only in `psql`, which is the gap this closes. It
 * is also the most dangerous thing in the administration panel, because every
 * failure mode is a lockout: demote the last administrator and the panel that
 * would undo it is behind the guard that just closed.
 *
 * So most of these are refusals, and the one worth the transaction is the race —
 * two administrators demoting each other at the same moment. A
 * count-then-update loses it: each reads two admins, each passes, both writes
 * land, and the installation has no administrator without either person doing
 * anything wrong. That case is asserted here rather than reasoned about, because
 * it cannot be reproduced by hand and would never be noticed until it happened.
 */

const SECRET = 'user-roles-suite-secret';

process.env.JWT_SECRET = SECRET;
/*
 * Before the database is opened, for the reason `auth-rejection.test.ts` records
 * at length: `rate-limit.ts` decides whether to skip once at module load, from
 * `env.nodeEnv`, and `openTestDatabase` pulls in the config chain. Set in a hook
 * it would be too late and this suite would run against a live limiter.
 */
process.env.NODE_ENV = 'test';

const database = await openTestDatabase({ id: 'user-roles' });

let app: Express;
let server: Server;
let origin: string;
let signAccessToken: typeof import('../services/jwt.service.js').signAccessToken;

interface Seeded {
  id: number;
  email: string;
  token: string;
}

async function seed(email: string, role: 'ADMIN' | 'USER'): Promise<Seeded> {
  const { rows } = await database.pool!.query<{ id: number }>(
    `INSERT INTO users (email, password, role, lang_code, firstname, lastname)
     VALUES ($1, 'not-a-real-hash', $2, 'en', 'Test', 'User')
     RETURNING id`,
    [email, role],
  );
  const id = rows[0]!.id;
  return { id, email, token: signAccessToken({ sub: email, uid: id, role }) };
}

/** PATCHes a role and hands back the status with the body, read once. */
async function setRole(
  actor: Seeded,
  targetId: number,
  role: 'ADMIN' | 'USER',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/auth/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const roleOf = async (id: number): Promise<string> => {
  const { rows } = await database.pool!.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]);
  return rows[0]?.role ?? 'gone';
};

describe('changing an account role', { skip: database.skip }, () => {
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
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('promotes an account, and records which way the role moved', async () => {
    const admin = await seed('admin@example.test', 'ADMIN');
    const target = await seed('promote-me@example.test', 'USER');

    const { status, body } = await setRole(admin, target.id, 'ADMIN');

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.role, 'ADMIN');
    assert.equal(await roleOf(target.id), 'ADMIN');
    // Never the password hash, even though the row has one — `toPublicUser` is
    // what the Java version got wrong by serialising the whole entity.
    assert.ok(!('password' in body), `the response carried a password field: ${JSON.stringify(body)}`);

    const { rows } = await database.pool!.query<{ actor: string; subject: string; detail: unknown }>(
      "SELECT actor, subject, detail FROM audit_events WHERE action = 'user.role_change'",
    );
    assert.equal(rows.length, 1, 'the change was not recorded');
    assert.equal(rows[0]!.actor, 'admin@example.test');
    // By address, so the row stays legible after the account is deleted.
    assert.equal(rows[0]!.subject, 'promote-me@example.test');
    // Both directions: "changed a role" without them records nothing.
    assert.deepEqual(rows[0]!.detail, { from: 'USER', to: 'ADMIN' });
  });

  it('demotes an administrator while another one remains', async () => {
    const admin = await seed('stays@example.test', 'ADMIN');
    const other = await seed('goes@example.test', 'ADMIN');

    const { status, body } = await setRole(admin, other.id, 'USER');

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(await roleOf(other.id), 'USER');
  });

  it('refuses to demote the last administrator', async () => {
    /*
     * The unrecoverable one. Role is otherwise only settable in the database, so
     * this would put every administrative function — including the page that
     * would undo it — behind a psql session on the server, which is the person
     * this feature exists to avoid needing.
     */
    const alone = await seed('only-admin@example.test', 'ADMIN');
    await seed('a-plain-user@example.test', 'USER');

    const { status, body } = await setRole(alone, alone.id, 'USER');

    assert.equal(status, 409);
    assert.match(String(body.message), /administrator/i);
    assert.equal(await roleOf(alone.id), 'ADMIN', 'the demotion was refused but still applied');
  });

  it('refuses to let an administrator demote themselves at all', async () => {
    /*
     * Refused even with another administrator present, where it would be
     * recoverable. The session doing it loses the page it is standing on the
     * moment it succeeds, and the remedy — ask another administrator — is the
     * same as if it had been refused. A control that logs you out of itself is
     * better refused than explained.
     */
    const self = await seed('self@example.test', 'ADMIN');
    await seed('spare-admin@example.test', 'ADMIN');

    const { status, body } = await setRole(self, self.id, 'USER');

    assert.equal(status, 409);
    assert.match(String(body.message), /your own/i);
    assert.equal(await roleOf(self.id), 'ADMIN');
  });

  it('lets an administrator re-assert their own role, which changes nothing', async () => {
    // Not a demotion, so the self-refusal must not catch it — otherwise a form
    // that PATCHes whatever it rendered fails for the account using it.
    const self = await seed('reassert@example.test', 'ADMIN');

    const { status } = await setRole(self, self.id, 'ADMIN');

    assert.equal(status, 200);
    assert.equal(await roleOf(self.id), 'ADMIN');
  });

  it('records nothing when the role does not actually change', async () => {
    // `audit_events` is append-only and never pruned. A row for a change that
    // did not happen is a row nobody can ever remove.
    const admin = await seed('noop-admin@example.test', 'ADMIN');
    const target = await seed('already-a-user@example.test', 'USER');

    const { status } = await setRole(admin, target.id, 'USER');

    assert.equal(status, 200);
    const { rows } = await database.pool!.query(
      "SELECT 1 FROM audit_events WHERE action = 'user.role_change'",
    );
    assert.equal(rows.length, 0, 'a no-op change was written to the trail');
  });

  it('answers 404 for an account that does not exist', async () => {
    // Rather than a silent success, so a stale list cannot report a change it
    // did not make.
    const admin = await seed('admin-404@example.test', 'ADMIN');

    const { status } = await setRole(admin, 999_999, 'ADMIN');

    assert.equal(status, 404);
  });

  it('refuses a role nobody implemented, and a body carrying more than the role', async () => {
    const admin = await seed('admin-validation@example.test', 'ADMIN');
    const target = await seed('target-validation@example.test', 'USER');

    const bad = await fetch(`${origin}/auth/users/${target.id}/role`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'SUPERADMIN' }),
    });
    assert.equal(bad.status, 400);

    /*
     * `.strict()`, and this is the case it is for: a form PATCHing back the
     * whole record it rendered. Ignoring the extra fields would make this
     * endpoint look like it accepted an email or a password change.
     */
    const extra = await fetch(`${origin}/auth/users/${target.id}/role`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'ADMIN', email: 'attacker@example.test' }),
    });
    assert.equal(extra.status, 400);
    assert.equal(await roleOf(target.id), 'USER');
  });

  it('refuses a plain user with 403, not 401', async () => {
    // The distinction carries information: 401 sends somebody to a sign-in page
    // that cannot help them. Asserted functionally here as well as structurally
    // in `route-guards.test.ts`, because a guard can be installed and not work.
    await seed('admin-somewhere@example.test', 'ADMIN');
    const plain = await seed('plain@example.test', 'USER');
    const target = await seed('victim@example.test', 'USER');

    const { status } = await setRole(plain, target.id, 'ADMIN');

    assert.equal(status, 403);
    assert.equal(await roleOf(target.id), 'USER');
  });

  it('cannot be raced into leaving no administrator', async () => {
    /*
     * Two administrators demoting each other at the same moment. Without the row
     * lock each transaction reads two admins, each passes the check, both writes
     * land, and nobody is an administrator any more — reached without either
     * person doing anything wrong, and not reproducible by hand.
     *
     * The INVARIANT is asserted, not the mechanism, because there are two honest
     * ways to lose this race and the first run of this test found the other one:
     * if the winner commits before the loser's `requireRole` re-reads its row,
     * the loser is already a USER and the guard refuses it with 403 rather than
     * the lock refusing it with 409. Both are correct. What must never differ is
     * that exactly one succeeds and an administrator remains.
     *
     * Repeated, because a single pass would also be green with the lock removed
     * whenever the timing happened to serialise. Several rounds with fresh
     * accounts make the unlocked version very unlikely to survive — and it does
     * not: dropping `.for('update')` turns this red.
     */
    for (let round = 0; round < 5; round += 1) {
      await truncateAll(database.pool!);
      const first = await seed(`racer-one-${round}@example.test`, 'ADMIN');
      const second = await seed(`racer-two-${round}@example.test`, 'ADMIN');

      const [a, b] = await Promise.all([
        setRole(first, second.id, 'USER'),
        setRole(second, first.id, 'USER'),
      ]);

      const succeeded = [a, b].filter((result) => result.status === 200);
      assert.equal(
        succeeded.length,
        1,
        `round ${round}: expected exactly one to succeed, got ${a.status} and ${b.status}`,
      );

      const { rows } = await database.pool!.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM users WHERE role = 'ADMIN'",
      );
      assert.equal(rows[0]!.n, '1', `round ${round}: left with ${rows[0]!.n} administrators`);
    }
  });
});
