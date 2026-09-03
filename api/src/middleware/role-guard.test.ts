import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import type { UserRow } from '../db/schema.js';

/**
 * `requireRole`, on its own.
 *
 * The third of the three checks on authorisation, and the one the other two cannot
 * make. `route-guards.test.ts` asserts that an ADMIN guard covers every route that
 * changes state; `auth-rejection.test.ts` drives the real app over HTTP and proves
 * an unauthenticated caller is refused everywhere. Neither reaches the case in
 * between — a caller who *is* authenticated and simply is not allowed — because
 * getting past `requireAuth` means a user row, and that means a database.
 *
 * So the guard is exercised directly here. Three outcomes matter and they are
 * genuinely different: 401 for nobody, 403 for the wrong somebody, and `next()`
 * for the right one. Collapsing the first two is a real bug and a common one —
 * answering 403 to an anonymous caller tells them the route exists and that a
 * credential would get them further, and answering 401 to a signed-in user sends
 * the UI to the login screen and makes a permissions problem look like an expired
 * session.
 */

let requireRole: typeof import('./auth.js')['requireRole'];

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  ({ requireRole } = await import('./auth.js'));
});

/** Just enough of a user for the guard, which reads exactly one field. */
function userWithRole(role: string): UserRow {
  return { id: 1, email: 'someone@example.com', password: 'irrelevant', role } as UserRow;
}

interface Outcome {
  status?: number;
  body?: unknown;
  nexted: boolean;
}

/** Runs a guard against a request and records which of the three paths it took. */
function run(guard: ReturnType<typeof requireRole>, user: UserRow | undefined): Outcome {
  const outcome: Outcome = { nexted: false };

  const res = {
    status(code: number) {
      outcome.status = code;
      return this;
    },
    json(body: unknown) {
      outcome.body = body;
      return this;
    },
  } as unknown as Response;

  const next = (() => {
    outcome.nexted = true;
  }) as NextFunction;

  guard({ user } as Request, res, next);
  return outcome;
}

describe('requireRole', () => {
  it('lets the permitted role through', () => {
    const outcome = run(requireRole('ADMIN'), userWithRole('ADMIN'));

    assert.equal(outcome.nexted, true);
    assert.equal(outcome.status, undefined);
  });

  it('refuses a different role with 403, not 401', () => {
    // The distinction the UI depends on: 401 means "log in again", which for a
    // signed-in user is both wrong and a dead end — they log in again, land on the
    // same button, and get sent back.
    const outcome = run(requireRole('ADMIN'), userWithRole('USER'));

    assert.equal(outcome.status, 403);
    assert.equal(outcome.nexted, false);
  });

  it('refuses an unauthenticated request with 401, not 403', () => {
    // The other side of the same distinction. `requireRole` is always mounted
    // behind `requireAuth`, so this should be unreachable — and it is asserted
    // precisely because "unreachable" is a property of the wiring, which changes.
    // A guard that assumed a user and read `req.user.role` would throw here, and a
    // 500 on an anonymous request is an information leak of a different kind.
    const outcome = run(requireRole('ADMIN'), undefined);

    assert.equal(outcome.status, 401);
    assert.equal(outcome.nexted, false);
  });

  it('compares roles case-insensitively, in both directions', () => {
    // The database has held 'ADMIN' and call sites are written 'ADMIN', but the
    // comparison is lowercased at both ends so a row that says 'admin' — or a
    // guard written `requireRole('admin')` — cannot silently lock an administrator
    // out of their own installation.
    assert.equal(run(requireRole('admin'), userWithRole('ADMIN')).nexted, true);
    assert.equal(run(requireRole('ADMIN'), userWithRole('admin')).nexted, true);
    assert.equal(run(requireRole('AdMiN'), userWithRole('aDmIn')).nexted, true);
  });

  it('admits any of several permitted roles', () => {
    const guard = requireRole('USER', 'ADMIN');

    assert.equal(run(guard, userWithRole('USER')).nexted, true);
    assert.equal(run(guard, userWithRole('ADMIN')).nexted, true);
    assert.equal(run(guard, userWithRole('AUDITOR')).status, 403);
  });

  it('reports the roles it enforces, lowercased', () => {
    /*
     * `requiredRoles` is what `route-guards.test.ts` reads to ask a routing table
     * which routes are gated, so it is part of the contract rather than a debugging
     * aid. Two things about it matter there:
     *
     *  - it must be lowercase, because that check compares lowercased; and
     *  - it must list *every* admitted role, not just the first. A guard reporting
     *    only 'admin' out of `requireRole('USER', 'ADMIN')` would be read as an
     *    admin gate when it admits everyone — a false pass, in the direction that
     *    costs something.
     */
    assert.deepEqual(requireRole('ADMIN').requiredRoles, ['admin']);
    assert.deepEqual([...requireRole('USER', 'ADMIN').requiredRoles].sort(), ['admin', 'user']);
  });

  it('does not let a role slip through by another name', () => {
    // Whitespace and near-misses are refused rather than trimmed. A guard that
    // normalised loosely would eventually admit a role nobody granted.
    for (const role of [' admin', 'admin ', 'admin\t', 'administrator', 'admin,user', '']) {
      assert.equal(
        run(requireRole('ADMIN'), userWithRole(role)).status,
        403,
        `role ${JSON.stringify(role)} was not refused`,
      );
    }
  });
});
