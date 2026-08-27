import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Router } from 'express';

/**
 * The shape of a router's own guards.
 *
 * The recurring mistake in this codebase is the fix that stops one step short.
 * Gating capture `/start` on ADMIN left `GET /` ungated. Closing the signup hole
 * reached "not anonymous" and stopped before least-privilege. Neither is visible
 * to a test of the guard itself — `requireRole('ADMIN')` works perfectly in
 * isolation while a route quietly does not use it.
 *
 * What catches that is asserting the routing table: for each route, is auth
 * applied, and does anything that changes state carry a role guard? That is what
 * this file does, without a database, an HTTP server or a token, by reading the
 * routers Express has already built.
 *
 * Scope, stated honestly: this covers the suppression router, which is the one
 * whose configuration can make the tool go quiet. Roadmap item 3 — route-level
 * auth tests over every router, exercising real requests — is the full version of
 * this, and `assertRouterGuards` below is written to be pointed at another router
 * the moment that work starts.
 */

/** Express's internal layer shapes. Not in @types/express, so described here. */
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown; name: string }[];
  };
  handle?: unknown;
  name: string;
}

/** Methods that change state, and so must be gated by role. */
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

function layers(router: Router): RouteLayer[] {
  // `stack` is internal but stable across the 4.x line, and reading it is the
  // only way to ask a router what it is actually wired to do.
  return (router as unknown as { stack: RouteLayer[] }).stack;
}

function roleGuardOf(handlers: { handle: unknown }[]): readonly string[] | null {
  for (const { handle } of handlers) {
    const roles = (handle as { requiredRoles?: readonly string[] }).requiredRoles;
    if (roles) return roles;
  }
  return null;
}

interface RouteFact {
  method: string;
  path: string;
  /** Lowercased roles the route admits, or null when it carries no role guard. */
  roles: readonly string[] | null;
}

function routesOf(router: Router): RouteFact[] {
  const facts: RouteFact[] = [];
  for (const layer of layers(router)) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      facts.push({ method, path: layer.route.path, roles: roleGuardOf(layer.route.stack) });
    }
  }
  return facts;
}

/** True when the router applies `requireAuth` to everything mounted under it. */
function requiresAuth(router: Router): boolean {
  return layers(router).some(
    (layer) => !layer.route && (layer.handle as { name?: string })?.name === 'requireAuth',
  );
}

/**
 * Every mutating route on `router` is role-gated, except the paths named.
 *
 * The exemption list is the point of the signature: an exemption has to be typed
 * out, next to the reason it is safe, rather than being the default for a route
 * somebody forgot.
 */
function assertRouterGuards(
  router: Router,
  options: { role: string; ungatedMutations?: string[] } = { role: 'admin' },
): void {
  assert.ok(requiresAuth(router), 'router does not apply requireAuth');

  const exempt = new Set(options.ungatedMutations ?? []);

  for (const route of routesOf(router)) {
    if (!MUTATING.has(route.method)) continue;
    if (exempt.has(route.path)) {
      assert.equal(
        route.roles,
        null,
        `${route.method.toUpperCase()} ${route.path} is listed as ungated but carries a role guard — ` +
          'remove it from the exemption list rather than leaving the two disagreeing',
      );
      continue;
    }

    assert.ok(
      route.roles?.includes(options.role),
      `${route.method.toUpperCase()} ${route.path} changes state without requiring ${options.role}`,
    );
  }
}

let suppressionsRouter: Router;

before(async () => {
  // The router pulls in the services, which construct a connection pool at import
  // time. `pg` does not connect until a query runs, so nothing here touches a
  // database — but env is read, and JWT_SECRET is required.
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  ({ suppressionsRouter } = await import('./suppressions.routes.js'));
});

describe('suppression router guards', () => {
  it('requires authentication for everything', () => {
    assert.ok(requiresAuth(suppressionsRouter));
  });

  it('requires ADMIN for every route that changes a rule', () => {
    // A suppression rule is the one piece of configuration here that can make the
    // tool stop reporting. A non-admin who could write one could blind it.
    assertRouterGuards(suppressionsRouter, {
      role: 'admin',
      // Preview writes nothing. It is a POST only because the rule being tried
      // out is a body rather than a query string.
      ungatedMutations: ['/preview'],
    });
  });

  it('exposes the routes the UI depends on and nothing else', () => {
    // A new route appearing here should be a deliberate act. Listing them makes
    // an accidental one — a debug endpoint, a forgotten PUT — fail the build.
    const surface = routesOf(suppressionsRouter)
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
      .sort();

    assert.deepEqual(surface, ['DELETE /:id', 'GET /', 'PATCH /:id', 'POST /', 'POST /preview']);
  });

  it('lets a read be a read', () => {
    // Stated as its own case because the opposite mistake is real too: gating the
    // rule list on ADMIN would mean nobody but an administrator could see which
    // findings are being discarded, and a suppression nobody can audit is worse
    // than one anybody can read.
    const list = routesOf(suppressionsRouter).find((route) => route.method === 'get' && route.path === '/');
    assert.ok(list, 'GET / is missing');
    assert.equal(list.roles, null);
  });
});
