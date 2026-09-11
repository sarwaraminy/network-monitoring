import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
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
 * `stack` and `Layer.match` are internal, and reading them is the only way to ask
 * a router what it is actually wired to do.
 *
 * They are express 5 shapes — 5.2.1 is what this repo runs. That is worth stating
 * rather than assuming: this file previously claimed the shapes were "stable across
 * the 4.x line" while also testing `layer.regexp.fast_slash`, an express 4 field
 * that express 5 does not have, so the check silently never fired. `Layer.match`
 * and `slash` are the ones that carry the behaviour here; an upgrade should start
 * by re-reading `covers` and `routesOf`.
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
  /**
   * True for a `router.use(fn)` with no path — the mount-everything case.
   *
   * Named here only to record where it lives. Nothing below reads it, because
   * `Layer.match` consults it already; an earlier version of this file tested
   * `regexp.fast_slash` instead, which is an express 4 internal that express 5
   * does not have at all. See `covers`.
   */
  slash?: boolean;
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
 * runtime rather than by a second guess here. That includes the mount-everything
 * case: a pathless `router.use(fn)` gets `slash: true` and its `match` returns
 * true for anything.
 *
 * This used to test `layer.regexp.fast_slash` before falling back to `match`, and
 * that line never once executed — `regexp` is an express 4 internal, and the
 * express 5 layer has no such field, so the optional chain yielded `undefined`
 * every time. The behaviour was right for a reason the comment did not give, which
 * in a file that documents its reliance on Express internals is the part that
 * matters: an upgrade would have gone looking at the wrong one.
 *
 * The limitation, stated because it decides which way this errs: the route's
 * *pattern* is matched, not a concrete URL, so a `use('/start')` guard is not
 * credited to a `/:id` route even though `/:id` would match `/start` at runtime.
 * That produces a false failure, never a false pass — a use layer can only be
 * credited when its own pattern covers the route's pattern, or when it covers
 * everything. Erring toward "report it ungated" is the only safe direction for a
 * check like this.
 *
 * Path coverage is only half of whether a guard runs, though; see `routesOf` for
 * the other half, which this function deliberately knows nothing about.
 */
function covers(layer: RouteLayer, routePath: string): boolean {
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
  /**
   * Whether `requireAuth` covers this route, from either place.
   *
   * Per route as well as per router, because the two are not interchangeable:
   * most routers here call `router.use(requireAuth)`, but `authRouter` cannot —
   * login and signup have to stay reachable — so it names the middleware on the
   * individual routes that need it. A check that only looked for the `use` layer
   * would report every authenticated route on that router as open.
   */
  authenticated: boolean;
}

/** Whether a handler is the `requireAuth` middleware. */
function isAuthGuard(handle: unknown): boolean {
  return (handle as { name?: string } | undefined)?.name === 'requireAuth';
}

/**
 * Every route on a router, with the guards that actually cover it.
 *
 * *Actually* is the whole of the work here, and position is half of it. Express
 * runs a router's layers in registration order, so a `router.use(requireRole(…))`
 * written **below** the route it is meant to protect never executes for that
 * route — the route's own handler has already answered. The guard is installed,
 * reads correctly, and does nothing.
 *
 * The first version of this file collected the `use` layers from the whole stack
 * and matched them to routes by path alone, so it reported that route as gated:
 * a false pass, in the file whose `covers` docblock calls erring toward "report it
 * ungated" the only safe direction. Each `use` layer therefore keeps its index and
 * is credited only to routes registered after it.
 *
 * The asymmetry that makes this worth the extra bookkeeping: a misordered
 * `requireAuth` would be caught anyway, because `auth-rejection.test.ts` fires
 * real requests and would get something other than a 401. A misordered *role*
 * guard is caught by nothing else — `role-guard.test.ts` drives the middleware
 * directly, and this file is what stands in for an integration check that would
 * need a database.
 */
