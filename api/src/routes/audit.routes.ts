import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { AUDIT_ACTIONS, listAuditEvents } from '../services/audit.service.js';
import { auditQuerySchema } from './validation.js';

/**
 * The audit trail, read-only. Mounted at /api/audit.
 *
 * Read-only is not a limitation of this router, it is the whole design: the table
 * refuses UPDATE, DELETE and TRUNCATE at the database level, so there is nothing a
 * write endpoint could do. See V9__Audit_trail.sql.
 *
 * ADMIN for reading, which is a trade-off rather than an obvious call. A trail
 * visible only to the people it holds accountable is weaker than one everybody can
 * see — but these rows name accounts, say which delivery fields were changed, and
 * describe findings that were deleted, and with two roles in this system the
 * alternative is exposing all of that to every account. Making it visible to a
 * third party is a job for exporting it somewhere append-only, not for widening the
 * read here.
 */
export const auditRouter = Router();

auditRouter.use(requireAuth);
// The whole router, not per route: every path here reads the record of what people
// did, and a read endpoint added later should inherit the gate rather than have to
// remember it.
auditRouter.use(requireRole('ADMIN'));

/**
 * GET /api/audit
 *
 * Most recent first. `action` filters, `before` pages — keyset rather than offset,
 * because the trail only grows at the head and an offset walks through rows it has
 * already returned.
 */
auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const { limit, action, before } = parsed.data;
    res.json(
      await listAuditEvents({
        limit,
        ...(action ? { action } : {}),
        ...(before ? { before } : {}),
      }),
    );
  }),
);

/**
 * GET /api/audit/actions
 *
 * The vocabulary and its labels, so the filter in the UI is built from the same
 * list the server validates against instead of a second copy that can drift.
 */
auditRouter.get('/actions', (_req, res) => {
  res.json(Object.entries(AUDIT_ACTIONS).map(([action, label]) => ({ action, label })));
});
