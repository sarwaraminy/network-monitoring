import type { Request } from 'express';
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { recentAlertsForMatching } from '../services/alert.service.js';
import {
  createSuppression,
  deleteSuppression,
  getSuppression,
  listSuppressions,
  type SuppressionInput,
  updateSuppression,
} from '../services/suppression.service.js';
import { SuppressionSet } from '../services/suppression-rules.js';
import {
  hasSuppressionCriterion,
  NO_CRITERIA,
  parseId,
  parseOrThrow,
  suppressionCreateSchema,
  suppressionPreviewSchema,
  suppressionUpdateSchema,
} from './validation.js';

/**
 * Suppression rules — "yes, I know, that one is expected". Mounted at
 * /api/suppressions.
 *
 * Reading is open to any authenticated user, on the same reasoning as the alert
 * list: someone who can see every finding on the network can see which of them
 * are being ignored, and hiding the second from them would be worse — a rule
 * nobody but an administrator can read is a rule nobody audits.
 *
 * Writing is ADMIN-only, because a suppression rule is the one piece of
 * configuration in this application that can make the tool go quiet. That is also
 * why `POST /preview` exists and is *not* restricted: it changes nothing, and it
 * turns "I think this covers the scanner" into a number before the rule is saved.
 */
export const suppressionsRouter = Router();

suppressionsRouter.use(requireAuth);

/** Who to record against a rule. Same form the alert acknowledgement uses. */
function actor(req: Request): string {
  return req.user?.email ?? `user:${req.user?.id ?? 'unknown'}`;
}

/** GET /api/suppressions — every rule, with the ones that cannot work flagged. */
suppressionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await listSuppressions());
  }),
);

/**
 * POST /api/suppressions/preview — what a rule would have hidden.
 *
 * The point of the whole endpoint is the `occurrences` total rather than the row
 * count. Three alerts can carry twelve thousand observations between them, and
 * "this rule covers 3 of your last 500 alerts" reads as trivial while describing
 * the bulk of the noise on the network. Reporting both, next to the window that
 * was examined, is what makes a zero interpretable: no match over four hours of
 * alerts means something different from no match over four months.
 */
suppressionsRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(suppressionPreviewSchema, req.body);

    // Matched through the same SuppressionSet that does the dropping, not a
    // reimplementation — a preview of different logic is a preview of nothing.
    const candidate = new SuppressionSet([
      {
        id: 1,
        kind: body.kind ?? null,
        sourceCidr: body.sourceCidr ?? null,
        targetCidr: body.targetCidr ?? null,
        port: body.port ?? null,
        enabled: true,
        expiresAt: null,
      },
    ]);

    const examined = await recentAlertsForMatching(body.limit);
    const matched = examined.filter((alert) => candidate.match(alert) !== null);

    res.json({
      examined: examined.length,
      matched: matched.length,
      occurrences: matched.reduce((total, alert) => total + alert.occurrences, 0),
      // Oldest and newest of what was examined, so the operator knows how much
      // history the answer covers.
      window:
        examined.length > 0
          ? {
              from: examined[examined.length - 1]!.lastSeen.toISOString(),
              to: examined[0]!.lastSeen.toISOString(),
            }
          : null,
      samples: matched.slice(0, 10).map((alert) => ({
        id: alert.id,
        kind: alert.kind,
        severity: alert.severity,
        sourceIp: alert.sourceIp,
        targetIp: alert.targetIp,
        port: alert.port,
        occurrences: alert.occurrences,
        lastSeen: alert.lastSeen.toISOString(),
      })),
    });
  }),
);

/** POST /api/suppressions — creates a rule. It takes effect before this answers. */
suppressionsRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(suppressionCreateSchema, req.body);

    const created = await createSuppression(
      {
        kind: body.kind ?? null,
        sourceCidr: body.sourceCidr ?? null,
        targetCidr: body.targetCidr ?? null,
        port: body.port ?? null,
        reason: body.reason,
        enabled: body.enabled,
        expiresAt: body.expiresAt ?? null,
      },
      actor(req),
    );

    res.status(201).json(created);
  }),
);

/**
 * PATCH /api/suppressions/:id — partial update.
 *
 * The patch is merged over the stored row and the *result* is checked, which is
 * the only place the "at least one criterion" rule can be enforced: clearing the
 * only criterion of a rule must fail, clearing one of two must not, and the patch
 * on its own cannot tell those apart. Omitting a field leaves it; sending null
 * clears it.
 */
suppressionsRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const patch = parseOrThrow(suppressionUpdateSchema, req.body);

    const existing = await getSuppression(id);
    if (!existing) throw new HttpError(404, `No suppression rule with id ${id}`);

    const merged: SuppressionInput = {
      kind: patch.kind === undefined ? existing.kind : patch.kind,
      sourceCidr: patch.sourceCidr === undefined ? existing.sourceCidr : patch.sourceCidr,
      targetCidr: patch.targetCidr === undefined ? existing.targetCidr : patch.targetCidr,
      port: patch.port === undefined ? existing.port : patch.port,
      reason: patch.reason ?? existing.reason,
      // `??`, not `||`: switching a rule off sends `false`, which is exactly the
      // value a truthiness check would discard.
      enabled: patch.enabled ?? existing.enabled,
      expiresAt: patch.expiresAt === undefined ? existing.expiresAt : patch.expiresAt,
    };

    if (!hasSuppressionCriterion(merged)) throw new HttpError(400, NO_CRITERIA);

    const updated = await updateSuppression(id, merged);
    if (!updated) throw new HttpError(404, `No suppression rule with id ${id}`);
    res.json(updated);
  }),
);

/**
 * DELETE /api/suppressions/:id
 *
 * Deleting discards the match count with the rule, which is the record of what it
 * hid. Switching a rule off with PATCH keeps both, and that is what the UI offers
 * first; this exists for rules created by mistake.
 */
suppressionsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await deleteSuppression(id))) throw new HttpError(404, `No suppression rule with id ${id}`);
    res.status(204).send();
  }),
);
