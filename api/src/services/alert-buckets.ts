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
export function utcTrunc(unit: 'hour' | 'day', column: PgColumn): SQL {
  return sql`date_trunc('${sql.raw(unit)}', ${column} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
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
