import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { createLog, deleteLog, getAllLogs, getLogById, updateLog } from '../services/log.service.js';
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
    const created = await createLog(parseBody(req.body));
    res.status(201).json(created);
  }),
);

/** PUT /api/log/:id */
logsRouter.put(
  '/log/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await getLogById(id))) {
      throw new HttpError(404, `No log with id ${id}`);
    }
    // The Java version passed the body straight to save(), so a mismatched body id
    // could overwrite a different row. The path id wins here.
    const updated = await updateLog(id, parseBody(req.body));
    res.json(updated);
  }),
);

/** DELETE /api/log/:id */
logsRouter.delete(
  '/log/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await getLogById(id))) {
      throw new HttpError(404, `No log with id ${id}`);
    }
    await deleteLog(id);
    res.status(204).send();
  }),
);
