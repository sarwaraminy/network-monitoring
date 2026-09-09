import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { alerts } from '../db/schema.js';
import {
  firstWholeUtcDay,
  startOfUtcBucket,
  TREND_BUCKETS,
  type TrendBucket,
  trendBucketFor,
  utcTrunc,
} from './alert-buckets.js';

/**
 * The dashboard trend reads two tables and plots one series.
 *
 * Live rows come out of `alerts`, bucketed by `utcTrunc`; expired days come out of
 * `alert_rollup_daily`, bucketed by the retention sweep and filtered by
 * `firstWholeUtcDay`. If the two disagree about what a day is, or about which days
 * the window covers, the chart does not fail — it draws two interleaved families of
 * points, or an oldest bar that changes size depending on the hour the page was
 * opened. Both are the sort of thing that gets read as a change in the network.
 */

const dialect = new PgDialect();
const compile = (unit: TrendBucket): string => dialect.sqlToQuery(utcTrunc(unit, alerts.lastSeen)).sql;

describe('the live bucket expression', () => {
  /*
   * Asserted on the compiled SQL, which is unusual here and deliberate. The
   * behaviour itself belongs to Postgres — `date_trunc` reads the session's
   * `TimeZone`, and mocking a database to prove what a database does would be
   * testing the mock, so that half is verified against a real server and written up
   * in the pull request. What a test can hold on to is the pin itself: this bug has
   * now been introduced twice, both times by writing the obvious `date_trunc('day',
   * ts)`, and both times it was invisible until someone ran the server in a
   * timezone that was not UTC.
   */
  it('pins the truncation to UTC rather than the session timezone', () => {
    const sql = compile('day');

    assert.match(sql, /date_trunc\('day', "alerts"\."last_seen" AT TIME ZONE 'UTC'\)/);
    assert.doesNotMatch(sql, /date_trunc\('day', "alerts"\."last_seen"\)/);
  });

  it('converts the truncated wall clock back to an instant', () => {
    // Without the second conversion the column comes back as `timestamp without
    // time zone`, which node-postgres parses as *local* time — reintroducing the
    // same offset one layer up, in JavaScript, where it is harder to see.
    assert.match(compile('day'), /\) AT TIME ZONE 'UTC'$/);
  });

  it('pins the hourly bucket too, where a half-hour offset would show', () => {
    // Hourly looks safe from a timezone bug until the server sits in one of the
    // offsets that is not a whole hour: on Asia/Kabul, +04:30, session-local hourly
    // buckets land on the half hour.
    assert.match(compile('hour'), /date_trunc\('hour', "alerts"\."last_seen" AT TIME ZONE 'UTC'\)/);
  });

  it('takes no bind parameters, so it can be reused in GROUP BY', () => {
    // The unit is inlined for exactly this reason: as a parameter it compiles to
    // date_trunc($1, …) in SELECT and date_trunc($2, …) in GROUP BY, which Postgres
    // treats as two different expressions and rejects.
    assert.deepEqual(dialect.sqlToQuery(utcTrunc('day', alerts.lastSeen)).params, []);
  });
});

