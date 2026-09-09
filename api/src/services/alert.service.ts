import { and, asc, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { type AlertRow, alertRollupDaily, alerts, knownDevices } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { notifier } from '../notify/notifier.js';
import { type Finding, SEVERITY_RANK, type Severity } from '../packet/detect/types.js';
import { firstWholeUtcDay, startOfUtcBucket, type TrendBucket, utcTrunc } from './alert-buckets.js';
import { type Actor, recordAudit } from './audit.service.js';
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
        // Clamped, not assigned: the flow collector documents findings arriving out
        // of order, and a later-processed finding with an earlier timestamp must not
        // pull lastSeen backward past firstSeen — that pairing is a CHECK constraint
        // on the alerts table once this reaches storage.
        if (finding.timestamp > existing.lastSeen) existing.lastSeen = finding.timestamp;
        if (finding.timestamp < existing.firstSeen) existing.firstSeen = finding.timestamp;
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
            // The key rather than a rendering: a server log is read with `grep` by
            // whoever is on the host, so it wants the stable identifier.
            { finding: entry.finding.messageKey, kind: entry.finding.kind, err: error },
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

  /** A read-only view of what's pending, for inspecting the merge in tests. */
  get pendingSnapshot(): ReadonlyMap<string, Readonly<Pending>> {
    return this.pending;
  }
}

