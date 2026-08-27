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
 * Two things it has to get right, and the first version of this file got neither:
 *
 *  1. **A guard can be installed away from the route it protects.** The packet
 *     router gates with `router.use(['/start', '/stop', '/clear'], requireRole(…))`,
 *     which lands in a `use` layer and never appears in a route's own handler
 *     stack. A helper that reads only `route.stack` reports all three as ungated —
 *     three false failures on a router that is correctly gated. A guard check whose
 *     failures are false gets muted, and a muted guard check is precisely the
 *     failure this file exists to prevent.
 *  2. **Admitting ADMIN is not the same as requiring it.** `requireRole('USER',
 *     'ADMIN')` has `'admin'` in its role list and lets every account through, so
 *     asking whether the list *contains* admin would pass a route that is not an
 *     admin gate at all — a false pass, which is the direction that actually costs
 *     something. `requiresRole` below asks whether a covering guard admits that
 *     role and nothing else.
 */

/**
 * Express's internal layer shapes. Not in @types/express, so described here.
 *
 * `stack` and `Layer.match` are internal but stable across the 4.x line, and
 * reading them is the only way to ask a router what it is actually wired to do.
 */
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
  handle?: unknown;
  /** Present on every layer. Returns whether this layer covers a path. */
  match?: (path: string) => boolean;
  regexp?: RegExp & { fast_slash?: boolean };
  name: string;
}

/** Methods that change state, and so must be gated by role. */
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

function layers(router: Router): RouteLayer[] {
  return (router as unknown as { stack: RouteLayer[] }).stack;
}

/** The roles a handler enforces, if it is a `requireRole` guard. */
function rolesOf(handle: unknown): readonly string[] | null {
  const roles = (handle as { requiredRoles?: readonly string[] } | undefined)?.requiredRoles;
  return roles && roles.length > 0 ? roles : null;
}

/**
 * Whether a `use` layer covers `routePath`.
 *
 * `Layer.match` is Express's own answer, so an array of paths, a prefix and a
 * bare `router.use(fn)` are all handled by the code that will handle them at
 * runtime rather than by a second guess here.
 *
 * The limitation, stated because it decides which way this errs: the route's
 * *pattern* is matched, not a concrete URL, so a `use('/start')` guard is not
 * credited to a `/:id` route even though `/:id` would match `/start` at runtime.
 * That produces a false failure, never a false pass — a use layer can only be
 * credited when its own pattern covers the route's pattern, or when it covers
 * everything. Erring toward "report it ungated" is the only safe direction for a
 * check like this.
 */
function covers(layer: RouteLayer, routePath: string): boolean {
  if (layer.regexp?.fast_slash) return true;
  return layer.match?.(routePath) ?? false;
}

interface RouteFact {
  method: string;
  path: string;
  /**
   * Every role set enforced by a guard covering this route — from the route's own
   * handler stack and from `router.use` layers alike. Empty means no role guard.
   */
  guards: readonly (readonly string[])[];
}

function routesOf(router: Router): RouteFact[] {
  const all = layers(router);

  // Guards installed with `router.use(path, guard)`, which never appear in any
  // route's own stack. Collected once rather than per route.
  const useGuards = all
    .filter((layer) => !layer.route && rolesOf(layer.handle))
    .map((layer) => ({ layer, roles: rolesOf(layer.handle)! }));

  const facts: RouteFact[] = [];
  for (const layer of all) {
    const route = layer.route;
    if (!route) continue;

    const guards: (readonly string[])[] = [];
    for (const handler of route.stack) {
      const roles = rolesOf(handler.handle);
      if (roles) guards.push(roles);
    }
    for (const { layer: useLayer, roles } of useGuards) {
      if (covers(useLayer, route.path)) guards.push(roles);
    }

    for (const method of Object.keys(route.methods)) {
      facts.push({ method, path: route.path, guards });
    }
  }

  return facts;
}

/**
 * Whether every account lacking `role` is refused.
 *
 * A guard admitting more than `role` is not a gate for it — see the docblock. So
 * this asks for a covering guard whose whole role list is `role`.
 */
function requiresRole(fact: RouteFact, role: string): boolean {
  const wanted = role.toLowerCase();
  return fact.guards.some((roles) => roles.every((each) => each.toLowerCase() === wanted));
}

function isGated(fact: RouteFact): boolean {
  return fact.guards.length > 0;
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
function assertRouterGuards(router: Router, options: { role: string; ungatedMutations?: string[] }): void {
  assert.ok(requiresAuth(router), 'router does not apply requireAuth');

  const exempt = new Set(options.ungatedMutations ?? []);

  for (const route of routesOf(router)) {
    if (!MUTATING.has(route.method)) continue;
    const where = `${route.method.toUpperCase()} ${route.path}`;

    if (exempt.has(route.path)) {
      assert.ok(
        !isGated(route),
        `${where} is listed as ungated but carries a role guard — remove it from the ` +
          'exemption list rather than leaving the two disagreeing',
      );
      continue;
    }

    assert.ok(
      requiresRole(route, options.role),
      `${where} changes state without requiring ${options.role} ` +
        `(guards found: ${JSON.stringify(route.guards)})`,
    );
  }
}

let suppressionsRouter: Router;
let packetRouter: Router;

before(async () => {
  // These routers pull in the services, which construct a connection pool at
  // import time. `pg` does not connect until a query runs, so nothing here
  // touches a database — but env is read, and JWT_SECRET is required.
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  ({ suppressionsRouter } = await import('./suppressions.routes.js'));

  const { createPacketRouter } = await import('./packets.routes.js');
  const { interfaceCapture } = await import('../services/packet-capture.registry.js');
  packetRouter = createPacketRouter(interfaceCapture, { requireIpFilter: false });
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
    assert.ok(!isGated(list));
  });
});

/**
 * The router the technique was written for, and the one that proves it works.
 *
 * Capture `/start` being gated while `GET /` was not is the bug named in this
 * file's docblock. It gates through `router.use(['/start', '/stop', '/clear'],
 * requireRole('ADMIN'))`, so it is also the case a helper reading only
 * `route.stack` gets wrong — which is why it is asserted here rather than left
 * for roadmap item 3 to discover.
 */
describe('packet router guards', () => {
  it('requires authentication for everything', () => {
    assert.ok(requiresAuth(packetRouter));
  });

  it('sees the ADMIN gate installed with router.use, not on the route', () => {
    for (const path of ['/start', '/stop', '/clear']) {
      const facts = routesOf(packetRouter).filter((route) => route.path === path);
      assert.ok(facts.length > 0, `${path} is missing`);
      for (const fact of facts) {
        assert.ok(
          requiresRole(fact, 'admin'),
          `${fact.method.toUpperCase()} ${path} should require ADMIN via router.use`,
        );
      }
    }
  });

  it('requires ADMIN for every capture route that changes state', () => {
    assertRouterGuards(packetRouter, { role: 'admin' });
  });

  it('leaves the reads ungated', () => {
    // The other half of the original bug. Reading buffered packets is not an
    // administrator's privilege, and gating it would be its own mistake.
    for (const path of ['/', '/nif', '/status', '/ip-info']) {
      const fact = routesOf(packetRouter).find((route) => route.path === path && route.method === 'get');
      assert.ok(fact, `GET ${path} is missing`);
      assert.ok(!isGated(fact), `GET ${path} should not require a role`);
    }
  });
});
