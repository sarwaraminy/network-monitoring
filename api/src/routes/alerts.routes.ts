import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import {
  acknowledgeAlert,
  dashboardData,
  deleteAlert,
  deleteAllAlerts,
  listAlerts,
  summarizeAlerts,
  unacknowledgeAlert,
} from '../services/alert.service.js';
import { forgetDevice, listKnownDevices } from '../services/device.service.js';
import { alertDashboardQuerySchema, alertListQuerySchema, idSchema, parseSince } from './validation.js';

/** Security findings raised by the detectors. Mounted at /api/alerts. */
export const alertsRouter = Router();

alertsRouter.use(requireAuth);

/** GET /api/alerts */
alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = alertListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const { severity, kind, since, acknowledged, limit, offset } = parsed.data;

    res.json(
      await listAlerts({
        ...(severity ? { severity } : {}),
        ...(kind ? { kind } : {}),
        ...(acknowledged === undefined ? {} : { acknowledged }),
        ...((): { since?: Date } => {
          const parsedSince = parseSince(since);
          return parsedSince ? { since: parsedSince } : {};
        })(),
        limit,
        offset,
      }),
    );
  }),
);

/** GET /api/alerts/summary — counts for the dashboard tiles. */
alertsRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    res.json(await summarizeAlerts());
  }),
);

/** GET /api/alerts/dashboard?days=&bucket= — summary plus trend and top sources. */
alertsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const parsed = alertDashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const { days } = parsed.data;
    // Hourly buckets are only readable over a short window.
    const bucket = parsed.data.bucket ?? (days <= 2 ? 'hour' : 'day');
    res.json(await dashboardData({ days, bucket }));
  }),
);

/** GET /api/alerts/devices — MAC addresses seen on the network. */
alertsRouter.get(
  '/devices',
  asyncHandler(async (_req, res) => {
    res.json(await listKnownDevices());
  }),
);

/**
 * DELETE /api/alerts/devices/:mac — forgets a device, so it is reported as new
 * again. Useful after investigating one, and for resetting a demo.
 */
alertsRouter.delete(
  '/devices/:mac',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const mac = req.params.mac ?? '';
    if (!/^[0-9a-fA-F:]{11,32}$/.test(mac)) {
      throw new HttpError(400, 'mac must be a MAC address');
    }
    if (!(await forgetDevice(mac))) throw new HttpError(404, `No known device ${mac}`);
    res.status(204).send();
  }),
);

/** POST /api/alerts/:id/acknowledge */
alertsRouter.post(
  '/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'id must be a positive integer');

    const who = req.user?.email ?? `user:${req.user?.id ?? 'unknown'}`;
    const updated = await acknowledgeAlert(id.data, who);
    if (!updated) throw new HttpError(404, `No alert with id ${id.data}`);
    res.json(updated);
  }),
);

/** POST /api/alerts/:id/unacknowledge */
alertsRouter.post(
  '/:id/unacknowledge',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'id must be a positive integer');

    const updated = await unacknowledgeAlert(id.data);
    if (!updated) throw new HttpError(404, `No alert with id ${id.data}`);
    res.json(updated);
  }),
);

/**
 * DELETE /api/alerts/:id
 *
 * ADMIN, like the two deletes around it. This was the odd one out: clearing the
 * whole table required an administrator and forgetting a device required one, while
 * deleting findings individually was open to any signed-in account — so the gate on
 * the bulk route bought nothing, since the same account could delete the same rows
 * one at a time. On a tool whose output is evidence, removing a finding is not the
 * same kind of act as acknowledging one.
 */
alertsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'id must be a positive integer');

    if (!(await deleteAlert(id.data))) throw new HttpError(404, `No alert with id ${id.data}`);
    res.status(204).send();
  }),
);

/** DELETE /api/alerts — clears the table. Admin only, since history is lost. */
alertsRouter.delete(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json({ deleted: await deleteAllAlerts() });
  }),
);
