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
flowRouter.get('/status', (req, res) => {
  const status = flowCollector().getStatus();
  const isAdmin = req.user?.role.toLowerCase() === 'admin';
  if (isAdmin) {
    res.json(status);
    return;
  }

  /*
   * The permitted senders are stripped for a non-admin; the count stays.
   *
   * This allowlist is the collector's only access control — NetFlow
   * authenticates nothing — so the addresses are a precise answer to "what would
   * I have to spoof for forged flow records to be accepted". Whether the
   * collector is listening, and how much it is refusing, are not that.
   *
   * Same decision and same shape as `interrupted.startedBy` two routers along.
   */
  const { allowedExporters: _addresses, ...rest } = status;
  res.json(rest);
});

/**
 * GET /api/flow/settings — every field with its provenance.
 *
 * ADMIN, unlike `/status` above, and the difference is what the two answer.
 * Status says whether collection is working, which is every operator's business.
 * This returns the configuration, `FLOW_EXPORTERS` among it — the allowlist that
 * is the collector's only access control, since NetFlow authenticates nothing.
 * The only thing that reads this is the form under the administration gear,
 * which nobody else can open.
 */
flowRouter.get('/settings', requireRole('ADMIN'), (_req, res) => {
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
     * Rebind when something that needs it moved, OR when the collector is meant
     * to be running and is not.
     *
     * The second half is the retry, and without it the most common failure had
     * no recovery inside this feature at all. `needsRebind` is true only when a
     * socket field actually *changed*, and the form sends only what the
     * administrator edited — so the operator whose port was in use at boot frees
     * it, comes back, presses Save with the correct values already in place, and
     * nothing is sent, nothing is rebound, and the page still says it is not
     * listening. The only way out was restarting the API, which is the shell
     * access this whole feature exists to stop needing.
     *
     * Not a rebind on every save: that would drop whatever is in flight because
     * somebody edited an allowlist. It is specifically "should be listening and
     * is not", which is a state worth acting on however the request got here.
     *
     * Awaited, so the status this answers with is the truth about what happened
     * rather than a guess made before the socket settled. It never rejects — a
     * port that cannot be bound is reported as `listening: false`, which is a
     * real outcome of a successful save rather than a failed request: the row was
     * written and is what the next boot will use.
     */
    const shouldBeListening = currentFlowResolution().enabled.value === true;
    const stalled = shouldBeListening && !flowCollector().getStatus().listening;
    const rebound = saved.needsRebind || stalled;
    if (rebound) await restartFlowCollector();

    res.json({
      settings: flowForApi(currentFlowResolution()),
      pinned: flowPinnedFields(currentFlowResolution()),
      changed: saved.changed,
      rebound,
      status: flowCollector().getStatus(),
    });
  }),
);
