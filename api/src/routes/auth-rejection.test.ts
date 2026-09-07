import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Express, Router } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Every protected route, refused, over real HTTP.
 *
 * `route-guards.test.ts` reads the routing table and asks whether a guard is
 * installed. That catches the route somebody forgot to gate, and it is the cheaper
 * and broader of the two checks — but it cannot catch a guard that is installed and
 * does not work. `requireAuth` accepting an unsigned token, or an expired one, or
 * one signed with a different secret would leave that file entirely green: the
 * middleware is present on every route it is supposed to be present on.
 *
 * So this file starts the real app on a real port and asks the questions from
 * outside, with real tokens. `REJECTED` below is the list, and it is the list
 * rather than a prose summary because a count in a comment goes stale the moment
 * a case is added — which this one already did: no header, the wrong scheme, a
 * string that is not a JWT at all, a token signed by somebody else, an expired
 * one, an unsigned `alg: none` token carrying perfectly good claims, and one
 * signed with HS256 against the HS512 this server pins. Each must come back 401
 * from every authenticated route.
 *
 * Two properties make this safe to run with no database:
 *
 *  - **No handler executes.** Every attempt is refused by `requireAuth` before
 *    it looks a user up, so nothing reaches a query, a capture, or an outbound
 *    webhook. That is also why the positive case — a valid token being admitted —
 *    is not here: it would need a real user row, and firing authorised requests at
 *    routes that start captures and send messages to third parties is not something
 *    a test suite should do. Role enforcement is asserted in
 *    `middleware/role-guard.test.ts`, which drives the guard directly.
 *  - **404 is a failure, not a pass.** Every URL below is built from a mount prefix
 *    declared in this file, so a route that has moved, or a prefix that never
 *    matched anything, answers 404 rather than 401 and fails. The assertion doubles
 *    as a check that the app is mounted where this file thinks it is.
 */

const SECRET = 'auth-rejection-suite-secret';

/*
 * Set and loaded here rather than in `before`, because `guide-session.ts` derives
 * its signing key at module load — and the guide token below has to be minted by
 * the real thing. Deriving it a second time in this file would be a copy of a
 * security-relevant constant, which is how the two drift apart.
 */
process.env.JWT_SECRET = SECRET;
const { signGuideSession } = await import('../services/guide-session.js');

let app: Express;
let server: Server;
let origin: string;

interface Mount {
  /** Where `app.ts` mounts it. */
  at: string;
  router: () => Router;
}

let mounts: Mount[];

before(async () => {
  process.env.JWT_SECRET = SECRET;
  // Rate limits are disabled under `test`, and this suite makes a few hundred
  // requests from one address. Without it the backstop limiter would start
  // answering 429 partway through and every remaining assertion would be about
  // the limiter instead of about authentication.
  process.env.NODE_ENV = 'test';
  // Unreachable on purpose. Nothing here should reach a query — see the docblock —
  // and if a request ever does, this makes it a connection error rather than a
  // silent read of whatever database the developer had configured.
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/should-never-connect';

  const [
    { createApp },
    adhoc,
    alerts,
    audit,
    auth,
    flow,
    intel,
    notify,
    suppressions,
    packets,
    logs,
    userGuide,
    registry,
  ] = await Promise.all([
    import('../app.js'),
    import('./adhoc.routes.js'),
    import('./alerts.routes.js'),
    import('./audit.routes.js'),
    import('./auth.routes.js'),
    import('./flow.routes.js'),
    import('./intel.routes.js'),
    import('./notify.routes.js'),
    import('./suppressions.routes.js'),
    import('./packets.routes.js'),
    import('./logs.routes.js'),
    import('./user-guide.routes.js'),
    import('../services/packet-capture.registry.js'),
  ]);

  mounts = [
    { at: '/auth', router: () => auth.authRouter },
    { at: '/api/adhoc', router: () => adhoc.adhocRouter },
    { at: '/api/alerts', router: () => alerts.alertsRouter },
    { at: '/api/audit', router: () => audit.auditRouter },
    { at: '/api/flow', router: () => flow.flowRouter },
    { at: '/api/intel', router: () => intel.intelRouter },
    { at: '/api/notify', router: () => notify.notifyRouter },
    { at: '/api/suppressions', router: () => suppressions.suppressionsRouter },
    // Two mounts of the same factory, one per capture mode. Both are asserted,
    // because the filtered one has its own guard requirement and a mount that
    // silently lost its gate would be invisible from the other.
    {
      at: '/api/packets',
      router: () => packets.createPacketRouter(registry.interfaceCapture, { requireIpFilter: false }),
    },
    {
      at: '/api/ip/packets',
      router: () => packets.createPacketRouter(registry.filteredIpCapture, { requireIpFilter: true }),
    },
    { at: '/api', router: () => logs.logsRouter },
    { at: '/api/user-guide', router: () => userGuide.guideSessionRouter },
    /*
     * The guide's files. Declared so the mount count matches, but deliberately
     * contributing no targets to the sweep below: it is the one router NOT gated
     * by `requireAuth`, because a browser navigating to a page cannot send a
     * bearer token. It is gated by a session cookie instead, and that gate has its
     * own suite in user-guide.test.ts — which asserts an anonymous reader is
     * refused the pages AND the assets, the case this file exists to catch.
     */
    { at: '/user-guide', router: () => userGuide.userGuideRouter },
  ];

  app = createApp();
  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// --- The routing table, again, but only to build URLs ---

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle?: unknown;
  /**
   * Express's own answer to "does this layer cover that path", including the
   * pathless `router.use(fn)` case — such a layer carries `slash: true` and
   * matches anything. `regexp.fast_slash` is *not* the internal to reach for
   * here: it belonged to express 4 and the express 5 layer has no `regexp` at
   * all, so a check on it silently never fires. See route-guards.test.ts.
   */
  match?: (path: string) => boolean;
  name: string;
}

function isAuthGuard(handle: unknown): boolean {
  return (handle as { name?: string } | undefined)?.name === 'requireAuth';
}

interface Target {
  method: string;
  url: string;
  /** For the failure message, which is read far more often than the code. */
  where: string;
}

/**
 * A concrete URL for a route pattern.
 *
 * The values are placeholders and do not have to be valid: `requireAuth` runs
 * before any handler, so nothing here is ever parsed. A MAC is shaped like one
 * anyway, because a 404 from a route whose pattern did not match is a failure in
 * this suite and it should not be one that takes an hour to explain.
 */
function fillParams(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      return segment.includes('mac') ? 'aa:bb:cc:dd:ee:ff' : '1';
    })
    .join('/');
}

