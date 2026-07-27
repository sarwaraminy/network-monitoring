import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { notifier } from '../notify/notifier.js';
import { detectFormat } from '../notify/webhook.js';

/**
 * Alert delivery status and a test send. Mounted at /api/notify.
 *
 * The test endpoint is the point of this router. Notification config fails silently
 * by nature — a wrong webhook URL or SMTP password produces no error anyone sees
 * until the night an alert does not arrive. Being able to prove delivery during
 * setup is the difference between configured and working.
 */
export const notifyRouter = Router();

notifyRouter.use(requireAuth);

/** GET /api/notify/status — what is configured and what has been sent. */
notifyRouter.get('/status', (_req, res) => {
  const stats = notifier().stats();

  res.json({
    enabled: env.notify.enabled,
    active: notifier().active,
    channels: stats.channels,
    minSeverity: env.notify.minSeverity,
    digestSeconds: env.notify.digestMs / 1000,
    throttleSeconds: env.notify.throttleMs / 1000,
    maxPerHour: env.notify.maxPerHour,
    includeEvidence: env.notify.includeEvidence,
    queued: stats.queued,
    sentLastHour: stats.sentLastHour,
    throttledKeys: stats.throttleKeys,
    // Never the URL itself: it is a bearer secret for Slack and Teams, and this
    // response is readable by any authenticated user.
    webhook: env.notify.webhookUrl
      ? { configured: true, format: detectFormat(env.notify.webhookUrl) }
      : { configured: false, format: null },
    email: {
      configured: env.notify.email.host !== '' && env.notify.email.to.length > 0,
      recipients: env.notify.email.to.length,
    },
  });
});

/**
 * POST /api/notify/test — sends a test message to every configured channel.
 *
 * Admin-only. It causes outbound traffic to a third party and would otherwise be a
 * way for any account to make the server send messages on demand.
 */
notifyRouter.post(
  '/test',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    if (notifier().configuredChannels.length === 0) {
      res.status(400).json({
        message:
          'No delivery channel is configured. Set NOTIFY_WEBHOOK_URL, or SMTP_HOST with NOTIFY_EMAIL_TO.',
      });
      return;
    }

    // Deliberately bypasses NOTIFY_ENABLED and every gate: the question being
    // answered is "can this reach you", and requiring the feature to be switched on
    // first makes it useless for checking config before you commit to it.
    const results = await notifier().sendTest();
    const delivered = results.filter((result) => result.ok).length;

    res.status(delivered > 0 ? 200 : 502).json({
      delivered,
      attempted: results.length,
      results,
    });
  }),
);
