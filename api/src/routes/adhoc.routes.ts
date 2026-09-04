import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { AdhocError, adhocReady, runAdhocQuery } from '../services/adhoc.service.js';
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
    const { sql } = req.body as { sql?: unknown };
    if (typeof sql !== 'string') {
      throw new AdhocError('Send the query as a `sql` string.');
    }

    const actor = actorOf(req.user);
    await recordAudit(db, {
      actor: actor.name,
      actorId: actor.id,
      action: 'adhoc.query',
      detail: { sql },
    });

    const result = await runAdhocQuery(sql);
    res.json(result);
  }),
);
