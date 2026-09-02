import { and, asc, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { type AlertRow, alertRollupDaily, alerts } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { notifier } from '../notify/notifier.js';
import { type Finding, SEVERITY_RANK, type Severity } from '../packet/detect/types.js';
import { firstWholeUtcDay, utcTrunc } from './alert-buckets.js';
import {
  countSuppressed,
  flushSuppressionCounters,
  hasPendingSuppressionCounts,
  suppressions,
} from './suppression.service.js';

const log = componentLogger('alerts');

/**
 * Offers a stored alert to the notifier.
 *
 * Wrapped and swallowed on purpose. Notification is downstream of detection, and a
 * misconfigured webhook or mail server must not be able to interrupt the flush loop
 * and cost the remaining alerts in the batch.
 */
function notify(entry: Pending): void {
  try {
    notifier().consider(entry.finding, entry.occurrences, entry.firstSeen, entry.lastSeen);
  } catch (error) {
    log.error({ err: error }, 'Notifier threw while considering an alert');
  }
}

/**
 * Turns detector findings into stored alerts.
 *
 * The point of this layer is aggregation. The previous design wrote one row per
 * suspicious packet, so a single port scan could produce thousands of rows that
 * all described the same event. Here, repeats of a finding inside a time window
 * increment one alert's `occurrences` instead of inserting again.
 *
 * Writes are batched: findings accumulate in memory and flush on a timer, so a
 * burst of traffic costs a handful of statements rather than one per packet.
 */

/** How often buffered occurrence counts are written out. */
const FLUSH_INTERVAL_MS = 3_000;
/** Ceiling on distinct pending findings, in case detection goes haywire. */
const MAX_PENDING = 2_000;

interface Pending {
  finding: Finding;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  /** True once the row exists in the database. */
  persisted: boolean;
}

/**
 * Repeats merge only within a window; a later burst produces a fresh alert rather
 * than inflating a months-old row forever. The bucket is part of the key so this
 * still holds after a restart, when in-memory state is gone.
 */
function windowedKey(finding: Finding): string {
  const bucket = Math.floor(finding.timestamp.getTime() / env.detection.alertWindowMs);
  return `${finding.dedupKey}|w${bucket}`.slice(0, 255);
}

export class AlertSink {
  private readonly pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private dropped = 0;
  private suppressed = 0;

  /** Records findings and schedules a flush. Never throws. */
  record(findings: Finding[]): void {
    // One wall-clock reading for the batch. Deliberately not each finding's own
    // timestamp: a rule's expiry is a statement about real time, and flow
    // exporters report traffic minutes after it happened.
    const now = Date.now();
    const rules = suppressions();

    for (const finding of findings) {
      /*
       * The single point where a finding can be declared expected.
       *
       * It sits here, above the aggregation, rather than in the detectors or at
       * the notifier, and that placement is the whole design. Both sources of
       * findings — the packet engine and the flow collector — reach storage
       * through this method, and notification happens downstream of storage in
       * `flush`, so one check covers the alert table, the webhook, the email
       * digest and the SIEM feed. Suppressing at the notifier instead would have
       * left the dashboard full of the noise somebody just declared expected.
       *
       * A suppressed finding is dropped, not stored and hidden. The counters are
       * the only trace it leaves, which is why they are recorded here rather than
       * treated as telemetry.
       */
      const ruleId = rules.match(finding, now);
      if (ruleId !== null) {
        this.suppressed += 1;
        countSuppressed(ruleId, finding.timestamp);
        continue;
      }

      const key = windowedKey(finding);
      const existing = this.pending.get(key);

      if (existing) {
        existing.occurrences += 1;
        existing.lastSeen = finding.timestamp;
        // Keep the newest evidence: counters inside it grow as the event unfolds.
        existing.finding = finding;
        continue;
      }

      if (this.pending.size >= MAX_PENDING) {
        this.dropped += 1;
        continue;
      }

      this.pending.set(key, {
        finding,
        occurrences: 1,
        firstSeen: finding.timestamp,
        lastSeen: finding.timestamp,
        persisted: false,
      });
    }

    // Suppression counts need a flush of their own even when every finding in the
    // batch was suppressed and there is nothing to store — otherwise a rule doing
    // all the work shows a match count of zero, which reads as a rule that is not
    // firing.
    if (this.pending.size > 0 || hasPendingSuppressionCounts()) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  /** Writes buffered findings. Safe to call at any time, including on shutdown. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.pending.size === 0 && !hasPendingSuppressionCounts()) return;
    this.flushing = true;

    const batch = [...this.pending.entries()];
    this.pending.clear();

    if (this.suppressed > 0) {
      log.debug({ suppressed: this.suppressed }, 'Findings suppressed by rule since the last flush');
      this.suppressed = 0;
    }

    if (this.dropped > 0) {
      log.warn(
        { dropped: this.dropped, maxPending: MAX_PENDING },
        'Dropped findings: too many distinct pending',
      );
      this.dropped = 0;
    }

    try {
      for (const [key, entry] of batch) {
        try {
          await upsertAlert(key, entry);
          // Only after it is stored. Notifying about something that failed to
          // persist would send people to a dashboard that does not show it.
          notify(entry);
        } catch (error) {
          log.error(
            { finding: entry.finding.title, kind: entry.finding.kind, err: error },
            'Could not save alert',
          );
        }
      }
      // After the alerts, so a slow or failing counter write cannot delay them.
      // These counts are the only record a suppressed finding leaves, so they are
      // written on the alerts' schedule rather than opportunistically.
      await flushSuppressionCounters();
    } finally {
      this.flushing = false;
      // Anything recorded while we were writing needs its own flush.
      if (this.pending.size > 0 || hasPendingSuppressionCounts()) this.scheduleFlush();
    }
  }

  /** Flushes and stops the timer. Used when a capture stops. */
  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
    // The notifier batches on its own timer, so a capture that stops immediately
    // after a finding would otherwise lose the digest that was still pending.
    await notifier().flush();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

async function upsertAlert(dedupKey: string, entry: Pending): Promise<void> {
  const { finding } = entry;

  await db
    .insert(alerts)
    .values({
      kind: finding.kind,
      severity: finding.severity,
      title: finding.title.slice(0, 200),
      description: finding.description,
      sourceIp: finding.sourceIp ?? null,
      sourceMac: finding.sourceMac ?? null,
      targetIp: finding.targetIp ?? null,
      targetMac: finding.targetMac ?? null,
      protocol: finding.protocol ?? null,
      port: finding.port ?? null,
      dedupKey,
      occurrences: entry.occurrences,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      evidence: finding.evidence,
    })
    .onConflictDoUpdate({
      target: alerts.dedupKey,
      set: {
        occurrences: sql`${alerts.occurrences} + ${entry.occurrences}`,
        lastSeen: entry.lastSeen,
        // Later evidence supersedes earlier: its counters reflect the full event.
        evidence: finding.evidence,
        severity: finding.severity,
        title: finding.title.slice(0, 200),
        description: finding.description,
        // Set on update too, so a row written before the column existed gains it
        // the next time the same finding recurs.
        port: finding.port ?? null,
      },
    });
}

// --- Queries used by the API ---

export interface AlertQuery {
  severity?: Severity;
  kind?: string;
  /** Only alerts seen at or after this time. */
  since?: Date;
  acknowledged?: boolean;
  limit: number;
  offset: number;
}

export async function listAlerts(query: AlertQuery): Promise<AlertRow[]> {
  const conditions = [];
  if (query.severity) conditions.push(eq(alerts.severity, query.severity));
  if (query.kind) conditions.push(eq(alerts.kind, query.kind));
  if (query.since) conditions.push(gte(alerts.lastSeen, query.since));
  if (query.acknowledged === false) conditions.push(isNull(alerts.acknowledgedAt));
  if (query.acknowledged === true) conditions.push(sql`${alerts.acknowledgedAt} IS NOT NULL`);

  return (
    db
      .select()
      .from(alerts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      // Most urgent first, then most recent. Severity is text, so rank it explicitly.
      .orderBy(asc(severityRank()), desc(alerts.lastSeen))
      .limit(query.limit)
      .offset(query.offset)
  );
}

/** The columns a suppression rule is matched against, plus what a preview reports. */
export interface AlertForMatching {
  id: number;
  kind: string;
  severity: string;
  sourceIp: string | null;
  targetIp: string | null;
  port: number | null;
  occurrences: number;
  lastSeen: Date;
}

/**
 * The most recent alerts, for previewing a suppression rule against real data.
 *
 * Ordered by recency, deliberately unlike `listAlerts`, which puts the most
 * severe first. A preview answering "what would this rule have hidden?" has to
 * examine a *time* window — the most severe 500 rows could all predate the
 * scanner whose noise the operator is trying to silence, and the preview would
 * confidently report zero.
 */
export async function recentAlertsForMatching(limit: number): Promise<AlertForMatching[]> {
  return db
    .select({
      id: alerts.id,
      kind: alerts.kind,
      severity: alerts.severity,
      sourceIp: alerts.sourceIp,
      targetIp: alerts.targetIp,
      port: alerts.port,
      occurrences: alerts.occurrences,
      lastSeen: alerts.lastSeen,
    })
    .from(alerts)
    .orderBy(desc(alerts.lastSeen))
    .limit(limit);
}

function severityRank() {
  return sql`CASE ${alerts.severity}
    WHEN 'critical' THEN ${SEVERITY_RANK.critical}
    WHEN 'high' THEN ${SEVERITY_RANK.high}
    WHEN 'medium' THEN ${SEVERITY_RANK.medium}
    WHEN 'low' THEN ${SEVERITY_RANK.low}
    ELSE ${SEVERITY_RANK.info} END`;
}

export interface AlertSummary {
  total: number;
  unacknowledged: number;
  bySeverity: Record<Severity, number>;
  byKind: Array<{ kind: string; count: number; occurrences: number }>;
  latestAt: string | null;
}

/** One time bucket of the alert trend, split by severity. */
export interface AlertTrendPoint {
  bucket: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AlertDashboard extends AlertSummary {
  /** Buckets oldest-first, ready to plot. */
  trend: AlertTrendPoint[];
  /** Addresses implicated in the most findings. */
  topSources: Array<{ sourceIp: string; count: number; occurrences: number }>;
}

/**
 * Aggregates for the dashboard.
 *
 * Bucketing and ranking happen in SQL rather than in the browser: the client only
 * ever holds a page of alerts, so counting there would silently describe a subset
 * of the data.
 */
export async function dashboardData(options: {
  days: number;
  bucket: 'hour' | 'day';
}): Promise<AlertDashboard> {
  const since = new Date(Date.now() - options.days * 86_400_000);

  // Both this and the rollup below are UTC buckets, and have to be: the two series
  // are merged into one chart. See alert-buckets.ts.
  const bucketExpression = utcTrunc(options.bucket === 'hour' ? 'hour' : 'day', alerts.lastSeen);

  const [summary, trendRows, sourceRows] = await Promise.all([
    summarizeAlerts(),
    db
      .select({
        bucket: sql<string>`${bucketExpression}`,
        severity: alerts.severity,
        total: count(),
      })
      .from(alerts)
      .where(gte(alerts.lastSeen, since))
      .groupBy(bucketExpression, alerts.severity)
      .orderBy(bucketExpression),
    db
      .select({
        sourceIp: alerts.sourceIp,
        total: count(),
        occurrences: sql<number>`coalesce(sum(${alerts.occurrences}), 0)::int`,
      })
      .from(alerts)
      .where(and(gte(alerts.lastSeen, since), sql`${alerts.sourceIp} IS NOT NULL`))
      .groupBy(alerts.sourceIp)
      .orderBy(desc(count()))
      .limit(8),
  ]);

  // Collapse (bucket, severity) rows into one point per bucket.
  const byBucket = new Map<string, AlertTrendPoint>();
  const addTo = (key: string, severity: string, total: number) => {
    let point = byBucket.get(key);
    if (!point) {
      point = { bucket: key, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      byBucket.set(key, point);
    }
    if (severity in point) {
      // Added, not assigned: a day can arrive from both sources at once — see below.
      point[severity as Severity] += total;
    }
  };

  for (const row of trendRows) {
    addTo(new Date(row.bucket).toISOString(), row.severity, Number(row.total));
  }

  /*
   * Rolled-up days, folded into the same series.
   *
   * Without this the chart would answer a 365-day question with only what retention
   * has not yet expired, so a window longer than ALERT_RETENTION_DAYS would show a
   * flat line before the cutoff — history that was deleted rendered exactly like a
   * network on which nothing happened. Keeping those two distinguishable is most of
   * what this codebase's detectors are for, and the trend chart is the last place it
   * should be given away.
   *
   * Only requested for a daily bucket. An hourly view cannot be served from a daily
   * rollup, and inventing 24 equal hours from one bucket would be fabricating detail
   * that was deliberately discarded; the honest answer for an hourly window is the
   * live rows alone, and an hourly window is only offered for two days anyway.
   *
   * The two sources can overlap on exactly one day — the day the cutoff falls in,
   * whose expired half is rolled up while its recent half is still live — which is
   * why the points are accumulated rather than assigned.
   *
   * Whole days only: see `firstWholeUtcDay` for why the day containing `since` is
   * left out rather than counted in full.
   */
  if (options.bucket === 'day') {
    const rolled = await db
      .select({
        day: alertRollupDaily.day,
        severity: alertRollupDaily.severity,
        total: alertRollupDaily.alerts,
      })
      .from(alertRollupDaily)
      .where(gte(alertRollupDaily.day, firstWholeUtcDay(since)));

    for (const row of rolled) {
      addTo(new Date(`${row.day}T00:00:00.000Z`).toISOString(), row.severity, Number(row.total));
    }
  }

  return {
    ...summary,
    trend: [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    topSources: sourceRows
      .filter((row): row is typeof row & { sourceIp: string } => row.sourceIp !== null)
      .map((row) => ({
        sourceIp: row.sourceIp,
        count: Number(row.total),
        occurrences: Number(row.occurrences),
      })),
  };
}

/**
 * Counts across the alerts that are still stored in full.
 *
 * Deliberately NOT including `alert_rollup_daily`, unlike the trend, and the
 * asymmetry is a choice rather than an oversight. These numbers describe what can be
 * opened, filtered and acknowledged — `unacknowledged` has no meaning for a rollup
 * bucket, which records how many alerts a day held and not what anyone did about
 * them — so folding rollups in would produce a total that the alert list could never
 * account for.
 *
 * The visible consequence, worth knowing before it looks like a bug: with retention
 * on, a window longer than `ALERT_RETENTION_DAYS` shows trend bars for days that the
 * totals no longer count. The trend answers "what did this period look like?" and the
 * tiles answer "what is in the table now?", and after an expiry those are genuinely
 * different questions.
 */
export async function summarizeAlerts(): Promise<AlertSummary> {
  const [severityRows, kindRows, totals] = await Promise.all([
    db.select({ severity: alerts.severity, total: count() }).from(alerts).groupBy(alerts.severity),
    db
      .select({
        kind: alerts.kind,
        total: count(),
        occurrences: sql<number>`coalesce(sum(${alerts.occurrences}), 0)::int`,
      })
      .from(alerts)
      .groupBy(alerts.kind),
    db
      .select({
        total: count(),
        unacknowledged: sql<number>`count(*) FILTER (WHERE ${alerts.acknowledgedAt} IS NULL)::int`,
        latest: sql<string | null>`max(${alerts.lastSeen})`,
      })
      .from(alerts),
  ]);

  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of severityRows) {
    if (row.severity in bySeverity) bySeverity[row.severity as Severity] = Number(row.total);
  }

  return {
    total: Number(totals[0]?.total ?? 0),
    unacknowledged: Number(totals[0]?.unacknowledged ?? 0),
    bySeverity,
    byKind: kindRows
      .map((row) => ({ kind: row.kind, count: Number(row.total), occurrences: Number(row.occurrences) }))
      .sort((a, b) => b.count - a.count),
    latestAt: totals[0]?.latest ? new Date(totals[0].latest).toISOString() : null,
  };
}

export async function acknowledgeAlert(id: number, acknowledgedBy: string): Promise<AlertRow | null> {
  const [updated] = await db
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: acknowledgedBy.slice(0, 200) })
    .where(eq(alerts.id, id))
    .returning();
  return updated ?? null;
}

export async function unacknowledgeAlert(id: number): Promise<AlertRow | null> {
  const [updated] = await db
    .update(alerts)
    .set({ acknowledgedAt: null, acknowledgedBy: null })
    .where(eq(alerts.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteAlert(id: number): Promise<boolean> {
  const deleted = await db.delete(alerts).where(eq(alerts.id, id)).returning({ id: alerts.id });
  return deleted.length > 0;
}

export async function deleteAllAlerts(): Promise<number> {
  const deleted = await db.delete(alerts).returning({ id: alerts.id });
  return deleted.length;
}