function routesOf(router: Router): RouteFact[] {
  const all = layers(router);

  // Guards installed with `router.use(path, guard)`, which never appear in any
  // route's own stack. Collected once rather than per route, with the position
  // that decides whether Express reaches them.
  const useGuards: { layer: RouteLayer; index: number; roles: readonly string[] }[] = [];
  const useAuth: { layer: RouteLayer; index: number }[] = [];

  all.forEach((layer, index) => {
    if (layer.route) return;
    const roles = rolesOf(layer.handle);
    if (roles) useGuards.push({ layer, index, roles });
    if (isAuthGuard(layer.handle)) useAuth.push({ layer, index });
  });

  const facts: RouteFact[] = [];
  all.forEach((layer, index) => {
    const route = layer.route;
    if (!route) return;

    /*
     * The route's own stack, up to the first entry that can answer the request.
     *
     * Position matters here for the same reason it matters between layers, and this
     * loop had the same false pass one level down: any `requireRole` anywhere in
     * `route.stack` was credited, including one written *after* the handler —
     *
     *     alertsRouter.delete('/:id', asyncHandler(handler), requireRole('ADMIN'));
     *
     * where the handler responds, never calls `next`, and the guard never runs. A
     * more plausible slip than the misordered `router.use` that was fixed first,
     * because the guard and the handler are arguments to the same call.
     *
     * So only the leading run of guards counts. Anything that is neither a role
     * guard nor `requireAuth` ends it: this file cannot tell a terminal handler
     * from ordinary middleware, and stopping at the first unknown entry errs toward
     * reporting the route ungated, which is the direction `covers` sets out.
     */
    const guards: (readonly string[])[] = [];
    let ownAuth = false;
    for (const handler of route.stack) {
      const roles = rolesOf(handler.handle);
      if (roles) {
        guards.push(roles);
        continue;
      }
      if (isAuthGuard(handler.handle)) {
        ownAuth = true;
        continue;
      }
      break;
    }

    for (const used of useGuards) {
      if (used.index < index && covers(used.layer, route.path)) guards.push(used.roles);
    }

    const authenticated =
      ownAuth || useAuth.some((used) => used.index < index && covers(used.layer, route.path));

    for (const method of Object.keys(route.methods)) {
      facts.push({ method, path: route.path, guards, authenticated });
    }
  });

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
 * Every mutating route on `router` is role-gated, except the ones named.
 *
 * The exemption list is the point of the signature: an exemption has to be typed
 * out, next to the reason it is safe, rather than being the default for a route
 * somebody forgot.
 *
 * Entries are `'METHOD /path'`, not a bare path, and the difference is not
 * cosmetic. Keyed on the path alone, the `'POST /logs'` entry — which exists
 * because the legacy list endpoint is a read exposed as a POST — silently excused
 * *any* future mutating verb on `/logs`, so an ungated `DELETE /logs` added later
 * would have passed without comment. That is the exact omission this file exists
 * to catch. It also made "POST is exempt, DELETE must be gated" inexpressible, and
 * would have failed a correctly gated `DELETE /logs` with a message telling the
 * author to take the guard off.
 */
function assertRouterGuards(router: Router, options: { role: string; ungatedMutations?: string[] }): void {
  // Authentication is asserted per route rather than here — see `RouteFact.authenticated`
  // for why a router-wide check cannot cover `authRouter`. The suites below that do
  // apply `requireAuth` with `router.use` still assert it directly.
  const exempt = new Set(options.ungatedMutations ?? []);
  const claimed = new Set<string>();

  for (const route of routesOf(router)) {
    if (!MUTATING.has(route.method)) continue;
    const where = `${route.method.toUpperCase()} ${route.path}`;

    if (exempt.has(where)) {
      claimed.add(where);
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

  // An exemption for a route that no longer exists is a hole waiting for the path
  // to be reused, and it is invisible: nothing fails while the route is absent.
  assert.deepEqual(
    [...exempt].filter((entry) => !claimed.has(entry)).sort(),
    [],
    'these exemptions match no mutating route on this router — delete them, or fix the method and path',
  );
}

let suppressionsRouter: Router;
let packetRouter: Router;
let notifyRouter: Router;
let alertsRouter: Router;
let authRouter: Router;
let flowRouter: Router;
let intelRouter: Router;
let logsRouter: Router;
let auditRouter: Router;
let adhocRouter: Router;
let guideSessionRouter: Router;

before(async () => {
  // These routers pull in the services, which construct a connection pool at
  // import time. `pg` does not connect until a query runs, so nothing here
  // touches a database — but env is read, and JWT_SECRET is required.
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  ({ suppressionsRouter } = await import('./suppressions.routes.js'));
  ({ notifyRouter } = await import('./notify.routes.js'));
  ({ alertsRouter } = await import('./alerts.routes.js'));
  ({ authRouter } = await import('./auth.routes.js'));
  ({ flowRouter } = await import('./flow.routes.js'));
  ({ intelRouter } = await import('./intel.routes.js'));
  ({ logsRouter } = await import('./logs.routes.js'));
  ({ auditRouter } = await import('./audit.routes.js'));
  ({ adhocRouter } = await import('./adhoc.routes.js'));
  ({ guideSessionRouter } = await import('./user-guide.routes.js'));

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
      ungatedMutations: ['POST /preview'],
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

/**
 * The delivery router, which gained a settings endpoint that can redirect where
 * findings about the network are sent.
 *
 * Added here the moment that endpoint existed rather than later: this file's whole
 * subject is the fix that stops one step short, and adding a mutating route without
 * extending the check that guards mutating routes would have been an unusually
 * literal example.
 */
describe('delivery router guards', () => {
  it('requires authentication for everything', () => {
    assert.ok(requiresAuth(notifyRouter));
  });

  it('requires ADMIN for both routes that do something', () => {
    // PUT /settings decides where findings are delivered, so a non-admin who could
    // write it could redirect the stream or switch it off. POST /test makes the
    // server send outbound messages to a third party on demand.
    assertRouterGuards(notifyRouter, { role: 'admin' });
  });

  it('leaves status and settings readable', () => {
    // Deliberate, and the same reasoning as the alert list: someone who can see
    // every finding on the network can see how delivery is configured. The two
    // credentials are never in the response — that is enforced in
    // notify/settings.ts, not by gating the route.
    for (const path of ['/status', '/settings']) {
      const fact = routesOf(notifyRouter).find((route) => route.path === path && route.method === 'get');
      assert.ok(fact, `GET ${path} is missing`);
      assert.ok(!isGated(fact), `GET ${path} should not require a role`);
    }
  });

  it('exposes the routes the Delivery page depends on and nothing else', () => {
    const surface = routesOf(notifyRouter)
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
      .sort();
    assert.deepEqual(surface, ['GET /settings', 'GET /status', 'POST /test', 'PUT /settings']);
  });
});

/**
 * Every router in the directory, and the posture each one is meant to have.
 *
 * The three suites above were written one router at a time, as each one grew a
 * route worth arguing about — which left five routers with no check at all, and the
 * gaps were where you would expect: `DELETE /api/alerts/:id` deleted a finding for
 * any signed-in account while `DELETE /api/alerts/` next to it required ADMIN, and
 * the legacy `logs` CRUD let anyone rewrite the record of observed traffic.
 *
 * So the coverage is declared here rather than accumulated. `ROUTERS` has to name
 * every `*.routes.ts` file in this directory, and the last test in this file reads
 * the directory and fails if one is missing. Adding a router now means declaring
 * what it lets through.
 */

interface RouterPosture {
  /** The file, so the directory check can match it. */
  file: string;
  router: () => Router;
  /** Role required by everything that changes state. */
  role: string;
  /**
   * A role every route must require, reads included.
   *
   * `role` covers mutating routes only, because `assertRouterGuards` filters on
   * `MUTATING` before it looks at anything else — which meant the audit router's
   * posture asserted nothing at all. That router is GET-only, so every iteration was
   * skipped and `role: 'admin'` passed vacuously: deleting `requireRole('ADMIN')`
   * from it left the whole suite green while making the trail — the record of who
   * deleted what, which by design cannot be pruned — readable by every authenticated
   * account. A guard on a read-only router looks removable to anyone who has not
   * read this file, which is precisely why the file has to say so.
   */
  readRole?: string;
  /**
   * Acknowledges a router that has no mutating routes and whose reads are meant to
   * be open to any authenticated account.
   *
   * Required in that case, so that "this posture cannot fail" is a sentence someone
   * had to write rather than a property nobody noticed.
   */
  readsAreOpen?: boolean;
  /**
   * Mutating routes deliberately open to any authenticated caller, each with the
   * reason. Typed out one path at a time: an exemption is a decision, and the
   * default for a route nobody thought about has to be "gated".
   */
  ungatedMutations?: string[];
  /**
   * Routes reachable without a token at all, for the same reason, as
   * `'METHOD /path'`. Keyed the same way as `ungatedMutations` and for the same
   * argument: a bare `/signup-allowed` would also have excused a `POST` to it.
   */
  anonymous?: string[];
}

const ROUTERS: RouterPosture[] = [
  {
    file: 'adhoc.routes.ts',
    router: () => adhocRouter,
    role: 'admin',
    /*
     * `readRole` is the one that carries this router, and it is not a formality.
     *
     * `POST /query` is a READ in every sense that matters to a user, so a posture
     * declaring only `role` would be describing the mutating routes — of which
     * there are none — and asserting nothing, the same vacuum this file's docblock
     * describes for the audit router. Both keys are set so that neither the read
     * nor a future write can lose its gate quietly.
     *
     * ADMIN because the console reaches the database directly. It is read-only and
     * cannot see the columns holding secrets, but "every authenticated account may
     * run arbitrary SELECTs over the findings, the devices and the audit trail" is
     * not a thing to arrive at by leaving a guard off.
     */
    readRole: 'admin',
  },
  {
    file: 'alerts.routes.ts',
    router: () => alertsRouter,
    role: 'admin',
    /*
     * Acknowledging is what an operator does all day: it records that a human has
     * looked at a finding, changes nothing about the finding itself, and is
     * reversible by the route next to it. Requiring an administrator for it would
     * mean the people actually watching the network could not mark their own work.
     *
     * Reopening stays open for the same reason, but it is no longer *unaccounted*
     * for: it clears somebody else's attribution, so it appends an
     * `alert.unacknowledge` entry carrying whose acknowledgement it removed. The
     * objection to it was never that these people may reopen a finding, it was that
     * nothing recorded that they had.
     */
    ungatedMutations: ['POST /:id/acknowledge', 'POST /:id/unacknowledge'],
  },
  {
    file: 'audit.routes.ts',
    router: () => auditRouter,
    role: 'admin',
    // Nothing to exempt: the table refuses UPDATE, DELETE and TRUNCATE at the
    // database level, so this router has no mutating route to gate and cannot grow
    // one that would do anything. `readRole` is what actually holds it — the trail
    // names accounts, says which delivery fields were changed, and describes
    // findings that were deleted, so reading it is an administrator's privilege.
    readRole: 'admin',
  },
  {
    file: 'auth.routes.ts',
    router: () => authRouter,
    role: 'admin',
    // Signing up and signing in cannot require a token, and `/signup-allowed` is
    // what the UI asks before drawing the form. Who may sign up is decided inside
    // the handler by `authorizeSignup` — see auth.routes.ts, where an open signup
    // endpoint was a privilege-escalation hole once already.
    anonymous: ['GET /signup-allowed', 'POST /login', 'POST /signup'],
    ungatedMutations: ['POST /login', 'POST /signup'],
  },
  {
    file: 'flow.routes.ts',
    router: () => flowRouter,
    /*
     * `PUT /settings` is the only thing here that changes state, and it is ADMIN:
     * it decides whether this installation collects flow at all, on which port,
     * and which senders are accepted — and that allowlist is the collector's only
     * access control, since NetFlow has no authentication.
     */
    role: 'admin',
    /*
     * Both reads are open to any authenticated account, deliberately. Whether the
     * collector is listening is not privileged information, and neither is how it
     * is configured: there is no credential among these fields, which is itself a
     * fact about the protocol rather than an oversight. The operator watching the
     * network is usually not the administrator.
     */
    readsAreOpen: true,
  },
  { file: 'intel.routes.ts', router: () => intelRouter, role: 'admin' },
  {
    file: 'logs.routes.ts',
    router: () => logsRouter,
    role: 'admin',
    /*
     * Two routes now, both the same read, and nothing that writes.
     *
     * The three legacy writes — `POST /log/add`, `PUT /log/:id`, `DELETE /log/:id`
     * — are gone rather than guarded: rows in `logs` are a record of what was
     * observed on the network, nothing in this application writes them, and an
     * endpoint that can fabricate one exists only so that it can be protected.
     *
     * `readsAreOpen` is required because of that removal — see the posture check
     * below. Reading the history stays open to any authenticated account,
     * deliberately: it is the same class of data the alert list already shows.
     */
    readsAreOpen: true,
    // `POST /logs` is a read. It exists because the Java controller it replaces
    // exposed the list that way, and the GET beside it is the same data for new
    // callers; the method is legacy, not a mutation. Named with its verb, so a
    // `DELETE /logs` added later is not excused by it.
    ungatedMutations: ['POST /logs'],
  },
  { file: 'notify.routes.ts', router: () => notifyRouter, role: 'admin' },
  { file: 'packets.routes.ts', router: () => packetRouter, role: 'admin' },
  {
    file: 'suppressions.routes.ts',
    router: () => suppressionsRouter,
    role: 'admin',
    // Preview writes nothing; it is a POST because the rule being tried out is a
    // body rather than a query string.
    ungatedMutations: ['POST /preview'],
  },
  {
    file: 'user-guide.routes.ts',
    router: () => guideSessionRouter,
    /*
     * Minting the guide's session cookie. No mutating routes in the sense this
     * file means — `POST /session` writes a `Set-Cookie` for the caller and
     * nothing else — and it must be reachable by any signed-in account, because
     * the guide is documentation rather than an administrative tool.
     *
     * The OTHER router in this file, `userGuideRouter`, is not declared here and
     * cannot be: it is the one router in the application without `requireAuth`,
     * gated instead by the cookie this one issues, because a browser following a
     * link to a page sends no `Authorization` header for anything on it. Every
     * assertion this file would make about it would be about the wrong mechanism.
     * Its gate is asserted directly in user-guide.test.ts, over real HTTP, in both
     * directions.
     */
    role: 'admin',
    readsAreOpen: true,
    /*
     * Both routes write a `Set-Cookie` for the caller and nothing else — no state
     * of the system changes — and both must be reachable by any signed-in account,
     * because the guide is documentation rather than an administrative tool.
     * Requiring ADMIN to read the manual would be a strange place to put a guard.
     */
    ungatedMutations: ['POST /session', 'DELETE /session'],
  },
];

describe('every router, declared', () => {
  for (const posture of ROUTERS) {
    describe(posture.file, () => {
      it('lets nothing through unauthenticated except the routes named here', () => {
        const anonymous = new Set(posture.anonymous ?? []);
        const claimed = new Set<string>();

        for (const route of routesOf(posture.router())) {
          const where = `${route.method.toUpperCase()} ${route.path}`;

          if (anonymous.has(where)) {
            claimed.add(where);
            assert.ok(
              !route.authenticated,
              `${where} is listed as anonymous but is behind requireAuth — remove it from the ` +
                'list rather than leaving the two disagreeing',
            );
            continue;
          }

          assert.ok(route.authenticated, `${where} is reachable without a token`);
        }

        // The same staleness check `assertRouterGuards` makes about its exemptions,
        // and for the same reason: an entry that stops corresponding to any route
        // survives silently, and a future route registered at that path is then
        // exempted from the authentication assertion without anyone choosing it.
        // This list is the more dangerous of the two to leave stale — the other
        // waives a role, this one waives having a token at all.
        assert.deepEqual(
          [...anonymous].filter((entry) => !claimed.has(entry)).sort(),
          [],
          'these anonymous exemptions match no route on this router — delete them, or fix the ' +
            'method and path',
        );
      });

      it(`requires ${posture.role} for everything that changes state`, () => {
        assertRouterGuards(posture.router(), {
          role: posture.role,
          ...(posture.ungatedMutations ? { ungatedMutations: posture.ungatedMutations } : {}),
        });
      });

      it('has a posture that is capable of failing', () => {
        /*
         * The check on the checks.
         *
         * `role` is only asserted against mutating routes, so on a GET-only router
         * the entry above passes no matter what the router does. That was true of
         * `audit.routes.ts` and is true of `flow.routes.ts`, and in the first case
         * it hid a real hole: the ADMIN gate on the audit reads could have been
         * deleted without a single test noticing.
         *
         * So a router with nothing mutating has to say which of the two situations
         * it is in — `readRole` if its reads are privileged, `readsAreOpen` if they
         * are deliberately not.
         */
        const routes = routesOf(posture.router());
        assert.ok(routes.length > 0, `${posture.file} exposes no routes`);

        /*
         * An exempt route does not count towards "this posture can fail".
         *
         * `assertRouterGuards` skips anything named in `ungatedMutations` before it
         * asserts a role, so a router whose only mutating routes are all exempt is
         * in exactly the position a GET-only router is: `role` is applied to
         * nothing. Asking merely whether a mutating route *exists* missed that, and
         * `logs.routes.ts` walked straight into it when its three legacy write
         * endpoints were deleted — one exempt `POST /logs` left behind, `role`
         * asserting nothing, and the reads' posture never declared. A hole reached
         * by removing routes rather than by forgetting a guard, which is the one
         * direction this file had not considered.
         */
        const exempt = new Set(posture.ungatedMutations ?? []);
        const asserted = routes.filter(
          (route) => MUTATING.has(route.method) && !exempt.has(`${route.method.toUpperCase()} ${route.path}`),
        );
        if (asserted.length > 0) return;

        assert.ok(
          posture.readRole !== undefined || posture.readsAreOpen === true,
          `${posture.file} has no mutating route that \`role\` is applied to, so it asserts ` +
            'nothing about this router. Add `readRole` if its reads are privileged, or ' +
            '`readsAreOpen: true` if they are not',
        );
      });

      if (posture.readRole) {
        const readRole = posture.readRole;

        it(`requires ${readRole} to read as well as to write`, () => {
          const routes = routesOf(posture.router());
          assert.ok(routes.length > 0, `${posture.file} exposes no routes`);

          for (const route of routes) {
            assert.ok(
              requiresRole(route, readRole),
              `${route.method.toUpperCase()} ${route.path} does not require ${readRole} ` +
                `(guards found: ${JSON.stringify(route.guards)})`,
            );
          }
        });
      }
    });
  }

  it('names every router file in this directory', async () => {
    /*
     * The check that makes the rest of this file hold up over time.
     *
     * Every suite here was added by hand after the router it covers already
     * existed, which is why five of them went uncovered — a guard check that has
     * to be remembered is a guard check that will not be. Reading the directory
     * turns "you forgot to test the new router" into a failing build instead of a
     * gap nobody can see.
     */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const onDisk = (await readdir(here)).filter((name) => name.endsWith('.routes.ts')).sort();
    const declared = ROUTERS.map((posture) => posture.file).sort();

    assert.deepEqual(
      onDisk,
      declared,
      'a router file is not declared in ROUTERS (or is declared and no longer exists): ' +
        'add it, with the posture it is meant to have',
    );
  });
});
