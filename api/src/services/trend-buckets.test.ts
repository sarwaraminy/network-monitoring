import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * The trend at a bucket wider than a day, against real SQL.
 *
 * A database test rather than a unit test, because the thing that can go wrong
 * lives between two sources. Live rows are bucketed by Postgres's `date_trunc`;
 * rolled-up days arrive one per day out of `alert_rollup_daily` and are folded
 * into the same bucket by `startOfUtcBucket`. If those two disagree about when a
 * week begins, nothing throws — the chart just draws every week twice, as two
 * interleaved families of points, which reads as a network that alternates.
 *
 * `alert-buckets.test.ts` pins the two halves separately and cheaply. This is the
 * one that puts them together.
 *
 * Retention is set short so a sweep here actually rolls something up: the whole
 * question is what happens either side of the cutoff.
 */

process.env.SENSOR_ID = 'trend-sensor';
process.env.RETENTION_ENABLED = 'true';
process.env.ALERT_RETENTION_DAYS = '30';
process.env.DEVICE_RETENTION_DAYS = '30';

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const database = await openTestDatabase({ id: 'trendbuckets' });

let alertService: typeof import('./alert.service.js');
let retention: typeof import('./retention.service.js');

async function seedAlert(dedupKey: string, lastSeen: Date, severity = 'medium') {
  await database.pool!.query(
    `INSERT INTO alerts
       (sensor_id, kind, severity, title, description, dedup_key, source_ip,
        first_seen, last_seen, occurrences, evidence)
     VALUES ('trend-sensor', 'port_scan', $1, 'seeded', 'Seeded by trend-buckets.test.ts',
             $2, '10.0.0.1', $3, $3, 1, '{}'::jsonb)`,
    [severity, dedupKey, lastSeen],
  );
}

/**
 * The start of a week or month that is well past the cutoff.
 *
 * Snapped because the first version of this used `cutoff + 4 days` and let the
 * fixture straddle a week boundary, so it failed on arithmetic rather than on
 * behaviour. A fixture that only holds on some days of the week is worse than
 * none: it fails intermittently and blames the code.
 *
 * The seeds below are then placed *inside* the period rather than on this
 * boundary, and that matters. The second version of this test seeded the
 * rolled-up day on the Monday itself — which is already the week's key, so
 * folding it was a no-op and the test passed with the fold deleted. It was
 * passing for the wrong reason, which is the failure mode a test exists to not
 * have.
 */
function expiredStartOf(unit: 'week' | 'month'): Date {
  const at = new Date(Date.now() - (RETENTION_DAYS + 3) * DAY_MS);
  if (unit === 'month') {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  }
  const backToMonday = (at.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - backToMonday));
}

type Trend = Awaited<ReturnType<typeof alertService.dashboardData>>['trend'];

const findingsIn = (point: Trend[number]) =>
  point.critical + point.high + point.medium + point.low + point.info;

/** Total findings across every bucket, so a double-count shows as a wrong sum. */
const totalOf = (trend: Trend) => trend.reduce((sum, point) => sum + findingsIn(point), 0);

/**
 * How many buckets hold anything.
 *
 * The count is what actually tests the fold. A total alone passes whether the two
 * sources landed in one bucket or two — which is how the first version of the
 * month case here went on passing with the fold deleted.
 */
const occupiedIn = (trend: Trend) => trend.filter((point) => findingsIn(point) > 0).length;

