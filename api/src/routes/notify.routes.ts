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
      ? {
          configured: true,
          // Honours an explicit NOTIFY_WEBHOOK_FORMAT. Reporting detectFormat()
          // unconditionally would show the inferred shape while the channel
          // actually posts the overridden one — the opposite of what a setup
          // check is for.
          format:
            env.notify.webhookFormat === 'auto'
              ? detectFormat(env.notify.webhookUrl)
              : env.notify.webhookFormat,
        }
      : { configured: false, format: null },
    email: {
      // Same predicate as EmailChannel.isConfigured(), `from` included. Omitting
      // it reported `configured: true` next to `channels: []` and `active: false`
      // whenever NOTIFY_EMAIL_FROM was unset, which is exactly the misconfigured
      // state this endpoint exists to reveal.
      configured:
        env.notify.email.host.trim() !== '' &&
        env.notify.email.from.trim() !== '' &&
        env.notify.email.to.length > 0,
      recipients: env.notify.email.to.length,
    },
    /*
     * Reported in full, unlike the webhook URL.
     *
     * A webhook URL is a bearer credential for Slack and Teams, so it is withheld
     * from a response any authenticated user can read. A syslog target is a host
     * and a port on your own network and carries no secret, and the question this
     * endpoint exists to answer — "is it pointed at the right collector?" — cannot
     * be answered without them.
     */
    /*
     * `exporting` is separate from the top-level `active` on purpose.
     *
     * `active` is `NOTIFY_ENABLED && some channel configured`, and syslog ignores
     * that flag by design. So with NOTIFY_ENABLED off and SYSLOG_HOST set, this
     * endpoint answered `active: false` while every finding was going to the
     * collector — an operator reading that concludes nothing is leaving the host,
     * and for the one channel that ignores the master switch, that is wrong.
     */
    syslog: env.notify.syslog.host
      ? {
          configured: true,
          exporting: notifier().exporting,
          target: `${env.notify.syslog.host}:${env.notify.syslog.port}`,
          protocol: env.notify.syslog.protocol,
          format: env.notify.syslog.format,
          rfc: env.notify.syslog.rfc,
          includeEvidence: env.notify.syslog.includeEvidence,
        }
      : {
          configured: false,
          exporting: false,
          target: null,
          protocol: env.notify.syslog.protocol,
          format: env.notify.syslog.format,
          rfc: env.notify.syslog.rfc,
          includeEvidence: env.notify.syslog.includeEvidence,
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
          'No delivery channel is configured. Set NOTIFY_WEBHOOK_URL, SYSLOG_HOST, or SMTP_HOST with NOTIFY_EMAIL_TO.',
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