/** Every authenticated route in the app, as something that can be requested. */
function authenticatedTargets(): Target[] {
  const targets: Target[] = [];

  for (const mount of mounts) {
    const router = mount.router();
    const all = (router as unknown as { stack: RouteLayer[] }).stack;
    const useAuth = all
      .map((layer, index) => ({ layer, index }))
      .filter((entry) => !entry.layer.route && isAuthGuard(entry.layer.handle));

    all.forEach((layer, index) => {
      const route = layer.route;
      if (!route) return;

      // `used.index < index` because Express runs layers in registration order: a
      // `router.use(requireAuth)` written below a route never executes for it. The
      // same rule as route-guards.test.ts, stated the same way, so the two files
      // cannot come to different conclusions about the same router.
      const authenticated =
        route.stack.some((handler) => isAuthGuard(handler.handle)) ||
        useAuth.some((used) => used.index < index && (used.layer.match?.(route.path) ?? false));
      if (!authenticated) return;

      const suffix = fillParams(route.path);
      const url = `${mount.at}${suffix === '/' ? '' : suffix}` || '/';

      for (const method of Object.keys(route.methods)) {
        targets.push({ method: method.toUpperCase(), url, where: `${method.toUpperCase()} ${url}` });
      }
    });
  }

  return targets;
}

// --- Tokens that must not work ---

/** Signed the way the app signs, so only the thing under test differs. */
function signed(payload: object, options: jwt.SignOptions = {}): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS512', expiresIn: '1h', ...options });
}

