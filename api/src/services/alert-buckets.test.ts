import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { alerts } from '../db/schema.js';
import { firstWholeUtcDay, utcTrunc } from './alert-buckets.js';

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
const compile = (unit: 'hour' | 'day'): string => dialect.sqlToQuery(utcTrunc(unit, alerts.lastSeen)).sql;

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
