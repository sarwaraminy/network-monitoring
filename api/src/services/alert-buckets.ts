import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * How the dashboard's trend chart keys a bucket.
 *
 * Its own module because the trend reads two tables that must agree: live rows out
 * of `alerts`, bucketed here, and expired days out of `alert_rollup_daily`, bucketed
 * by the retention sweep. Both sides are UTC by construction, and the two functions
 * that make that true are worth having somewhere they can be asserted directly
 * rather than only through a query that needs a database.
 */

/**
 * `date_trunc`, in UTC, whatever the database session's `TimeZone` is.
 *
 * A bare `date_trunc('day', ts)` on a `timestamptz` truncates in the session
 * timezone, so the same rows bucket differently on two servers — on `Asia/Kabul` a
 * finding at 22:30Z lands in the next day, and because that offset is `+04:30` even
 * an hourly bucket comes out on the half hour. The retention sweep pins UTC on the
 * write side; this is the same pin on the read side, and it has to be, because the
 * trend merges these rows with rollup rows keyed by UTC date. Without it the two
 * sources label the same calendar day differently and the chart gets two interleaved
 * point families instead of one series.
 *
 * `AT TIME ZONE 'UTC'` twice on purpose: the first converts the `timestamptz` to a
 * UTC wall clock, so the truncation is plain arithmetic with no timezone in it, and
 * the second reads that wall clock back as `timestamptz` — which is also what makes
 * node-postgres hand back a correct `Date` rather than parsing a bare `timestamp` as
 * local time.
 *
 * The unit is inlined rather than bound. As a parameter it becomes `date_trunc($1,
 * …)` in SELECT and `date_trunc($2, …)` in GROUP BY, which Postgres treats as two
 * different expressions and rejects; the type keeps it a closed set.
 */
export function utcTrunc(unit: TrendBucket, column: PgColumn): SQL {
  return sql`date_trunc('${sql.raw(unit)}', ${column} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
}

/**
 * The units the trend can be bucketed into, coarsest last.
 *
 * All four are `date_trunc` units, which is what lets `utcTrunc` inline the name
 * and what keeps the rollup fold-in below able to reproduce the same boundary in
 * JavaScript. Nothing else may be added here without giving `startOfUtcBucket` a
 * matching case — the two have to agree or the chart gets two interleaved point
 * families instead of one series.
 */
export const TREND_BUCKETS = ['hour', 'day', 'week', 'month'] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

/**
 * How wide a bucket a window of `days` should be plotted in.
 *
 * A chart is about 800px wide and a readable column is several pixels, so the
 * real constraint is the bar count rather than the unit. Five years at a daily
 * bucket is 1,825 bars in that space: they render as a solid block, the axis
 * labels collapse, and the one question the chart exists to answer — is this
 * getting worse — becomes unanswerable at exactly the window where a trend is
 * most likely to be real.
 *
 *   ≤ 2 days   hourly    24–48 bars
 *   ≤ 90 days  daily     up to 90
 *   ≤ 365 days weekly    ~52
 *   beyond     monthly   ~60 at the five-year option
 *
 * **The server decides this, not the browser.** The client used to compute
 * `days <= 2 ? 'hour' : 'day'` for its axis labels while the route computed the
 * same expression for the query, so the rule existed twice with nothing holding
 * the copies together — and a third and fourth unit is exactly the change that
 * would have separated them. The bucket is reported in the response now, and
 * `?bucket=` is still honoured for a caller that wants to override it.
 */
export function trendBucketFor(days: number): TrendBucket {
  if (days <= 2) return 'hour';
  if (days <= 90) return 'day';
  if (days <= 365) return 'week';
  return 'month';
}

/**
 * The start of the bucket an instant falls in, in UTC, as an ISO string.
 *
 * The JavaScript half of `utcTrunc`, and it exists because the rollup is keyed by
 * DATE. Live rows can be bucketed by Postgres; rolled-up days arrive one per day
 * and have to be folded into the same weekly or monthly bucket here, so the two
 * sources land on one key. A week that started on Sunday on one side and Monday
 * on the other would draw every week twice.
 *
 * Monday, therefore, because that is what `date_trunc('week', …)` does — not a
 * preference, a constraint. `getUTCDay()` counts Sunday as 0, so the offset back
 * to Monday is `(day + 6) % 7`.
 */
export function startOfUtcBucket(unit: TrendBucket, at: Date): string {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const date = at.getUTCDate();

  switch (unit) {
    case 'hour':
      return new Date(Date.UTC(year, month, date, at.getUTCHours())).toISOString();
    case 'day':
      return new Date(Date.UTC(year, month, date)).toISOString();
    case 'week': {
      const backToMonday = (at.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(year, month, date - backToMonday)).toISOString();
    }
    case 'month':
      return new Date(Date.UTC(year, month, 1)).toISOString();
  }
}

/**
 * The first UTC day wholly inside the window, as `YYYY-MM-DD`.
 *
 * `alert_rollup_daily` is keyed by date, so it can only be filtered by date — and
 * filtering at the date *containing* `since` pulls in the whole of that day, up to
 * 24h of history from before the window. How much depends on the time of day the
 * request is made, so the same `days=30` request returned a different oldest bar in
 * the morning than in the evening.
 *
 * Rounding up drops that day instead. The bar is then missing rather than inflated,
 * which is the better failure of the two: a partial day cannot be reconstructed from
 * a daily bucket, and a window that quietly reaches further back than was asked for
 * is the kind of thing that gets read as a real change in the network.
 */
export function firstWholeUtcDay(since: Date): string {
  const midnight = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate());
  const day = midnight < since.getTime() ? midnight + 86_400_000 : midnight;
  return new Date(day).toISOString().slice(0, 10);
}