const REJECTED: { name: string; header?: string; why: string }[] = [
  {
    name: 'no Authorization header',
    why: 'the base case, and the one a missing `router.use(requireAuth)` would let through',
  },
  {
    name: 'the wrong scheme',
    header: 'Basic YWRtaW46cGFzc3dvcmQ=',
    why: 'a header parser that only looked for a token would accept the base64 as one',
  },
  { name: 'a token that is not a JWT', header: 'Bearer not-a-jwt-at-all', why: 'malformed input' },
  {
    name: 'a token signed by somebody else',
    header: `Bearer ${jwt.sign({ sub: 'attacker@example.com' }, 'a-different-secret', { algorithm: 'HS512' })}`,
    why: 'this is what "verifies the signature" means; a decode-only middleware passes every other case here',
  },
  {
    name: 'an expired token',
    header: `Bearer ${signed({ sub: 'someone@example.com' }, { expiresIn: '-1h' })}`,
    why: 'correctly signed by this server, so only the expiry check refuses it',
  },
  {
    name: 'an unsigned alg:none token',
    header: `Bearer ${jwt.sign({ sub: 'attacker@example.com' }, '', { algorithm: 'none' })}`,
    /*
     * The classic JWT bypass: valid claims, no signature.
     *
     * Stated carefully, because the obvious explanation is wrong here and I wrote
     * it down before checking. Deleting `algorithms: ['HS512']` from
     * `verifyAccessToken` does *not* make this case pass — jsonwebtoken restricts
     * itself to the HMAC family whenever it is handed a string secret, and refuses
     * `none` on its own. So this asserts a real and worthwhile behaviour, and it
     * is not what holds the algorithm pin in place. The case below is.
     */
    why: 'an unsigned token with valid claims must not be accepted',
  },
  {
    name: 'a user-guide session presented as a Bearer token',
    header: `Bearer ${signGuideSession('admin@example.com').value}`,
    /*
     * The one that was not refused.
     *
     * The guide session is a credential the browser carries by itself: an HttpOnly
     * cookie, attached automatically to a static-file route, deliberately outliving
     * a privileged token because the harm in it leaking was priced as "somebody
     * reads the manual". It was signed with `JWT_SECRET` and distinguished from an
     * access token only by a `purpose` claim that `verifyAccessToken` never looked
     * at — so it worked as `Authorization: Bearer` on every route here, ADMIN ones
     * included, for twelve hours. Every trade-off made for it was priced wrong.
     *
     * Swept across all routes rather than checked once, because the failure was not
     * in any route: it was in what the two token types had in common.
     */
    why: 'a credential issued for reading documentation must not be API access',
  },
  {
    name: 'a token signed with a weaker algorithm than this server uses',
    header: `Bearer ${jwt.sign({ sub: 'attacker@example.com' }, SECRET, { algorithm: 'HS256' })}`,
    /*
     * Correctly signed, with the real secret, and still refused — because the
     * verifier accepts HS512 and nothing else.
     *
     * This is the case that fails if the pin is removed: without `algorithms`,
     * jsonwebtoken's default HMAC set includes HS256, so a caller who can choose
     * the header algorithm can downgrade the signature this server demands. It is
     * also the only variant here whose token verifies, which is why it reaches
     * further into `requireAuth` than the others when the pin is gone.
     */
    why: 'the verifier must accept only the algorithm it signs with, not the whole HMAC family',
  },
];

async function attempt(target: Target, header: string | undefined): Promise<number> {
  const response = await fetch(`${origin}${target.url}`, {
    method: target.method,
    headers: {
      'content-type': 'application/json',
      ...(header ? { authorization: header } : {}),
    },
    // A body on every method, so a route that would 400 on a missing one still
    // reaches the same 401. Nothing parses it.
    ...(target.method === 'GET' || target.method === 'HEAD' ? {} : { body: '{}' }),
  });

  return response.status;
}

/**
 * Every route this suite expects to have to authenticate for.
 *
 * Pinned exactly, and the churn when a route is added is the point.
 *
 * The sweep below derives its targets from the routing table, which means that
 * removing `requireAuth` from a router does not make it fail — those routes simply
 * stop being targets and the remaining assertions still pass. That was true of the
 * first version of this file: deleting `alertsRouter.use(requireAuth)` left all
 * eleven tests green while nine routes went open to the world. A suite that shrinks
 * silently when the thing it guards is removed is worse than no suite, because it
 * reports success at the moment it stops looking.
 *
 * So the derived list is compared against this one. A route losing its guard
 * disappears from the derived list and fails here; a new authenticated route
 * appears and also fails here, which is a prompt to think about the guard rather
 * than an obstacle.
 */
const EXPECTED: readonly string[] = [
  'DELETE /api/alerts',
  'DELETE /api/alerts/1',
  'DELETE /api/alerts/devices/aa:bb:cc:dd:ee:ff',
  'DELETE /api/log/1',
  'DELETE /api/suppressions/1',
  'DELETE /api/user-guide/session',
  'GET /api/adhoc',
  'GET /api/alerts',
  'GET /api/alerts/dashboard',
  'GET /api/alerts/devices',
  'GET /api/alerts/summary',
  'GET /api/audit',
  'GET /api/audit/actions',
  'GET /api/flow/status',
  'GET /api/intel/status',
  'GET /api/ip/packets',
  'GET /api/ip/packets/ip-info',
  'GET /api/ip/packets/nif',
  'GET /api/ip/packets/status',
  'GET /api/logs',
  'GET /api/notify/settings',
  'GET /api/notify/status',
  'GET /api/packets',
  'GET /api/packets/ip-info',
  'GET /api/packets/nif',
  'GET /api/packets/status',
  'GET /api/suppressions',
  'GET /auth/me',
  'GET /auth/users',
  'PATCH /api/suppressions/1',
  'POST /api/adhoc/query',
  'POST /api/alerts/1/acknowledge',
  'POST /api/alerts/1/unacknowledge',
  'POST /api/intel/reload',
  'POST /api/ip/packets/clear',
  'POST /api/ip/packets/start',
  'POST /api/ip/packets/stop',
  'POST /api/log/add',
  'POST /api/logs',
  'POST /api/notify/test',
  'POST /api/packets/clear',
  'POST /api/packets/start',
  'POST /api/packets/stop',
  'POST /api/suppressions',
  'POST /api/suppressions/preview',
  'POST /api/user-guide/session',
  'PUT /api/log/1',
  'PUT /api/notify/settings',
];

