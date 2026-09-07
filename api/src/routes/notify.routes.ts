import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { notifier, reloadNotifier } from '../notify/notifier.js';
import {
  DELIVERY_FIELDS,
  emailBlockedReason,
  environmentPinnedFields,
  isEmailConfigured,
  isWebhookConfigured,
  pinnedConflicts,
} from '../notify/settings.js';
import {
  currentRedactedSettings,
  currentResolution,
  currentSettings,
  saveDeliverySettings,
} from '../notify/settings.service.js';
import type { DeliveryResult } from '../notify/types.js';
import { detectFormat } from '../notify/webhook.js';
import { actorOf } from '../services/audit.service.js';
import { deliverySettingsPatchSchema, parseOrThrow } from './validation.js';

/**
 * Alert delivery: status, settings, and a test send. Mounted at /api/notify.
 *
 * The test endpoint is why this router exists at all. Notification config fails
 * silently by nature — a wrong webhook URL or SMTP password produces no error anyone
 * sees until the night an alert does not arrive — so being able to prove delivery
 * during setup is the difference between configured and working.
 *
 * The settings endpoints exist because the buyer is an IT admin, not the developer.
 * Every one of these values used to require editing a file on the host and
 * restarting, which made each tuning change an outage. See issue #28.
 */
export const notifyRouter = Router();

notifyRouter.use(requireAuth);

/** GET /api/notify/status — what is configured and what has been sent. */
notifyRouter.get('/status', (_req, res) => {
  const stats = notifier().stats();
  // Read from the settings layer, not from `env`. Reporting the environment's view
  // after somebody changed a setting through the form would make this endpoint —
  // the one whose whole purpose is answering "is delivery actually working?" — the
  // least trustworthy thing on the page.
  const settings = currentSettings();

  res.json({
    enabled: settings.enabled,
    active: notifier().active,
    channels: stats.channels,
    minSeverity: settings.minSeverity,
    digestSeconds: settings.digestSeconds,
    throttleSeconds: settings.throttleSeconds,
    maxPerHour: settings.maxPerHour,
    includeEvidence: settings.includeEvidence,
    queued: stats.queued,
    sentLastHour: stats.sentLastHour,
    throttledKeys: stats.throttleKeys,
    // Never the URL itself: it is a bearer secret for Slack and Teams, and this
    // response is readable by any authenticated user.
    //
    // isWebhookConfigured/isEmailConfigured (settings.ts) are the same predicates
    // buildChannels (notifier.ts) uses to decide whether a channel exists at all,
    // and redactForApi uses for the identical fields on GET /settings — sharing
    // them is what keeps this endpoint from independently drifting from either,
    // which it has already done once for each field.
    webhook: isWebhookConfigured(settings)
      ? {
          configured: true,
          // Honours an explicit format. Reporting the inferred shape while the
          // channel posts the overridden one is the opposite of what a setup check
          // is for.
          format:
            settings.webhookFormat === 'auto' ? detectFormat(settings.webhookUrl) : settings.webhookFormat,
        }
      : { configured: false, format: null },
    email: {
      configured: isEmailConfigured(settings),
      recipients: settings.emailTo.length,
      /*
       * Why not, when not — because the page that reads this has one standing
       * sentence for an unconfigured mailbox ("SMTP host, sender and at least one
       * recipient"), and for an OAuth2 mailbox missing its refresh token those three
       * are exactly what the operator has already set. Widening `isEmailConfigured`
       * without this would have moved the problem rather than removed it: the
       * channel stops claiming to be ready and starts naming the wrong cause, on the
       * same screen either way.
       */
      reason: emailBlockedReason(settings),
    },
    /*
     * Reported in full, unlike the webhook URL.
     *
     * A webhook URL is a bearer credential. A syslog target is a host and a port on
     * your own network and carries no secret, and the question this endpoint exists
     * to answer — "is it pointed at the right collector?" — cannot be answered
     * without them.
     *
     * `exporting` is separate from the top-level `active` on purpose: `active` is
     * "enabled AND some channel configured", and syslog ignores that flag by design.
     * With delivery off and a syslog host set, this endpoint would otherwise answer
     * `active: false` while every finding went to the collector, and an operator
     * reading that concludes nothing is leaving the host.
     */
    syslog: settings.syslogHost
      ? {
          configured: true,
          exporting: notifier().exporting,
          target: `${settings.syslogHost}:${settings.syslogPort}`,
          protocol: settings.syslogProtocol,
          format: settings.syslogFormat,
          rfc: settings.syslogRfc,
          includeEvidence: settings.syslogIncludeEvidence,
        }
      : {
          configured: false,
          exporting: false,
          target: null,
          protocol: settings.syslogProtocol,
          format: settings.syslogFormat,
          rfc: settings.syslogRfc,
          includeEvidence: settings.syslogIncludeEvidence,
        },
  });
});

