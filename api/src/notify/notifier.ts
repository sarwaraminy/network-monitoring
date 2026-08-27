import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import type { Finding, Severity } from '../packet/detect/types.js';
import { BoundedMap } from '../packet/detect/types.js';
import { EmailChannel } from './email.js';
import { MAX_LISTED_FINDINGS } from './format.js';
import { SyslogChannel } from './syslog.js';
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
 * How long findings wait to share a socket. Not a digest — see `enqueueExport`.
 */
const EXPORT_COALESCE_MS = 1000;

/** Send immediately once this many are waiting, so a burst does not sit in a timer. */
const MAX_EXPORT_BATCH = 200;

/** A backstop, not a policy. Reaching it means the SIEM feed is incomplete. */
const MAX_EXPORT_QUEUE = 10_000;

/**
 * Written into every exported event, so a SIEM rule can pin the producer.
 *
 * Read from the ROOT package.json rather than restated, and rather than the api
 * workspace's. A hardcoded copy drifts from a release bump silently — but so do
 * two independent workspace manifests, and it is the product's version a SIEM
 * rule keys on, not `network-monitoring-api`'s.
 *
 * `../../../` resolves to the repo root from `api/src/notify/` and from
 * `api/dist/notify/` alike, so source and build agree.
 */
const PRODUCT_VERSION: string = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return manifest.version ?? '0.0.0';
  } catch {
    // Never fatal: an export carrying an unknown version beats no export at all.
    return '0.0.0';
  }
})();

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
  private readonly exportQueue: NotifiableFinding[] = [];
  private exportTimer: ReturnType<typeof setTimeout> | null = null;
  /** The export send in progress, so `flush()` can wait for it. See `flushExports`. */
  private exportInFlight: Promise<void> = Promise.resolve();
  /** Findings discarded because the queue was full, since the last successful send. */
  private exportDropped = 0;

  /** The dispatch currently in progress, so `flush()` can wait for it. */
  private inFlight: Promise<void> = Promise.resolve();
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

    /*
     * Export channels are fed first, and unconditionally.
     *
     * Everything below this — the enabled flag, the severity threshold, the
     * throttle, the hourly ceiling, the digest — exists to protect a human
     * inbox. A SIEM needs the opposite: the complete stream, because it does its
     * own correlation and any gap silently under-reports every rule counting
     * events over a window. See notify/syslog.ts.
     *
     * `void` because a collector must never be able to slow detection down, and
     * the channel already swallows its own failures into a DeliveryResult.
     */
    this.enqueueExport(finding, occurrences, firstSeen, lastSeen);

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

  /**
   * Hands one finding to every channel that wants the whole stream.
   *
   * Wrapped in a single-finding Notification so export channels share the same
   * interface as the human ones — the difference is when they are called, not
   * what they receive.
   */
  /** Channels that take the complete stream, ungated. */
  private get exporters(): NotificationChannel[] {
    return this.channels.filter((channel) => channel.deliversEveryFinding === true && channel.isConfigured());
  }

  /** True when something is exporting regardless of NOTIFY_ENABLED. */
  get exporting(): boolean {
    return this.exporters.length > 0;
  }

  /**
   * Queues a finding for export, and schedules a flush.
   *
   * NOT one send per finding, which is what this used to do. `sendTcp`'s own
   * docblock promised "one connection per batch" while every batch held exactly
   * one event — so it was a connection per finding, and a fresh dgram socket per
   * finding on UDP, with nothing bounding how many were in flight. A scan burst
   * across many pairings opened sockets as fast as findings were raised, and TCP
   * connections linger in TIME_WAIT after closing. Volume is the SIEM's problem;
   * file descriptors and ephemeral ports are this process's.
   *
   * The coalescing window is short on purpose. This is not the digest — nothing
   * is summarised, dropped or deduplicated, and every finding still leaves as its
   * own syslog line with its own timestamp. It only decides how many share a
   * socket.
   */
  private enqueueExport(finding: Finding, occurrences: number, firstSeen: Date, lastSeen: Date): void {
    if (this.exporters.length === 0) return;

    if (this.exportQueue.length >= MAX_EXPORT_QUEUE) {
      this.exportDropped += 1;

      /*
       * Loud on the way in, then rate-limited.
       *
       * Dropping breaks the one guarantee this path makes, so it has to be
       * visible. But this state means the collector is unreachable WHILE findings
       * keep arriving — the moment volume is highest — and a line per dropped
       * finding turns a delivery failure into a log flood, which is the second
       * failure. The transition is logged, then a running count.
       */
      if (this.exportDropped === 1 || this.exportDropped % 1000 === 0) {
        log.error(
          { dropped: this.exportDropped, queued: this.exportQueue.length, kind: finding.kind },
          'Export queue is full; dropping findings. The SIEM feed is no longer complete.',
        );
      }
      return;
    }

    this.exportQueue.push(
      toNotifiable(finding, occurrences, firstSeen, lastSeen, env.notify.syslog.includeEvidence),
    );

    if (this.exportQueue.length >= MAX_EXPORT_BATCH) {
      void this.flushExports();
      return;
    }

    this.exportTimer ??= setTimeout(() => {
      this.exportTimer = null;
      void this.flushExports();
    }, EXPORT_COALESCE_MS).unref?.() as never;
  }

  /**
   * Sends everything queued as one batch, to every export channel.
   *
   * Single-flight, and tracked. Without the chain, `flush()` could splice an
   * already-empty queue and return while the previous send was still on the
   * socket — losing exactly the findings the shutdown drain exists to save. That
   * is the same defect as the digest's, whose `inFlight` promise sits twenty
   * lines above and was not extended here.
   *
   * Chaining also bounds concurrency: a 200-finding batch can no longer start a
   * second send while the first is still going.
   */
  private flushExports(): Promise<void> {
    // `catch` so one failed send does not poison the chain for every later one.
    this.exportInFlight = this.exportInFlight.catch(() => {}).then(() => this.sendExportBatch());
    return this.exportInFlight;
  }

  private async sendExportBatch(): Promise<void> {
    if (this.exportTimer) {
      clearTimeout(this.exportTimer);
      this.exportTimer = null;
    }

    const batch = this.exportQueue.splice(0, this.exportQueue.length);
    const exporters = this.exporters;
    if (batch.length === 0 || exporters.length === 0) return;

    if (this.exportDropped > 0) {
      log.warn(
        { dropped: this.exportDropped },
        'Export queue recovered; findings were lost while it was full.',
      );
      this.exportDropped = 0;
    }

    const counts: Partial<Record<Severity, number>> = {};
    for (const finding of batch) {
      counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    }

    const notification: Notification = {
      // The most urgent in the batch, matching how the digest reports itself.
      severity: SEVERITY_ORDER.find((level) => counts[level] !== undefined) ?? 'info',
      findings: batch,
      omittedCount: 0,
      countsBySeverity: counts,
      generatedAt: new Date(this.now()),
      dashboardUrl: env.notify.dashboardUrl,
      isTest: false,
    };

    const settled = await Promise.allSettled(exporters.map((channel) => channel.send(notification)));

    for (const [index, outcome] of settled.entries()) {
      const name = exporters[index]?.name ?? 'unknown';
      if (outcome.status === 'rejected') {
        log.error({ channel: name }, `export channel threw: ${outcome.reason}`);
      } else if (!outcome.value.ok) {
        log.error({ channel: name }, outcome.value.detail);
      }
    }
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

  /**
   * Sends anything queued and clears the timer. Called on shutdown.
   *
   * Awaits an in-flight send before dispatching, then dispatches again if that
   * send left anything behind. `dispatch()` returns immediately when `sending` is
   * true, so without this a flush landing mid-SMTP-send would resolve having sent
   * nothing — and on shutdown the remaining findings would be left to an unref'd
   * timer that the process is about to kill.
   */
  async flush(): Promise<void> {
    if (this.digestTimer) {
      clearTimeout(this.digestTimer);
      this.digestTimer = null;
    }

    // Exports drain too. The coalescing timer is unref'd, so on shutdown anything
    // still waiting for it would be killed with the process — findings the SIEM
    // was promised and never receives.
    //
    // Twice, deliberately: the first await covers a send already on the socket
    // and the batch queued behind it, the second covers anything that arrived
    // while the first was running.
    await this.flushExports();
    await this.flushExports();

    await this.inFlight;
    await this.dispatch();

    // A send that was in progress may have queued more while it ran.
    if (this.queue.length > 0) {
      await this.inFlight;
      await this.dispatch();
    }
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
    let settle: () => void = () => {};
    this.inFlight = new Promise<void>((resolve) => {
      settle = resolve;
    });

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
      settle();
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
    /*
     * Export channels are excluded here, and that is not an optimisation.
     *
     * They already received every one of these findings ungated, at the top of
     * `consider()`. Sending them the digest as well would deliver each finding to
     * the SIEM twice — once as its own event and once inside a summary — and
     * every correlation rule counting occurrences would double.
     *
     * `sendTest()` deliberately does not go through here, so a test message still
     * reaches syslog: proving the collector is reachable is the whole point of it.
     */
    const configured = this.channels.filter(
      (channel) => channel.isConfigured() && channel.deliversEveryFinding !== true,
    );
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

  if (env.notify.syslog.host !== '') {
    channels.push(
      new SyslogChannel({
        host: env.notify.syslog.host,
        port: env.notify.syslog.port,
        protocol: env.notify.syslog.protocol,
        format: env.notify.syslog.format,
        rfc: env.notify.syslog.rfc,
        facility: env.notify.syslog.facility,
        appName: env.notify.syslog.appName,
        hostname: hostname(),
        productVersion: PRODUCT_VERSION,
      }),
    );
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
