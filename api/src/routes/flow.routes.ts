import { Router } from 'express';
import { flowCollector, restartFlowCollector } from '../flow/collector.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { actorOf } from '../services/audit.service.js';
import { flowForApi, flowPinnedFields } from '../services/flow-settings.js';
import { currentFlowResolution, saveFlowSettings } from '../services/flow-settings.service.js';
import { flowSettingsPatchSchema, parseOrThrow } from './validation.js';

/**
 * Flow collector status and settings. Mounted at /api/flow.
 *
 * **No start/stop endpoint, and that is still true.** The collector's lifetime is
 * the process's — it is infrastructure, driven by whether exporters are
 * configured to send to it, not something a user starts and stops like a packet
 * capture. A button for it would invite silently switching security telemetry
 * off for an afternoon and forgetting.
 *
 * `PUT /settings` is not that button. It writes a stored setting that survives a
 * restart and is recorded in the audit trail, which is the difference between
 * changing how this installation is configured and toggling a running process.
 * The socket is reopened as a consequence of the setting, not as the request's
 * purpose.
 */
export const flowRouter = Router();

flowRouter.use(requireAuth);

/**
 * GET /api/flow/status — is anything arriving, from where, and is it parseable.
 *
 * The per-exporter breakdown is the point. "Configured but receiving nothing" and
 * "receiving but every record is awaiting a template" are the two failure modes
 * during setup, and they are indistinguishable from a single total.
 */
flowRouter.get('/status', (_req, res) => {
  res.json(flowCollector().getStatus());
});

/**
 * GET /api/flow/settings — every field with its provenance.
 *
 * Not admin-only, matching `/status` above and this router's declared posture:
 * how the collector is configured is not privileged, and there is no credential
 * among these — flow is unauthenticated, which is why the allowlist exists at
 * all. The write below is the gated half.
 */
flowRouter.get('/settings', (_req, res) => {
  const resolution = currentFlowResolution();
  res.json({ settings: flowForApi(resolution), pinned: flowPinnedFields(resolution) });
});

/**
 * PUT /api/flow/settings — changes them, and rebinds if it has to.
 *
 * A field the environment pins is refused rather than silently ignored: writing
 * the row for a value that can never take effect would leave the interface
 * showing a saved setting the collector does not use.
 */
flowRouter.put(
  '/settings',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const patch = parseOrThrow(flowSettingsPatchSchema, req.body);
    const pinned = flowPinnedFields(currentFlowResolution());
    const refused = Object.keys(patch).filter((field) => pinned.includes(field as never));

    if (refused.length > 0) {
      // 409, and the message names the variables: the remedy is to remove them
      // from the environment, which is something the reader can act on.
      throw HttpError.of(409, 'error.flow_pinned', {
        variables: refused
          .map((field) => flowForApi(currentFlowResolution())[field]?.env ?? field)
          .join(', '),
      });
    }

    const saved = await saveFlowSettings(patch, actorOf(req.user));

    /*
     * The rebind is awaited, so the status this answers with is the truth about
     * what happened rather than a guess made before the socket settled. It never
     * rejects — a port that cannot be bound is reported as `listening: false`,
     * which is a real outcome of a successful save rather than a failed request:
     * the row was written and is what the next boot will use.
     */
    if (saved.needsRebind) await restartFlowCollector();

    res.json({
      settings: flowForApi(currentFlowResolution()),
      pinned: flowPinnedFields(currentFlowResolution()),
      rebound: saved.needsRebind,
      status: flowCollector().getStatus(),
    });
  }),
);