/**
 * GET /api/notify/settings — every setting, with where it came from.
 *
 * Readable by any authenticated account, on the same reasoning as the alert list and
 * the suppression rules: someone who can see every finding can see how delivery is
 * configured. The two credentials are the exception and are never included — each
 * reports `configured: true|false` instead, and the redaction happens in
 * notify/settings.ts rather than here so a future endpoint cannot leak them by
 * forgetting.
 *
 * `pinnedByEnvironment` is the part the form depends on. A field set in the
 * environment cannot be changed here, so the page has to render it uneditable — a
 * control that accepts an edit and changes nothing is the failure this codebase keeps
 * finding, and the server is the only thing that knows which fields those are.
 */
notifyRouter.get('/settings', (_req, res) => {
  res.json({
    settings: currentRedactedSettings(),
    pinnedByEnvironment: environmentPinnedFields(currentResolution()),
  });
});

/**
 * PUT /api/notify/settings — changes stored settings. Admin only.
 *
 * Admin because these values decide where findings about your network are sent, and
 * a non-admin who could edit them could redirect that stream or switch it off.
 *
 * A field sent as `null` is cleared, falling back to the environment or the default.
 * A field omitted is left alone — which is what lets the form save without
 * round-tripping a secret the API never sent it.
 *
 * A request naming a field the environment has pinned is refused rather than stored.
 * Storing it would be defensible — it would take effect if the variable were later
 * removed — but it would also mean the API answering 200 to a change that does not
 * change anything, and the whole point of `pinnedByEnvironment` is that nobody has
 * to guess about that.
 */
notifyRouter.put(
  '/settings',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const patch = parseOrThrow(deliverySettingsPatchSchema, req.body);

    const conflicts = pinnedConflicts(patch, currentResolution());
    if (conflicts.length > 0) {
      // The variable name, not the field key: `syslogAppName` is not a line an
      // admin can find in api/.env, `SYSLOG_APP_NAME` is — the same distinction
      // invalidEnvironmentVariables (settings.ts) makes for the boot-time warning.
      const variables = conflicts.map((field) => DELIVERY_FIELDS[field].env);
      throw new HttpError(
        409,
        `Set in the environment and not editable here: ${variables.join(', ')}. ` +
          'Remove the variable from api/.env (or your Compose file) to manage it from this page.',
      );
    }

    await saveDeliverySettings(patch, actorOf(req.user));

    // Rebuild against the new settings: flushes anything queued, then releases what
    // the old channels held. Done here rather than inside the settings service to
    // keep that module free of an import cycle with the notifier.
    await reloadNotifier();

    res.json({
      settings: currentRedactedSettings(),
      pinnedByEnvironment: environmentPinnedFields(currentResolution()),
    });
  }),
);

/**
 * Why there is nothing to send to.
 *
 * An OAuth2 mailbox that is half filled in gets its own answer, because the generic
 * message ("set an SMTP host with recipients") describes a mailbox whose host and
 * recipients *are* already set, and sends the operator to check the two things that
 * are not the problem.
 *
 * But only when email is actually pointed somewhere, which is what
 * `emailBlockedReason` checks before it says anything. `emailAuthMethod` can be
 * `oauth2` on an install with no SMTP host, no sender and no recipients — set in the
 * environment, or left behind by an earlier attempt — and telling *that* operator to
 * fill in a refresh token is a dead end in both directions: there is nothing to
 * authenticate against either way, and the accurate answer naming all three would
 * have been suppressed to say it.
 */
function nothingConfiguredMessage(): string {
  return (
    emailBlockedReason(currentSettings()) ??
    'No delivery channel is configured. Set a webhook URL, a syslog host, or an SMTP host with recipients — on this page, or in api/.env.'
  );
}

/**
 * The email channel's absence, reported as a result rather than as silence.
 *
 * `sendTest` can only report on channels that exist, and an incomplete OAuth2 mailbox
 * never becomes one — so with a webhook or syslog host also set, the response would
 * be `{delivered: 1, attempted: 1}` and read as a clean pass. The operator pressed
 * Test to find out whether *email* works, and would be told that everything attempted
 * was delivered without being told email was never attempted.
 *
 * Returned as a failed result for the channel, so it appears where every other
 * channel's answer appears.
 */
function skippedEmailResult(): DeliveryResult[] {
  const reason = emailBlockedReason(currentSettings());
  return reason ? [{ channel: 'email', ok: false, detail: reason }] : [];
}

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
    const skipped = skippedEmailResult();

    if (notifier().configuredChannels.length === 0) {
      res.status(400).json({ message: nothingConfiguredMessage() });
      return;
    }

    // Deliberately bypasses every gate, including `enabled`: the question being
    // answered is "can this reach you", and requiring the feature to be switched on
    // first makes it useless for checking config before committing to it.
    const results = [...(await notifier().sendTest()), ...skipped];
    const delivered = results.filter((result) => result.ok).length;

    res.status(delivered > 0 ? 200 : 502).json({
      delivered,
      attempted: results.length,
      results,
    });
  }),
);
