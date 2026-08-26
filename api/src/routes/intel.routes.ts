import { Router } from 'express';
import { intel } from '../intel/registry.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';

/**
 * Threat-intelligence status. Mounted at /api/intel.
 *
 * The per-feed breakdown is the point. A feed that has quietly been serving an
 * empty file, or falling back to a months-old cache, looks exactly like a healthy
 * one from a total count — and a detector that silently stopped matching is worse
 * than one that was never enabled, because it looks like coverage.
 */
export const intelRouter = Router();

intelRouter.use(requireAuth);

/** GET /api/intel/status — what is loaded, from where, and how fresh. */
intelRouter.get('/status', (_req, res) => {
  res.json(intel().status());
});

/**
 * POST /api/intel/reload — re-read every feed now.
 *
 * Admin-only: it causes outbound requests to third parties on demand. Useful
 * after changing INTEL_FEEDS, or when an advisory lands and waiting for the
 * refresh interval is not acceptable.
 */
intelRouter.post(
  '/reload',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const result = await intel().reload();
    if (!result) {
      res.status(503).json({ message: 'Reload failed and no previous load was available.' });
      return;
    }
    res.json({
      loadedAt: result.loadedAt.toISOString(),
      indicators: result.set.size,
      sources: result.sources,
    });
  }),
);
