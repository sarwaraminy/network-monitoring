import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import type { Finding, Severity } from '../packet/detect/types.js';
import { BoundedMap } from '../packet/detect/types.js';
import { EmailChannel } from './email.js';
import { MAX_LISTED_FINDINGS } from './format.js';
import {
  type DeliveryResult,
  meetsThreshold,
  type NotifiableFinding,
  type Notification,
  type NotificationChannel,
  SEVERITY_ORDER,
  toNotifiable,
} from './types.js';
import { WebhookChannel } from './webhook.js';

const log = componentLogger('notify');

/**
 * Decides what gets sent, and stops it becoming spam.
 *
 * The sending is the easy part. The reason alerting systems get muted — and then
 * the one that mattered gets missed — is volume, so three independent limits apply
 * before anything leaves the process:
 *
 *  1. **Severity gate.** Default `high`, so critical and high only. Medium and
 *     below belong on the dashboard, not in someone's inbox.
 *  2. **Per-finding throttle.** The same `dedupKey` will not re-notify for a
 *     configurable period, however many times it recurs.
 *  3. **Hourly ceiling.** A hard backstop. If detection misbehaves — which it has
 *     done in this codebase's history — the blast radius is bounded.
 *
 * On top of that, findings are batched into a digest window rather than sent
 * individually, because a scan produces a burst and forty separate messages about
 * one event is how a recipient learns to ignore the channel.
 *
 * One notifier per process, not per capture session: throttle state and the hourly
 * ceiling have to be global, or two captures plus the flow collector would each get
 * their own allowance and the limits would mean nothing.
 */

/** Cap on distinct throttle keys, so remote-driven detection cannot grow memory. */
const MAX_THROTTLE_KEYS = 4096;
/** Batched findings held at most; beyond this they are counted, not carried. */
const MAX_QUEUED = 200;

interface QueuedFinding {
  finding: NotifiableFinding;
  dedupKey: string;
}

export class Notifier {
  private readonly channels: NotificationChannel[] = [];
  private readonly lastNotifiedAt = new BoundedMap<string, number>(MAX_THROTTLE_KEYS);
  private readonly sentTimestamps: number[] = [];
  private queue: QueuedFinding[] = [];
  private omitted = 0;
  private digestTimer: NodeJS.Timeout | null = null;
  private sending = false;
  /**
   * Single source of time for both the throttle and the hourly ceiling.
   *
   * Not a testing convenience. Reading `Date.now()` in one place and accepting a
   * caller-supplied instant in another means the two limits are measured on
   * different clocks, so they can disagree about whether an hour has passed.
   */
  private readonly now: () => number;

  constructor(channels?: NotificationChannel[], nowFn: () => number = Date.now) {
    this.channels = channels ?? buildChannelsFromEnv();
    this.now = nowFn;
  }

  /** True when at least one channel could actually deliver. */
  get active(): boolean {
    return env.notify.enabled && this.channels.some((channel) => channel.isConfigured());
  }

  get configuredChannels(): string[] {
    return this.channels.filter((channel) => channel.isConfigured()).map((channel) => channel.name);
  }

  /**
   * Offers a finding for notification. Returns why it was or was not queued, which
   * the tests assert against and `/api/notify/status` reports.
   */
  consider(
    finding: Finding,
    occurrences: number,
    firstSeen: Date,
    lastSeen: Date,
    at?: number,
  ): 'queued' | 'below-threshold' | 'throttled' | 'rate-limited' | 'disabled' {
    const now = at ?? this.now();
    if (!this.active) return 'disabled';

    if (!meetsThreshold(finding.severity, env.notify.minSeverity)) return 'below-threshold';

    const throttleKey = finding.dedupKey;
    const last = this.lastNotifiedAt.get(throttleKey);
    if (last !== undefined && now - last < env.notify.throttleMs) return 'throttled';

    if (this.hourlyCountAt(now) >= env.notify.maxPerHour) {
      // Logged once per occurrence deliberately: hitting the ceiling means either
      // a real incident or broken detection, and both need to be visible.
      log.warn(
        { maxPerHour: env.notify.maxPerHour, kind: finding.kind },
        'Notification hourly limit reached; suppressing until the window rolls',
      );
      return 'rate-limited';
    }

    this.lastNotifiedAt.set(throttleKey, now);

    if (this.queue.length >= MAX_QUEUED) {
      this.omitted += 1;
    } else {
      this.queue.push({
        dedupKey: throttleKey,
        finding: toNotifiable(finding, occurrences, firstSeen, lastSeen, env.notify.includeEvidence),
      });
    }

    this.scheduleDigest();
    return 'queued';
  }

