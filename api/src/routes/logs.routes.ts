import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { actorOf } from '../services/audit.service.js';
import { createLog, deleteLog, getAllLogs, updateLog } from '../services/log.service.js';
import { logSchema, parseId, parseOrThrow } from './validation.js';

/** Replaces cyber.wissen.controller.LogController. Mounted at /api. */
export const logsRouter = Router();

logsRouter.use(requireAuth);

const parseBody = (body: unknown) => parseOrThrow(logSchema, body);

const listLogs = asyncHandler(async (_req, res) => {
  res.json(await getAllLogs());
});

// POST is what the original exposed; GET is the same data for new callers.
logsRouter.post('/logs', listLogs);
logsRouter.get('/logs', listLogs);

/*
 * The three writes below are ADMIN.
 *
 * `logs` is the pre-`alerts` table: one row per suspicious packet, kept for the
 * views that still read it. Rows in it are a record of what was observed on the
 * network, and until this gate existed any authenticated account could add a
 * fabricated one, rewrite one, or delete one — a signed-in user could edit the
 * evidence. Reading stays open to everyone, which is the point of keeping it.
 */

/** POST /api/log/add */
logsRouter.post(
  '/log/add',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const created = await createLog(parseBody(req.body), actorOf(req.user));
    res.status(201).json(created);
  }),
);

/**
 * PUT /api/log/:id
 *
 * `updateLog`'s own return is the existence check, not a `getLogById` call
 * beforehand — that would only narrow the race, not close it: `updateLog` locks
 * the row and can still find it gone (deleted between the two), returning `null`
 * for exactly that case. Checking a pre-fetch instead of this return value would
 * report success — and, since this PR added it, an audited change — for a write
 * that never happened, the same gap `alerts.routes.ts` and `suppressions.routes.ts`
 * already close by checking their own service calls' return values directly.
 */
logsRouter.put(
  '/log/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    // The Java version passed the body straight to save(), so a mismatched body id
    // could overwrite a different row. The path id wins here.
    const updated = await updateLog(id, parseBody(req.body), actorOf(req.user));
    if (!updated) throw new HttpError(404, `No log with id ${id}`);
    res.json(updated);
  }),
);

/** DELETE /api/log/:id — see the PUT handler above for why this checks `deleteLog`'s own return rather than pre-fetching. */
logsRouter.delete(
  '/log/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await deleteLog(id, actorOf(req.user)))) {
      throw new HttpError(404, `No log with id ${id}`);
    }
    res.status(204).send();
  }),
);
