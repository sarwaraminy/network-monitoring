import { Router } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { adhocReady, assertRunnable, runAdhocQuery } from '../services/adhoc.service.js';
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
    res.json({ enabled: adhocReady() });
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
    const sql = assertRunnable((req.body as { sql?: unknown }).sql);
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