describe('the first rollup day of a window', () => {
  const dayOf = (iso: string): string => firstWholeUtcDay(new Date(iso));

  it('never starts before the window does', () => {
    /*
     * The invariant, and the one the first version broke: `since.slice(0, 10)`
     * named the day *containing* the window's start, so the oldest bar carried the
     * whole of that day — up to 24h of history from outside the window, and a
     * different amount of it depending on the time of day the request was made.
     */
    for (const iso of [
      '2026-09-02T00:00:00.000Z',
      '2026-09-02T00:00:00.001Z',
      '2026-09-02T06:00:00.000Z',
      '2026-09-02T12:34:56.789Z',
      '2026-09-02T23:59:59.999Z',
    ]) {
      const since = new Date(iso);
      const start = Date.parse(`${firstWholeUtcDay(since)}T00:00:00.000Z`);

      assert.ok(start >= since.getTime(), `${firstWholeUtcDay(since)} starts before ${iso}`);
      // And is the *earliest* such day: rounding up must not skip past whole days
      // that the window does cover.
      assert.ok(start - 86_400_000 < since.getTime(), `${firstWholeUtcDay(since)} skipped a whole day`);
    }
  });

  it('keeps a window that begins exactly at midnight', () => {
    // The only case where the containing day is wholly inside the window. Rounding
    // up unconditionally would throw away a day that was asked for.
    assert.equal(dayOf('2026-09-02T00:00:00.000Z'), '2026-09-02');
  });

  it('rounds a partial day up to the next one', () => {
    assert.equal(dayOf('2026-09-02T00:00:00.001Z'), '2026-09-03');
    assert.equal(dayOf('2026-09-02T23:59:59.999Z'), '2026-09-03');
  });

  it('crosses a month boundary', () => {
    assert.equal(dayOf('2026-08-31T09:00:00.000Z'), '2026-09-01');
  });

  it('crosses a year boundary', () => {
    assert.equal(dayOf('2026-12-31T09:00:00.000Z'), '2027-01-01');
  });

  it('answers a whole UTC day the same way all day long', () => {
    // The user-visible symptom was that `days=30` returned a different oldest bar
    // in the morning than in the evening. Two requests whose windows begin on the
    // same UTC day must agree about where the rollup series starts.
    assert.equal(dayOf('2026-09-02T06:00:00.000Z'), dayOf('2026-09-02T20:00:00.000Z'));
  });

  it('reads the date in UTC, not in the process timezone', () => {
    /*
     * `getUTCFullYear`/`getUTCMonth`/`getUTCDate`, fed to `Date.UTC`. Mixing local
     * components into a UTC constructor is the same class of bug as the SQL one
     * above and just as invisible from a server that happens to run in UTC, so the
     * timezone is forced here rather than inherited. Honolulu is far enough west
     * that the local date of 01:30Z is the previous day, which is what moves the
     * answer: whole days are counted from UTC midnight, not from local midnight.
     */
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Honolulu';
      assert.equal(dayOf('2026-09-02T01:30:00.000Z'), '2026-09-03');
      // And once more from the other side of UTC, where the local date runs ahead.
      process.env.TZ = 'Pacific/Kiritimati';
      assert.equal(dayOf('2026-09-02T22:30:00.000Z'), '2026-09-03');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

/**
 * How wide a bucket a window gets.
 *
 * The thresholds themselves are a judgement about how many bars fit in about
 * 800px; what is pinned here is that they are monotonic and that the extremes
 * land where the chart can render them. Five years at a daily bucket is 1,825
 * bars, which was the state this replaced.
 */
describe('choosing the bucket width', () => {
  it('gives every offered window a readable number of bars', () => {
    // The six options the dashboard actually offers, and the bar count each
    // produces. Nothing here should approach four figures.
    const bars: Record<number, number> = {
      1: 24,
      7: 7,
      30: 30,
      90: 90,
      365: 53,
      1825: 61,
    };
    const per: Record<TrendBucket, number> = { hour: 1 / 24, day: 1, week: 7, month: 30.4 };

    for (const [days, expected] of Object.entries(bars)) {
      const width = per[trendBucketFor(Number(days))];
      assert.ok(
        Math.abs(Number(days) / width - expected) < 3,
        `${days} days gives about ${Math.round(Number(days) / width)} bars, expected about ${expected}`,
      );
    }
  });

  it('never gets finer as the window gets longer', () => {
    // A window that widened into a *narrower* bucket would be the one arrangement
    // that is strictly worse than not choosing at all.
    let previous = 0;
    for (let days = 1; days <= 2000; days += 1) {
      const index = TREND_BUCKETS.indexOf(trendBucketFor(days));
      assert.ok(index >= previous, `${days} days stepped back to ${trendBucketFor(days)}`);
      previous = index;
    }
  });

  it('keeps the hourly bucket to the window the API allows it for', () => {
    // `alertDashboardQuerySchema` refuses `bucket=hour` beyond MAX_HOURLY_DAYS, so
    // a default that reached past it would be rejected by the same request that
    // produced it.
    assert.equal(trendBucketFor(1), 'hour');
    assert.equal(trendBucketFor(2), 'hour');
    assert.equal(trendBucketFor(3), 'day');
  });
});

/**
 * The JavaScript half of the truncation, which has to agree with Postgres.
 *
 * Live rows are bucketed by `date_trunc`; rolled-up rows arrive one per DAY and
 * are folded into the same bucket here. A week that starts on Sunday on one side
 * and Monday on the other draws every week twice — no error, just a chart with
 * two interleaved families of points.
 */
describe('folding a rolled-up day into its bucket', () => {
  const at = (iso: string) => new Date(iso);

  it('starts the week on Monday, as date_trunc does', () => {
    // Sunday is the trap: `getUTCDay()` calls it 0, so a naive subtraction of the
    // day index moves it FORWARD into the week that has not started yet.
    assert.equal(startOfUtcBucket('week', at('2026-09-06T00:00:00.000Z')), '2026-08-31T00:00:00.000Z');
    assert.equal(startOfUtcBucket('week', at('2026-09-07T00:00:00.000Z')), '2026-09-07T00:00:00.000Z');
    assert.equal(startOfUtcBucket('week', at('2026-09-09T13:45:00.000Z')), '2026-09-07T00:00:00.000Z');
  });

  it('starts the month on the first', () => {
    assert.equal(startOfUtcBucket('month', at('2026-09-30T23:59:59.999Z')), '2026-09-01T00:00:00.000Z');
    assert.equal(startOfUtcBucket('month', at('2026-01-01T00:00:00.000Z')), '2026-01-01T00:00:00.000Z');
  });

  it('crosses a year boundary without leaving the year behind', () => {
    // 1 January 2027 is a Friday, so its week began in December.
    assert.equal(startOfUtcBucket('week', at('2027-01-01T00:00:00.000Z')), '2026-12-28T00:00:00.000Z');
  });

  it('is idempotent, so a folded key folds to itself', () => {
    // The merge keys on this string. If folding a bucket start produced a
    // different start, a bucket could not be added to twice.
    for (const unit of TREND_BUCKETS) {
      const once = startOfUtcBucket(unit, at('2026-09-09T13:45:30.500Z'));
      assert.equal(startOfUtcBucket(unit, new Date(once)), once, unit);
    }
  });

  it('discards everything finer than the unit', () => {
    assert.equal(startOfUtcBucket('hour', at('2026-09-09T13:45:30.500Z')), '2026-09-09T13:00:00.000Z');
    assert.equal(startOfUtcBucket('day', at('2026-09-09T13:45:30.500Z')), '2026-09-09T00:00:00.000Z');
  });
});
