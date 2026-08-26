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
    const outcome = await intel().reload();

    if (outcome.status === 'loaded') {
      res.json({
        status: 'loaded',
        loadedAt: outcome.result.loadedAt.toISOString(),
        indicators: outcome.result.set.size,
        sources: outcome.result.sources,
      });
      return;
    }

    // Everything below left the previously loaded set in place. Saying so
    // explicitly matters: answering 200 with the old `loadedAt` would look
    // identical to a successful refresh, and this endpoint exists precisely so
    // an operator can tell whether their feeds are current.
    res.status(outcome.status === 'already-running' ? 409 : 503).json({
      status: outcome.status,
      message:
        outcome.status === 'already-running'
          ? 'A reload is already in progress; the indicators below are from the previous load.'
          : 'Reload did not produce a usable set. The previously loaded indicators are still in use.',
      ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
      ...(outcome.status === 'kept-previous' ? { attempted: outcome.attempted } : {}),
      previous: outcome.previous
        ? {
            loadedAt: outcome.previous.loadedAt.toISOString(),
            indicators: outcome.previous.set.size,
            sources: outcome.previous.sources,
          }
        : null,
    });
  }),
);
