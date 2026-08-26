import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
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

/** POST /api/log/add */
logsRouter.post(
  '/log/add',
  asyncHandler(async (req, res) => {
    const created = await createLog(parseBody(req.body));
    res.status(201).json(created);
  }),
);

/** PUT /api/log/:id */
logsRouter.put(
  '/log/:id',
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
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await getLogById(id))) {
      throw new HttpError(404, `No log with id ${id}`);
    }
    await deleteLog(id);
    res.status(204).send();
  }),
);
