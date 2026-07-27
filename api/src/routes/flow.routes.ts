import { Router } from 'express';
import { flowCollector } from '../flow/collector.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Flow collector status. Mounted at /api/flow.
 *
 * Read-only and intentionally so. The collector's lifetime is the process's — it
 * is infrastructure, driven by whether exporters are configured to send to it, not
 * something a user starts and stops like a packet capture. Exposing start/stop
 * would invite a UI button that silently stops collecting security telemetry.
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