describe('the trend at a bucket wider than a day', { skip: database.skip }, () => {
  before(async () => {
    alertService = await import('./alert.service.js');
    retention = await import('./retention.service.js');
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  after(async () => {
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('folds rolled-up days and live rows into the same week', async () => {
    /*
     * Two findings in one calendar week, on either side of the retention cutoff:
     * one old enough to be rolled up, one recent enough to still be a row. They
     * have to land in ONE bucket. Before the fold they could not — the rollup was
     * only ever merged at a daily bucket.
     */
    const monday = expiredStartOf('week');
    // Wednesday, not Monday: the rolled-up day has to need folding for this to
    // test the folding.
    await seedAlert('old-one', new Date(monday.getTime() + 2 * DAY_MS));
    await retention.sweepRetention();

    const { rows } = await database.pool!.query<{ n: string }>(
      'SELECT count(*) AS n FROM alert_rollup_daily',
    );
    assert.ok(Number(rows[0]!.n) > 0, 'the fixture must actually have been rolled up');

    /*
     * Inserted AFTER the sweep, which is what keeps it a live row despite being
     * older than the cutoff — nothing sweeps again. That is the point: this is one
     * calendar week holding both a rolled-up day and an un-swept row, which is
     * exactly the state a real installation is in between sweeps.
     */
    await seedAlert('live-one', new Date(monday.getTime() + 4 * DAY_MS));

    const weekly = await alertService.dashboardData({ days: 365, bucket: 'week' });

    assert.equal(totalOf(weekly.trend), 2, 'a finding was dropped or counted twice');
    assert.equal(
      occupiedIn(weekly.trend),
      1,
      'the rolled-up day and the live row landed in different weeks — the two truncations disagree',
    );
  });

  it('folds a month the same way', async () => {
    const first = expiredStartOf('month');
    // The 6th and the 8th, so neither seed sits on the month's own key.
    await seedAlert('old-one', new Date(first.getTime() + 5 * DAY_MS));
    await retention.sweepRetention();
    await seedAlert('live-one', new Date(first.getTime() + 7 * DAY_MS));

    const monthly = await alertService.dashboardData({ days: 1825, bucket: 'month' });
    assert.equal(totalOf(monthly.trend), 2);
    assert.equal(
      occupiedIn(monthly.trend),
      1,
      'the rolled-up day and the live row landed in different months',
    );
  });

  it('reports the bucket it used, so the client does not have to guess', async () => {
    await seedAlert('one', new Date());

    // The route picks this from the window; the response says which was picked.
    assert.equal((await alertService.dashboardData({ days: 365, bucket: 'week' })).bucket, 'week');
    assert.equal((await alertService.dashboardData({ days: 1, bucket: 'hour' })).bucket, 'hour');
  });

  it('leaves the hourly bucket served from live rows alone', async () => {
    /*
     * The one bucket the rollup must NOT be folded into. A daily total cannot be
     * split into 24 hours without inventing detail that was deliberately deleted,
     * so an hourly window answers from `alerts` and stops there.
     */
    const expired = new Date(Date.now() - (RETENTION_DAYS + 3) * DAY_MS);
    await seedAlert('old-one', expired);
    await retention.sweepRetention();

    const hourly = await alertService.dashboardData({ days: 2, bucket: 'hour' });
    assert.equal(totalOf(hourly.trend), 0, 'a rolled-up day was spread across hours');
  });
  /*
   * Nested rather than a second top-level `describe`, because the teardown above
   * closes the pool at the end of its own suite — a sibling would run against a
   * closed database and fail on that rather than on anything it asserts.
   */
  it('marks the cutoff when the window reaches past it', async () => {
    const dashboard = await alertService.dashboardData({ days: 365, bucket: 'week' });

    assert.ok(dashboard.rolledUpBefore, 'a 365-day window reaches past a 30-day retention');
    const at = new Date(dashboard.rolledUpBefore as string).getTime();
    const expected = Date.now() - RETENTION_DAYS * DAY_MS;
    // Within a minute: the boundary is computed from `Date.now()` on each call.
    assert.ok(Math.abs(at - expected) < 60_000, `boundary was ${dashboard.rolledUpBefore}`);
  });

  it('says nothing when the whole window is still detailed', async () => {
    // Seven days against a thirty-day retention: everything plotted is a row, so a
    // marker would be pointing off the left edge of the axis at nothing.
    const dashboard = await alertService.dashboardData({ days: 7, bucket: 'day' });
    assert.equal(dashboard.rolledUpBefore, null);
  });
});
