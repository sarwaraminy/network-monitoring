import { Router } from 'express';
import { env } from '../config/env.js';
import { db, pool } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import {
  adhocReady,
  adhocStatus,
  assertRunnable,
  runAdhocQuery,
  startAdhoc,
} from '../services/adhoc.service.js';
import { actorOf, recordAudit } from '../services/audit.service.js';

/**
 * The Ad Hoc Query console. Mounted at /api/adhoc.
 *
 * ADMIN on the whole router rather than per route, for the reason the audit
 * router gives: a path added later should inherit the gate rather than have to
 * remember it. The stakes are higher here — this one reaches the database
 * directly — so the guard goes as far up as it can.
 *
 * `POST` for a read, which is not the mistake it looks like. The query is the
 * request body: putting SQL in a query string writes it into the access log of
 * every proxy between the browser and this process, and into browser history.
 * Neither is somewhere a `SELECT ... FROM users` belongs, even a permitted one.
 */
export const adhocRouter = Router();

adhocRouter.use(requireAuth);
adhocRouter.use(requireRole('ADMIN'));

/**
 * GET /api/adhoc — whether the console is usable, so the page can say why not.
 *
 * The feature is off by default and refuses to start if its sandbox does not
 * hold, which means "not available" is a normal state rather than a fault. A UI
 * that could not tell the difference would render an editor whose every query
 * answers 503.
 */
adhocRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    /*
     * The whole status, not just the boolean.
     *
     * "Off" is three situations needing three different actions — nobody asked
     * for it, somebody asked without a password, or the database would not
     * confirm the sandbox — and the reasons used to exist only in the boot log.
     * An administrator reading a page that says "not enabled" should not have to
     * go and read logs to find out which one they are in.
     *
     * ADMIN-only by the router's guard, which is what makes it reasonable to
     * report the role name and a sandbox failure's own message here.
     */
    res.json(adhocStatus());
  }),
);

/**
 * POST /api/adhoc/recheck — try the startup provisioning again.
 *
 * For the case an administrator can actually resolve: the environment says the
 * console should be on, but the boot attempt failed — the database was briefly
 * unreachable, or the role had not been created yet, or its grants were wrong and
 * have since been fixed. Without this the only remedy is a restart of the API,
 * which on a monitoring server means dropping a live capture to fix a console.
 *
 * It grants nothing new, and that is deliberate: it re-runs the same
 * `startAdhoc` the boot ran, against the same environment, and `startAdhoc`
 * refuses without `ADHOC_ENABLED` and without a password exactly as it does at
 * startup. There is no request body and nothing to configure — this cannot turn
 * the console on, it can only discover that the environment already did.
 *
 * Refuses while the console is running rather than restarting it. A recheck is
 * for something that is broken, and re-provisioning a working console would
 * interrupt somebody's session to answer a question nobody asked.
 */
adhocRouter.post(
  '/recheck',
  asyncHandler(async (req, res) => {
    if (adhocReady()) {
      res.json(adhocStatus());
      return;
    }

    const before = adhocStatus();
    // The boolean is not read: the status carries the same answer with the reason
    // attached, and a `? :` whose branches were identical said nothing.
    await startAdhoc(pool);
    const status = adhocStatus();

    /*
     * Audited, because it is an administrator action that can change what the
     * server can do — and because a console that came up outside a restart is
     * exactly the kind of state change somebody reading the trail later will want
     * explained. The detail records what it moved from and to rather than the
     * whole status: a sandbox failure's message can be long and is already in the
     * log.
     */
    await recordAudit(db, {
      actor: actorOf(req.user).name,
      actorId: actorOf(req.user).id,
      action: 'adhoc.recheck',
      detail: {
        from: before.reason ?? 'running',
        to: status.reason ?? 'running',
      },
    });

    res.json(status);
  }),
);

/**
 * POST /api/adhoc/query — run one statement, return at most the row cap.
 *
 * Every run is audited BEFORE its result is known, and that ordering is
 * deliberate: the record is of what was asked, which is the thing worth keeping.
 * A query that failed, timed out, or was refused for reading a secret column is
 * exactly as interesting to whoever reads the trail later as one that worked —
 * arguably more so — and auditing only successes would leave the attempts
 * invisible.
 *
 * The SQL itself goes in the detail. That is a deliberate exception to the rule
 * that the trail holds no values: the query text IS the action here, and a row
 * saying "ran a query" without saying which one records nothing worth recording.
 * It cannot contain a secret the console could read, because the role cannot
 * read one.
 */
adhocRouter.post(
  '/query',
  asyncHandler(async (req, res) => {
    /*
     * Validated BEFORE the trail is written, which is a change from the first
     * version and worth the note. Auditing first meant the recorded text was
     * bounded by the 1 MB JSON body limit rather than by `ADHOC_MAX_QUERY_LENGTH`
     * — fifty times the accepted length, on a request that was going to be
     * rejected anyway — and it wrote an `adhoc.query` row for every POST while
     * the console was switched off, so an installation that never enabled the
     * feature still collected entries for it.
     */
    // `req.body?.sql`, not `req.body.sql`. Express 5 with body-parser 2 leaves
    // the body UNDEFINED when no parser matched — a client posting without
    // `Content-Type: application/json` — and the cast tells TypeScript the shape
    // is safe, so nothing flags it. The TypeError is not an `HttpError`, so it
    // took the 500 path: the same generic-500 failure `AdhocError extends
    // HttpError` exists to eliminate, one layer earlier. `assertRunnable`
    // already answers 400 for `undefined`.
    const sql = assertRunnable((req.body as { sql?: unknown } | undefined)?.sql);
    const actor = actorOf(req.user);
    const record = (detail: Record<string, unknown>) =>
      recordAudit(db, { actor: actor.name, actorId: actor.id, action: 'adhoc.query', detail });

    /*
     * `all` audits BEFORE the result is known, which is the ordering that makes
     * the trail a record of what was ASKED rather than of what worked. A query
     * the database refused is at least as interesting as one it answered.
     *
     * `refused` inverts that of necessity — whether it was refused is not known
     * until it has been tried — and accepts the trade: a process that dies
     * mid-query records nothing. Worth stating, because it is the one thing the
     * quieter mode gives up.
     */
    if (env.adhoc.audit === 'all') await record({ sql });

    let result: Awaited<ReturnType<typeof runAdhocQuery>>;
    try {
      result = await runAdhocQuery(sql);
    } catch (error) {
      if (env.adhoc.audit === 'refused') {
        await record({ sql, refused: (error as Error).message });
      }
      throw error;
    }

    res.json(result);
  }),
);