async function upsertAlert(dedupKey: string, entry: Pending): Promise<void> {
  const { finding } = entry;

  await db
    .insert(alerts)
    .values({
      /*
       * Stamped from the environment on every write, and never from the finding.
       *
       * A finding describes what was observed; which sensor observed it is a fact
       * about this process. Threading it through the detectors would give every one
       * of them a chance to omit it, and the column has no default precisely so that
       * omission is an error rather than a silent merge into another sensor's rows.
       */
      sensorId: env.sensorId,
      kind: finding.kind,
      severity: finding.severity,
      messageKey: finding.messageKey,
      messageParams: finding.messageParams,
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
      // Both columns, matching V16's UNIQUE (sensor_id, dedup_key). `dedupKey`
      // alone no longer names a constraint, and naming it would be the merge bug:
      // the dedup key is derived from what was observed, so two sensors on two
      // segments produce identical keys for unrelated events.
      target: [alerts.sensorId, alerts.dedupKey],
      set: {
        occurrences: sql`${alerts.occurrences} + ${entry.occurrences}`,
        // greatest()/least(), not a plain assignment: the same dedup key can be
        // upserted again by a later flush within the same window bucket, and the
        // flow collector documents findings arriving out of order. An unconditional
        // assignment could pull lastSeen backward past firstSeen — a pairing the
        // alerts table's own CHECK constraint forbids — or lose an earlier firstSeen
        // a later flush discovers. Mirrors the rollup's own ON CONFLICT in
        // retention.service.ts.
        firstSeen: sql`least(${alerts.firstSeen}, ${entry.firstSeen})`,
        lastSeen: sql`greatest(${alerts.lastSeen}, ${entry.lastSeen})`,
        // Later evidence supersedes earlier: its counters reflect the full event.
        evidence: finding.evidence,
        severity: finding.severity,
        messageKey: finding.messageKey,
        messageParams: finding.messageParams,
        // Cleared on update, so a row first written before V17 stops carrying a
        // stale English sentence next to the key that supersedes it. Without this
        // the two disagree the moment a detector's wording changes, and the
        // display rule — prefer the key, fall back to the prose — would go on
        // preferring the key while the row still looked like it had both.
        title: null,
        description: null,
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
  /**
   * Only alerts from this sensor. Absent means every sensor, which is the default
   * on purpose: sharing one database is what makes a second sensor worth having,
   * and an interface that showed only the sensor it happens to be served by would
   * hide the other one's findings with nothing on screen saying so.
   */
  sensor?: string;
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
  if (query.sensor) conditions.push(eq(alerts.sensorId, query.sensor));
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

/**
 * Every sensor that has findings stored, plus this process's own.
 *
 * `this` is included even when it has never written a row, which is what makes the
 * answer usable as a filter list: a sensor that has just been installed and has
 * found nothing yet is exactly the one an operator goes looking for, and leaving it
 * out would render a correctly-configured new sensor as an installation that does
 * not exist. It is also the reason this returns a flag rather than a bare list —
 * the interface needs to say which of them it is talking to.
 *
 * Read from the data rather than from a table of sensors, deliberately. There is
 * no registration step and there should not be one: a sensor is whatever has left
 * a row behind, so the list cannot drift from what is stored, and decommissioning
 * one is deleting its rows rather than remembering to tell a registry.
 *
 * **All three sensor-scoped tables, not just `alerts`.** Reading only `alerts`
 * makes the identity shorter-lived than the data, and it fails in both
 * directions. A second sensor on a quiet segment that has learned forty devices
 * and found nothing would not appear at all — so no filter or column renders
 * anywhere, and the dashboard's device tile silently sums both sensors with no
 * way to separate them, on exactly the installation this feature is for. And once
 * retention rolls a sensor's findings into `alert_rollup_daily`, it would drop out
 * of this list while its rows go on feeding the trend chart: visible in the
 * chart, unselectable in the filter.
 *
 * **Identity only, and no counts.** This used to return a finding count and a
 * latest-seen time per sensor, aggregated over the whole `alerts` table. Nothing
 * read either one — the pickers use the ids and `self` — and the cost was not
 * incidental: `count(*)` and `max(last_seen)` grouped over a table the schema
 * documents as unbounded is a full scan, and both pages refetch this on mount and
 * again after every alert mutation. So the scan ran on a schedule set by how busy
 * the network was, worst on exactly the installations this feature is for. A
 * distinct-id read answers what the callers actually ask, and the index this
 * change adds already serves it.
 *
 * If a count belongs in the picker later, it should arrive with the column that
 * shows it rather than being carried in advance by every poll.
 */
export interface SensorSummary {
  sensorId: string;
  /** True for the sensor serving this request. */
  self: boolean;
}

export async function listSensors(): Promise<SensorSummary[]> {
  // `UNION` rather than `UNION ALL`: it deduplicates, which is the whole request.
  // Each branch is a distinct-scan of an indexed column rather than a pass over
  // the rows.
  const result = await db.execute<{ sensor_id: string }>(sql`
    SELECT DISTINCT sensor_id FROM ${alerts}
    UNION SELECT DISTINCT sensor_id FROM ${knownDevices}
    UNION SELECT DISTINCT sensor_id FROM ${alertRollupDaily}
  `);

  const summaries = (result.rows ?? []).map((row) => ({
    sensorId: row.sensor_id,
    self: row.sensor_id === env.sensorId,
  }));

  if (!summaries.some((summary) => summary.self)) {
    summaries.push({ sensorId: env.sensorId, self: true });
  }

  // By name, not by volume: this is an identity list an operator scans for a
  // known name, and an order that reshuffles as findings arrive would move the
  // entry they were reaching for.
  return summaries.sort((a, b) => a.sensorId.localeCompare(b.sensorId));
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
  /**
   * The unit `trend` is bucketed in.
   *
   * Reported rather than left for the client to infer: the width is chosen from
   * the window here, and a browser recomputing that rule is a second copy of it
   * that nothing keeps in step.
   */
  bucket: TrendBucket;
  /**
   * The instant before which detail has expired, so the trend is served from the
   * daily rollup rather than from `alerts`.
   *
   * `null` when retention is switched off, or when the window does not reach that
   * far back — in both cases there is no boundary inside the plotted range and a
   * marker would be pointing at nothing.
   *
   * The chart needs this because the two sources are not equally detailed and
   * nothing else on screen says where they change over. A rolled-up bucket
   * carries counts but no rows behind them, so a reader who clicks into a short
   * bar before the cutoff finds nothing and concludes the data is missing rather
   * than aggregated.
   */
  rolledUpBefore: string | null;
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
  bucket: TrendBucket;
  /** One sensor, or every sensor when absent — the same rule as `listAlerts`. */
  sensor?: string;
}): Promise<AlertDashboard> {
  const since = new Date(Date.now() - options.days * 86_400_000);

  /*
   * Applied to the rollup as well as to the live rows, and both are needed.
   *
   * The trend merges the two sources into one series, so filtering only the live
   * half would draw one sensor's recent days against every sensor's expired ones —
   * a chart that steps down at the retention cutoff for a reason that is not
   * retention. That is the same confusion between "deleted" and "quiet" the rollup
   * exists to prevent, arriving from the other direction.
   */
  const fromSensor = options.sensor ? eq(alerts.sensorId, options.sensor) : undefined;
  const rolledUpFromSensor = options.sensor ? eq(alertRollupDaily.sensorId, options.sensor) : undefined;

  // Both this and the rollup below are UTC buckets, and have to be: the two series
  // are merged into one chart. See alert-buckets.ts.
  const bucketExpression = utcTrunc(options.bucket, alerts.lastSeen);

  /*
   * Rolled-up days, folded into the same series as the live trend below.
   *
   * Without this the chart would answer a 365-day question with only what retention
   * has not yet expired, so a window longer than ALERT_RETENTION_DAYS would show a
   * flat line before the cutoff — history that was deleted rendered exactly like a
   * network on which nothing happened. Keeping those two distinguishable is most of
   * what this codebase's detectors are for, and the trend chart is the last place it
   * should be given away.
   *
   * Requested for every bucket except the hourly one. A daily rollup can be folded
   * upward into a week or a month — that is just addition — but not downward into
   * hours: inventing 24 equal hours from one bucket would be fabricating detail
   * that was deliberately discarded. The honest answer for an hourly window is the
   * live rows alone, and an hourly window is only offered for two days anyway. The
   * ternary keeps the "no query for hourly" behaviour while still letting this run
   * concurrently with the other three below, rather than after them.
   *
   * Whole days only: see `firstWholeUtcDay` for why the day containing `since` is
   * left out rather than counted in full.
   */
  const rolledUp: Promise<{ day: string; severity: string; total: number }[]> =
    options.bucket !== 'hour'
      ? db
          .select({
            // Cast explicitly: pg-types parses a DATE into a JS Date at *local*
            // midnight, and drizzle's PgDateString then reads it back a day early
            // on any server east of UTC. `expiredDays()` already dodges this the
            // same way.
            day: sql<string>`${alertRollupDaily.day}::text`,
            severity: alertRollupDaily.severity,
            total: alertRollupDaily.alerts,
          })
          .from(alertRollupDaily)
          .where(and(gte(alertRollupDaily.day, firstWholeUtcDay(since)), rolledUpFromSensor))
      : Promise.resolve([]);

  const [summary, trendRows, sourceRows, rolled] = await Promise.all([
    summarizeAlerts(options.sensor),
    db
      .select({
        bucket: sql<string>`${bucketExpression}`,
        severity: alerts.severity,
        total: count(),
      })
      .from(alerts)
      .where(and(gte(alerts.lastSeen, since), fromSensor))
      .groupBy(bucketExpression, alerts.severity)
      .orderBy(bucketExpression),
    db
      .select({
        sourceIp: alerts.sourceIp,
        total: count(),
        occurrences: sql<number>`coalesce(sum(${alerts.occurrences}), 0)::int`,
      })
      .from(alerts)
      .where(and(gte(alerts.lastSeen, since), sql`${alerts.sourceIp} IS NOT NULL`, fromSensor))
      .groupBy(alerts.sourceIp)
      .orderBy(desc(count()))
      .limit(8),
    rolledUp,
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
   * The two sources overlap, which is why the points are accumulated rather than
   * assigned. At a daily bucket that is exactly one day — the one the cutoff falls
   * in, whose expired half is rolled up while its recent half is still live. At a
   * weekly or monthly bucket it is every live day sharing a bucket with a rolled-up
   * one, which is most of the bucket the cutoff lands in.
   *
   * `startOfUtcBucket` is what folds a rolled-up DAY into that wider bucket, and it
   * has to produce the same key `date_trunc` gave the live rows or the week appears
   * twice. `rolled` is `[]` for an hourly bucket, so this is a no-op there.
   */
  for (const row of rolled) {
    const day = new Date(`${row.day}T00:00:00.000Z`);
    addTo(startOfUtcBucket(options.bucket, day), row.severity, Number(row.total));
  }

  const trend = [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  /*
   * Reported only when it falls inside what was plotted.
   *
   * Retention deletes detail older than `ALERT_RETENTION_DAYS` and the rollup
   * keeps the shape, so this instant is where the trend stops being rows and
   * starts being counts. Outside the window — or with retention switched off,
   * where nothing is ever rolled up — there is no crossover to mark, and a marker
   * at the edge of the axis would be read as one.
   *
   * Approximate by up to one sweep interval, deliberately: days between the cutoff
   * and the last sweep are still live. Naming the configured boundary is the
   * answer an operator can act on; naming the sweep's actual high-water mark would
   * be more precise about a number nobody sets.
   */
  const cutoff = new Date(Date.now() - env.retention.alertDays * 86_400_000);
  const withinWindow = env.retention.enabled && cutoff > since;

  return {
    ...summary,
    trend,
    bucket: options.bucket,
    rolledUpBefore: withinWindow ? cutoff.toISOString() : null,
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
export async function summarizeAlerts(sensor?: string): Promise<AlertSummary> {
  // `undefined` rather than a branch per query: drizzle drops an undefined
  // condition, so one expression serves both the filtered and the unfiltered case
  // without three copies of the same `where` written twice.
  const fromSensor = sensor ? eq(alerts.sensorId, sensor) : undefined;

  const [severityRows, kindRows, totals] = await Promise.all([
    db
      .select({ severity: alerts.severity, total: count() })
      .from(alerts)
      .where(fromSensor)
      .groupBy(alerts.severity),
    db
      .select({
        kind: alerts.kind,
        total: count(),
        occurrences: sql<number>`coalesce(sum(${alerts.occurrences}), 0)::int`,
      })
      .from(alerts)
      .where(fromSensor)
      .groupBy(alerts.kind),
    db
      .select({
        total: count(),
        unacknowledged: sql<number>`count(*) FILTER (WHERE ${alerts.acknowledgedAt} IS NULL)::int`,
        latest: sql<string | null>`max(${alerts.lastSeen})`,
      })
      .from(alerts)
      .where(fromSensor),
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

/**
 * Marks a finding as handled.
 *
 * Takes the whole `Actor` rather than a string even though it stores only the name:
 * every mutating function here takes the same parameter, so acknowledging cannot be
 * the one that quietly has less identity available if it is ever audited.
 */
export async function acknowledgeAlert(id: number, acknowledgedBy: Actor): Promise<AlertRow | null> {
  const [updated] = await db
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: acknowledgedBy.name.slice(0, 200) })
    .where(eq(alerts.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Reopens a finding, and records whose acknowledgement was cleared.
 *
 * This is a destructive write to recorded identity, which makes it the one kind of
 * write this whole feature exists to account for — and it was the last mutating
 * alert route with neither an audit entry nor a role guard. Analyst A acknowledges
 * finding 412; any authenticated account reopens it; `acknowledged_by` is NULL and
 * "who removed A's acknowledgement" was exactly as unanswerable as "who deleted
 * this finding" used to be. The README's own table claimed acknowledgement was
 * attributed, which was true right up until somebody reopened one.
 *
 * Left open to any authenticated account rather than gated on ADMIN, because
 * reopening is the reverse of a workflow action the same people perform all day —
 * the objection was never that they may do it, it was that nothing said they had.
 * The attribution is not lost now, it moves into the trail.
 */
export async function unacknowledgeAlert(id: number, actor: Actor): Promise<AlertRow | null> {
  return db.transaction(async (tx) => {
    // `FOR UPDATE`, for the reason `updateSuppression` gives: the attribution being
    // recorded has to be the one this statement actually clears, and under READ
    // COMMITTED an unlocked read lets two concurrent reopens record the same one.
    const [before] = await tx.select().from(alerts).where(eq(alerts.id, id)).limit(1).for('update');
    if (!before) return null;

    const [updated] = await tx
      .update(alerts)
      .set({ acknowledgedAt: null, acknowledgedBy: null })
      .where(eq(alerts.id, id))
      .returning();

    if (!updated) return null;

    // Only when there was an acknowledgement to clear. Reopening something already
    // open destroys no attribution, and a row saying so is one an auditor reads
    // past — the same rule as the settings save and the bulk clear.
    if (before.acknowledgedBy !== null || before.acknowledgedAt !== null) {
      await recordAudit(tx, {
        actor: actor.name,
        actorId: actor.id,
        action: 'alert.unacknowledge',
        subject: String(id),
        // Whose acknowledgement this cleared, and when it had been made: the whole
        // of what the two columns held, so the trail carries what the row no longer
        // does.
        detail: {
          was: before.acknowledgedBy,
          at: before.acknowledgedAt?.toISOString() ?? null,
          kind: before.kind,
          ...findingText(before),
        },
      });
    }

    return updated;
  });
}

/**
 * How a finding's text is carried into an audit entry.
 *
 * One shape for both representations, so the two audit writers cannot disagree
 * about which fields an entry holds. Post-V17 rows contribute the key and its
 * params — translatable when the trail is read — and pre-V17 rows contribute the
 * English sentence they were written with, which is all they have. Never both,
 * and the CHECK constraint guarantees never neither.
 */
function findingText(row: {
  title: string | null;
  messageKey: string | null;
  messageParams: unknown;
}): Record<string, unknown> {
  return row.messageKey !== null
    ? { messageKey: row.messageKey, messageParams: row.messageParams }
    : { title: row.title };
}

/**
 * Deletes one finding, recording who did it in the same transaction.
 *
 * `actor` is required rather than optional, and that is the point: a mutating
 * service function that can be called without saying who is calling it is how the
 * gap this closes came about. The compiler now asks the question at every call site.
 *
 * The audit detail carries the finding's kind, severity and text, not just its id.
 * Once the row is gone this entry is the only surviving description of what was
 * removed, and "alert 412 was deleted" answers almost nothing a year later.
 *
 * Since V17 the text is the message key and its params rather than a sentence, so
 * the trail reads in the language of whoever opens it rather than in the one the
 * sensor happened to be running. A row that predates V17 contributes its stored
 * prose instead, which is all it has.
 */
export async function deleteAlert(id: number, actor: Actor): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(alerts).where(eq(alerts.id, id)).returning({
      id: alerts.id,
      kind: alerts.kind,
      severity: alerts.severity,
      title: alerts.title,
      messageKey: alerts.messageKey,
      messageParams: alerts.messageParams,
    });

    if (!deleted) return false;

    await recordAudit(tx, {
      actor: actor.name,
      actorId: actor.id,
      action: 'alert.delete',
      subject: String(deleted.id),
      detail: { kind: deleted.kind, severity: deleted.severity, ...findingText(deleted) },
    });

    return true;
  });
}

/**
 * Clears the table.
 *
 * **Every sensor's findings, not just this one's.** The control means "empty this
 * table", and a Clear All that quietly left another sensor's rows behind would be a
 * button whose name is false — the same trade as `stopAdhoc`, where the honest
 * broad action beats the surprising narrow one. What this does instead is name the
 * sensors in the audit entry, so the trail records that somebody sitting in front
 * of one sensor removed another one's findings; without that the entry reads as a
 * local clean-up whichever sensor it happened from.
 *
 * The count and a breakdown by severity, because that is what makes the entry
 * legible: "cleared 1,204 findings, 3 of them critical" is an event worth noticing,
 * and "cleared every finding" on an empty table is not. Individual titles are
 * deliberately not recorded — a bulk clear would put thousands of rows of evidence
 * into a table that cannot be pruned.
 */
export async function deleteAllAlerts(actor: Actor): Promise<number> {
  return db.transaction(async (tx) => {
    /*
     * The delete and its histogram in one statement, counted by Postgres.
     *
     * `RETURNING` on an unqualified DELETE builds one JavaScript object per row in
     * the driver before anything is counted — inside a transaction already holding a
     * lock on every row of the table. On an installation near the retention ceiling
     * that is where clearing findings becomes heap exhaustion, and the operator
     * watches a delete hang and then roll back. Wrapping the DELETE in a CTE and
     * grouping its output keeps the rows server-side and returns one row per
     * severity, which is also exactly the shape the audit entry wants.
     *
     * Counted from the same statement rather than by a SELECT beforehand, so the
     * total cannot drift: a prior count would miss anything another transaction
     * committed in between, and the entry would then describe a different number of
     * rows than the delete removed.
     */
    const counted = await tx.execute<{ severity: string; sensor_id: string; n: number }>(sql`
      WITH deleted AS (
        DELETE FROM ${alerts} RETURNING ${alerts.severity}, ${alerts.sensorId}
      )
      SELECT severity, sensor_id, count(*)::int AS n FROM deleted GROUP BY 1, 2
    `);

    const bySeverity: Record<string, number> = {};
    const bySensor: Record<string, number> = {};
    let total = 0;
    for (const row of counted.rows ?? []) {
      const n = Number(row.n);
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + n;
      bySensor[row.sensor_id] = (bySensor[row.sensor_id] ?? 0) + n;
      total += n;
    }

    // Only when something was actually cleared, matching every other audited path
    // here. Recording a no-op would append `{ deleted: 0 }` every time somebody
    // clicked Clear on an empty table — permanently, since nothing prunes this
    // table — into the record an auditor reads to find the acts that mattered.
    if (total > 0) {
      await recordAudit(tx, {
        actor: actor.name,
        actorId: actor.id,
        action: 'alerts.clear',
        detail: { deleted: total, bySeverity, bySensor },
      });
    }

    return total;
  });
}
