import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { createLog, deleteLog, getAllLogs, getLogById, updateLog } from '../services/log.service.js';

/** Replaces cyber.wissen.controller.LogController. Mounted at /api. */
export const logsRouter = Router();

logsRouter.use(requireAuth);

const idSchema = z.coerce.number().int().positive();

const logSchema = z.object({
  timestamp: z.coerce.date().optional(),
  sourceip: z.string().trim().min(1, 'sourceip is required').max(200),
  sourcemac: z.string().trim().max(2000).nullish(),
  destinationip: z.string().trim().min(1, 'destinationip is required').max(200),
  destinationmac: z.string().trim().max(2000).nullish(),
  protocol: z.string().trim().min(1, 'protocol is required').max(100),
  ipversion: z.string().trim().max(100).nullish(),
  details: z.string().min(1, 'details is required'),
});

function parseId(raw: string | undefined): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'id must be a positive integer');
  return parsed.data;
}

function parseBody(body: unknown) {
  const parsed = logSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

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
