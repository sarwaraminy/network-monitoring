import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { getAllLogs } from '../services/log.service.js';

/** Replaces cyber.wissen.controller.LogController. Mounted at /api. */
export const logsRouter = Router();

logsRouter.use(requireAuth);

const listLogs = asyncHandler(async (_req, res) => {
  res.json(await getAllLogs());
});

// POST is what the original exposed; GET is the same data for new callers.
logsRouter.post('/logs', listLogs);
logsRouter.get('/logs', listLogs);

/*
 * There is nothing else here, and that is the point.
 *
 * `logs` is the pre-`alerts` table: one row per suspicious packet, kept because
 * the history in it is why the table still exists. Nothing in this application
 * has written to it since the detectors started writing `alerts` instead — no
 * service, no scheduler, no CLI — and nothing in the interface ever called the
 * three write endpoints that used to sit below (`POST /log/add`, `PUT /log/:id`,
 * `DELETE /log/:id`).
 *
 * They were an unauthenticated hole first, then an authenticated one, then
 * ADMIN-only and audited. Each round made the guard better while leaving the
 * question unasked: rows in this table are a record of what was observed on the
 * network, and an endpoint that can add a fabricated one or rewrite one exists
 * only so that it can be protected. Removing it removes the surface instead, which
 * is the one change no later mistake can undo — a guard can be dropped in a
 * refactor, and a route that is not there cannot be.
 *
 * The `GET` stays, and so does everything the rows hold. What is gone is the
 * ability to change them from outside the database.
 *
 * The `log.create`, `log.update` and `log.delete` audit actions are NOT gone: see
 * `RETIRED_AUDIT_ACTIONS` in services/audit-types.ts. The trail cannot be pruned,
 * so any row those endpoints wrote is still there and still has to be readable.
 */