describe('protected routes over HTTP', () => {
  it('declares every router the app mounts', () => {
    /*
     * `mounts` is hand-maintained, and without this nothing notices when it falls
     * behind `app.ts`.
     *
     * A router mounted there but missing here contributes no targets, and because
     * every assertion below is per-target rather than against a total, the suite
     * goes green having swept strictly less than before. That is the failure the
     * `EXPECTED` docblock argues against — and `mounts` is the more load-bearing of
     * the two lists, since `EXPECTED` only ever describes what `mounts` produced.
     *
     * Counted rather than named: express 5 does not expose a layer's mount path
     * (`regexp` is gone, `matchers` are opaque functions), so the count is what can
     * be compared. A router layer is one carrying its own `stack`, which is what
     * separates it from middleware like the rate limiter and the body parser.
     *
     * It has already earned itself: `audit.routes.ts` was written, exported and
     * declared in `route-guards.test.ts` — and never mounted here at all. Every
     * test in this file stayed green while two routes did not exist.
     */
    const layers = (app as unknown as { router: { stack: { handle?: { stack?: unknown[] } }[] } }).router
      .stack;
    const mounted = layers.filter((layer) => Array.isArray(layer.handle?.stack)).length;

    assert.equal(
      mounted,
      mounts.length,
      `app.ts mounts ${mounted} routers and this file declares ${mounts.length} — an undeclared ` +
        'router is never swept, so add it to `mounts` and to EXPECTED',
    );
  });

  it('finds exactly the routes it expects to have to authenticate for', () => {
    const found = authenticatedTargets()
      .map((target) => target.where)
      .sort();

    assert.deepEqual(
      found,
      [...EXPECTED],
      'the set of authenticated routes has changed. If a route lost its guard, that is the ' +
        'bug; if one was added, add it here too',
    );
  });

  for (const variant of REJECTED) {
    it(`refuses every protected route with ${variant.name}`, async () => {
      const admitted: string[] = [];
      const missing: string[] = [];

      for (const target of authenticatedTargets()) {
        const status = await attempt(target, variant.header);

        // 404 means the URL this suite built does not exist, which is a broken
        // test rather than a passing one — collected separately so the failure
        // says which of the two it is.
        if (status === 404) missing.push(target.where);
        else if (status !== 401) admitted.push(`${target.where} → ${status}`);
      }

      assert.deepEqual(
        missing,
        [],
        `these URLs did not resolve, so nothing was proved about them (${variant.why})`,
      );
      assert.deepEqual(admitted, [], `these routes did not answer 401 (${variant.why})`);
    });
  }
});

describe('the anonymous surface', () => {
  /*
   * The other direction. Every route above is refused without a token; these three
   * have to work without one, or nobody can create the first account or sign in.
   *
   * Asserted as "not 401" rather than as a specific status: with no database
   * reachable, `/signup-allowed` fails at its first query and the two POSTs are
   * refused by validation for having an empty body. Both are fine. What matters is
   * that authentication is not what stopped them — a `router.use(requireAuth)`
   * added to `authRouter` would lock every account out of the product, and it
   * would look like a tidy-up in review.
   */
  const OPEN = [
    { method: 'GET', url: '/auth/signup-allowed' },
    { method: 'POST', url: '/auth/login' },
    { method: 'POST', url: '/auth/signup' },
  ];

  for (const route of OPEN) {
    it(`lets ${route.method} ${route.url} through without a token`, async () => {
      const status = await attempt({ ...route, where: `${route.method} ${route.url}` }, undefined);

      assert.notEqual(status, 401, `${route.method} ${route.url} requires a token`);
      assert.notEqual(status, 404, `${route.method} ${route.url} does not exist`);
    });
  }

  it('leaves the health probe open and unauthenticated', async () => {
    // Deliberately outside /api and ahead of the limiter in app.ts: a probe that
    // needs a credential, or that can be rate-limited, cannot be used by the thing
    // that decides whether to restart the container.
    const response = await fetch(`${origin}/health`);

    assert.equal(response.status, 200);
  });
});
