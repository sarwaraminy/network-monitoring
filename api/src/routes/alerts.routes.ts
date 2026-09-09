import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import {
  acknowledgeAlert,
  dashboardData,
  deleteAlert,
  deleteAllAlerts,
  listAlerts,
  listSensors,
  summarizeAlerts,
  unacknowledgeAlert,
} from '../services/alert.service.js';
import { trendBucketFor } from '../services/alert-buckets.js';
import { actorOf } from '../services/audit.service.js';
import { forgetDevice, listKnownDevices } from '../services/device.service.js';
import {
  alertDashboardQuerySchema,
  alertListQuerySchema,
  idSchema,
  parseSince,
  sensorIdSchema,
} from './validation.js';

/** Security findings raised by the detectors. Mounted at /api/alerts. */
export const alertsRouter = Router();

alertsRouter.use(requireAuth);

/** GET /api/alerts */
alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = alertListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw HttpError.of(400, 'error.validation', {
        detail: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    const { severity, kind, sensor, since, acknowledged, limit, offset } = parsed.data;

    res.json(
      await listAlerts({
        ...(severity ? { severity } : {}),
        ...(kind ? { kind } : {}),
        ...(sensor ? { sensor } : {}),
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

/** GET /api/alerts/summary?sensor= — counts for the dashboard tiles. */
alertsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const sensor = sensorIdSchema.optional().safeParse(req.query.sensor);
    if (!sensor.success) {
      throw HttpError.of(400, 'error.validation', {
        detail: sensor.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    res.json(await summarizeAlerts(sensor.data));
  }),
);

/**
 * GET /api/alerts/sensors — which sensors have written findings here.
 *
 * Not admin-only: it names the installations sharing this database, which is less
 * than the alert list already hands every authenticated user — every row there
 * carries its sensor. Gating it would leave the sensor column populated and the
 * filter that explains it empty.
 */
alertsRouter.get(
  '/sensors',
  asyncHandler(async (_req, res) => {
    res.json(await listSensors());
  }),
);

/** GET /api/alerts/dashboard?days=&bucket= — summary plus trend and top sources. */
alertsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const parsed = alertDashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw HttpError.of(400, 'error.validation', {
        detail: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    const { days, sensor } = parsed.data;
    // `trendBucketFor` picks the width from the window; see it for the bar-count
    // reasoning. An explicit `?bucket=` still wins, for a caller that wants one.
    const bucket = parsed.data.bucket ?? trendBucketFor(days);
    res.json(await dashboardData({ days, bucket, ...(sensor ? { sensor } : {}) }));
  }),
);

/** GET /api/alerts/devices?sensor= — MAC addresses seen on the network. */
alertsRouter.get(
  '/devices',
  asyncHandler(async (req, res) => {
    const sensor = sensorIdSchema.optional().safeParse(req.query.sensor);
    if (!sensor.success) {
      throw HttpError.of(400, 'error.validation', {
        detail: sensor.error.issues.map((issue) => issue.message).join('; '),
      });
    }
    res.json(await listKnownDevices(sensor.data));
  }),
);

/**
 * DELETE /api/alerts/devices/:mac?sensor= — forgets a device, so it is reported as
 * new again. Useful after investigating one, and for resetting a demo.
 *
 * `sensor` picks the row when more than one sensor has seen the address. Omitting
 * it no longer means "this sensor": that default disagreed with `GET /devices`
 * beside it, which returns every sensor's rows — so a client that read the list and
 * posted a MAC back, which is the obvious way to write one, deleted a row it had
 * never seen or got a 404 for a MAC plainly in the list. `forgetDevice` now resolves
 * the holder instead, and refuses rather than guesses when there are several.
 */
alertsRouter.delete(
  '/devices/:mac',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const mac = req.params.mac ?? '';
    if (!/^[0-9a-fA-F:]{11,32}$/.test(mac)) {
      throw HttpError.of(400, 'error.invalid_mac');
    }
    const sensor = sensorIdSchema.optional().safeParse(req.query.sensor);
    if (!sensor.success) {
      throw HttpError.of(400, 'error.validation', {
        detail: sensor.error.issues.map((issue) => issue.message).join('; '),
      });
    }

    const result = await forgetDevice(mac, actorOf(req.user), sensor.data);

    if (result.outcome === 'not-found') throw HttpError.of(404, 'error.device_not_found', { mac });
    if (result.outcome === 'wrong-sensor') {
      /*
       * Still a 404 — that row genuinely does not exist — but the message says
       * which of the two possible mistakes this was. "No known device aa:bb:cc" is
       * false for an address the device list is showing on another sensor, and it
       * points at nothing the caller could change; the sensor is the one thing
       * they could.
       */
      throw HttpError.of(404, 'error.device_not_on_sensor', {
        mac,
        // `wrong-sensor` is only ever produced when a sensor was named, so this is
        // always present; the schema types it optional because the query parameter
        // is. The old template interpolated it directly and would have printed the
        // word "undefined" if that invariant ever broke.
        sensor: sensor.data ?? '',
        sensors: result.sensors.join(', '),
      });
    }
    if (result.outcome === 'ambiguous') {
      // 400 rather than a guess: naming one of them is the caller's decision, and
      // the message says which names are available so the retry is one edit away.
      throw HttpError.of(400, 'error.device_ambiguous', {
        mac,
        sensors: result.sensors.join(', '),
      });
    }

    res.status(204).send();
  }),
);

/** POST /api/alerts/:id/acknowledge */
alertsRouter.post(
  '/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw HttpError.of(400, 'error.invalid_id');

    const updated = await acknowledgeAlert(id.data, actorOf(req.user));
    if (!updated) throw HttpError.of(404, 'error.alert_not_found', { id: String(id.data) });
    res.json(updated);
  }),
);

/** POST /api/alerts/:id/unacknowledge */
alertsRouter.post(
  '/:id/unacknowledge',
  asyncHandler(async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw HttpError.of(400, 'error.invalid_id');

    const updated = await unacknowledgeAlert(id.data, actorOf(req.user));
    if (!updated) throw HttpError.of(404, 'error.alert_not_found', { id: String(id.data) });
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
    if (!id.success) throw HttpError.of(400, 'error.invalid_id');

    if (!(await deleteAlert(id.data, actorOf(req.user)))) {
      throw HttpError.of(404, 'error.alert_not_found', { id: String(id.data) });
    }
    res.status(204).send();
  }),
);

/** DELETE /api/alerts — clears the table. Admin only, since history is lost. */
alertsRouter.delete(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ deleted: await deleteAllAlerts(actorOf(req.user)) });
  }),
);