  /** Sends a deliberate test message, bypassing every gate. */
  async sendTest(): Promise<DeliveryResult[]> {
    const now = new Date();
    const notification: Notification = {
      severity: 'info',
      findings: [
        {
          kind: 'test',
          severity: 'info',
          title: 'Test notification from Network Monitoring',
          description:
            'If you are reading this, alert delivery is configured correctly. No finding was involved.',
          sourceIp: null,
          targetIp: null,
          occurrences: 1,
          firstSeen: now,
          lastSeen: now,
          evidence: null,
        },
      ],
      omittedCount: 0,
      countsBySeverity: { info: 1 },
      generatedAt: now,
      dashboardUrl: env.notify.dashboardUrl,
      isTest: true,
    };

    return await this.deliver(notification);
  }

  /** Sends anything queued and clears the timer. Called on shutdown. */
  async flush(): Promise<void> {
    if (this.digestTimer) {
      clearTimeout(this.digestTimer);
      this.digestTimer = null;
    }
    await this.dispatch();
  }

  private scheduleDigest(): void {
    if (this.digestTimer) return;
    this.digestTimer = setTimeout(() => {
      this.digestTimer = null;
      void this.dispatch();
    }, env.notify.digestMs);
    // The digest timer alone must not keep the process alive.
    this.digestTimer.unref();
  }

  private async dispatch(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    this.sending = true;

    const batch = this.queue;
    const omittedCount = this.omitted;
    this.queue = [];
    this.omitted = 0;

    try {
      const notification = buildNotification(batch, omittedCount, env.notify.dashboardUrl);
      this.sentTimestamps.push(this.now());
      const results = await this.deliver(notification);

      for (const result of results) {
        if (result.ok) {
          log.info({ channel: result.channel, findings: batch.length }, result.detail);
        } else {
          log.error({ channel: result.channel }, result.detail);
        }
      }
    } finally {
      this.sending = false;
      // Anything that arrived mid-send needs its own window.
      if (this.queue.length > 0) this.scheduleDigest();
    }
  }

  /**
   * Sends to every configured channel concurrently.
   *
   * `allSettled`, because one dead channel must not stop the others — and because
   * a rejection escaping here would surface as an unhandled rejection and, via the
   * process handler in index.ts, look like a server fault.
   */
  private async deliver(notification: Notification): Promise<DeliveryResult[]> {
    const configured = this.channels.filter((channel) => channel.isConfigured());
    const settled = await Promise.allSettled(configured.map((channel) => channel.send(notification)));

    return settled.map((outcome, index) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : {
            channel: configured[index]?.name ?? 'unknown',
            ok: false,
            detail: `channel threw: ${outcome.reason}`,
          },
    );
  }

  /** Sends in the last hour, pruning as it goes. */
  private hourlyCountAt(now: number): number {
    const cutoff = now - 3_600_000;
    while (this.sentTimestamps.length > 0 && (this.sentTimestamps[0] ?? 0) < cutoff) {
      this.sentTimestamps.shift();
    }
    return this.sentTimestamps.length;
  }

  /** For the status endpoint. */
  stats(): { queued: number; sentLastHour: number; channels: string[]; throttleKeys: number } {
    return {
      queued: this.queue.length,
      sentLastHour: this.hourlyCountAt(this.now()),
      channels: this.configuredChannels,
      throttleKeys: this.lastNotifiedAt.size,
    };
  }
}

export function buildNotification(
  batch: QueuedFinding[],
  omittedCount: number,
  dashboardUrl: string | null,
): Notification {
  const countsBySeverity: Partial<Record<Severity, number>> = {};
  for (const item of batch) {
    countsBySeverity[item.finding.severity] = (countsBySeverity[item.finding.severity] ?? 0) + 1;
  }

  // Most urgent first, so the message leads with what matters even when truncated.
  const sorted = [...batch].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.finding.severity) - SEVERITY_ORDER.indexOf(b.finding.severity) ||
      b.finding.occurrences - a.finding.occurrences,
  );

  const listed = sorted.slice(0, MAX_LISTED_FINDINGS);
  const truncated = sorted.length - listed.length;

  return {
    severity: listed[0]?.finding.severity ?? 'info',
    findings: listed.map((item) => item.finding),
    omittedCount: omittedCount + truncated,
    countsBySeverity,
    generatedAt: new Date(),
    dashboardUrl,
    isTest: false,
  };
}

function buildChannelsFromEnv(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];

  if (env.notify.webhookUrl !== '') {
    channels.push(new WebhookChannel({ url: env.notify.webhookUrl, format: env.notify.webhookFormat }));
  }

  if (env.notify.email.host !== '' && env.notify.email.to.length > 0) {
    channels.push(
      new EmailChannel({
        host: env.notify.email.host,
        port: env.notify.email.port,
        secure: env.notify.email.secure,
        user: env.notify.email.user,
        password: env.notify.email.password,
        from: env.notify.email.from,
        to: env.notify.email.to,
      }),
    );
  }

  return channels;
}

/** One notifier per process, shared by every capture session and the flow collector. */
let instance: Notifier | null = null;

export function notifier(): Notifier {
  instance ??= new Notifier();
  return instance;
}

/** Test seam, so a suite can install a notifier with fake channels. */
export function setNotifierForTesting(replacement: Notifier | null): void {
  instance = replacement;
}
