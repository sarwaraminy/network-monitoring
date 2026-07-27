import { and, asc, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { type AlertRow, alerts } from '../db/schema.js';
import { componentLogger } from '../logger.js';
import { type Finding, SEVERITY_RANK, type Severity } from '../packet/detect/types.js';

const log = componentLogger('alerts');

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

  /** Records findings and schedules a flush. Never throws. */
  record(findings: Finding[]): void {
    for (const finding of findings) {
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

    if (this.pending.size > 0) this.scheduleFlush();
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
    if (this.flushing || this.pending.size === 0) return;
    this.flushing = true;

    const batch = [...this.pending.entries()];
    this.pending.clear();

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
        } catch (error) {
          log.error(
            { finding: entry.finding.title, kind: entry.finding.kind, err: error },
            'Could not save alert',
          );
        }
      }
    } finally {
      this.flushing = false;
      // Anything recorded while we were writing needs its own flush.
      if (this.pending.size > 0) this.scheduleFlush();
    }
  }

  /** Flushes and stops the timer. Used when a capture stops. */
  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
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

  // The unit has to be inlined, not bound: as a parameter it becomes date_trunc($1,
  // …) in SELECT and date_trunc($2, …) in GROUP BY, which Postgres treats as two
  // different expressions and rejects. Safe to inline because `bucket` is a
  // closed union validated at the route boundary, but assert it rather than trust it.
  const truncUnit = options.bucket === 'hour' ? 'hour' : 'day';
  const bucketExpression = sql`date_trunc('${sql.raw(truncUnit)}', ${alerts.lastSeen})`;

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
  for (const row of trendRows) {
    const key = new Date(row.bucket).toISOString();
    let point = byBucket.get(key);
    if (!point) {
      point = { bucket: key, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      byBucket.set(key, point);
    }
    if (row.severity in point) {
      point[row.severity as Severity] = Number(row.total);
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
