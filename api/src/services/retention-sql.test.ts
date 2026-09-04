import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * Retention, in the part that IS the SQL.
 *
 * `retention.test.ts` covers everything around the sweep — the disabled escape
 * hatch, the scheduler — and says why it stops there: "the substance of this
 * feature is SQL, and mocking a database to assert that SQL would be testing the
 * mock. That half is verified against a real Postgres and written up in the pull
 * request." Written up, and then trusted. Four real bugs got through that way and
 * were caught in review rather than by anything standing:
 *
 *  1. **Buckets resolved in the session's timezone.** `date_trunc('day', ts)`
 *     uses the session `TimeZone`, so on a server set to Asia/Kabul a finding at
 *     22:30Z landed in the NEXT day's bucket — while the column's own comment
 *     claimed UTC, and two machines rolled the same data up differently.
 *  2. **Whole days deleted when only part had expired.** The day list comes from
 *     rows past the cutoff, but a day CONTAINS rows newer than it, so alerts
 *     still inside the retention window were deleted by up to 24 hours.
 *  3. **The rollup filter, missing from the INSERT.** The same fault on the
 *     other statement: rows still inside the window were counted into the
 *     bucket, so the aggregate claimed findings that had not expired.
 *  4. **Concurrent sweeps double-counting.** Two sweeps on the same day both run
 *     the aggregate INSERT — the second still sees the rows, because the first
 *     has not committed its DELETE — and the additive ON CONFLICT sums both.
 *
 * The first of those is the reason this file opens its database with an explicit
 * `sessionTimeZone`. On a UTC session the bug is invisible, and every CI runner
 * is UTC — a test that did not choose the zone would have passed against it.
 *
 * `Asia/Kabul` specifically: +04:30. A half-hour offset catches an implementation
 * that "handles timezones" by adding whole hours, which a +05:00 zone would not.
 */

/** Comfortably past the 7-day floor, so the configured window is the real one. */
const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Set BEFORE the database is opened, not in a `before` hook.
 *
 * `env.ts` reads `process.env` once, at module load, and opening the database
 * loads it — the harness imports the migration runner, which imports the pool,
 * which imports `env`. Setting these in a hook is therefore too late: they would
 * be ignored, the suite would run against the default window instead of this
 * one, and every assertion here would be about a cutoff the test did not choose.
 * That is not hypothetical — it is what the first version of this file did, and
 * it presented as "the sweep found nothing" rather than as a configuration
 * mistake.
 */
process.env.RETENTION_ENABLED = 'true';
process.env.ALERT_RETENTION_DAYS = String(RETENTION_DAYS);
process.env.DEVICE_RETENTION_DAYS = String(RETENTION_DAYS);

const database = await openTestDatabase({ id: 'retention', sessionTimeZone: 'Asia/Kabul' });

let retention: typeof import('./retention.service.js');

/**
 * Inserts one alert with `lastSeen` exactly where the test wants it.
 *
 * `dedup_key` is unique per row rather than shared, because the application
 * upserts on it — two seeds sharing one key would silently become a single row
 * and every count below would be off by the number of collisions, which reads as
 * an over-deletion rather than as a bad fixture.
 */
let seeded = 0;
async function seedAlert(lastSeen: Date, options: { kind?: string; occurrences?: number } = {}) {
  const { kind = 'port_scan', occurrences = 1 } = options;
  seeded += 1;
  await database.pool!.query(
    `INSERT INTO alerts
       (kind, severity, title, description, dedup_key, source_ip, first_seen, last_seen, occurrences, evidence)
     VALUES ($1, 'medium', $2, 'Seeded by retention-sql.test.ts', $3, '10.0.0.1', $4, $4, $5, '{}'::jsonb)`,
    [kind, `${kind} from 10.0.0.1`, `retention-sql-${seeded}`, lastSeen, occurrences],
  );
}

const countAlerts = async () =>
  Number((await database.pool!.query<{ n: string }>('SELECT count(*) AS n FROM alerts')).rows[0]!.n);

/** The rollup, as `day` text so an assertion reads as the date a human means. */
async function buckets() {
  const { rows } = await database.pool!.query<{
    day: string;
    kind: string;
    alerts: number;
    occurrences: string;
  }>(`SELECT day::text AS day, kind, alerts, occurrences FROM alert_rollup_daily ORDER BY day, kind`);
  return rows;
}

describe('retention against a real Postgres', { skip: database.skip }, () => {
  before(async () => {
    retention = await import('./retention.service.js');
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  after(async () => {
    await retention.retentionIdle();
    await database.pool?.end();
    // See auth-admission.test.ts: without this the process lingers for the
    // application pool's 30s idle timeout after the last assertion.
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('buckets by UTC day even when the session is not UTC', async () => {
    /*
     * 22:30 UTC on the 10th is 03:00 on the 11th in Asia/Kabul. A bucket
     * expression resolved in the session zone puts this row in the 11th; the
     * column means UTC, so it belongs in the 10th.
     */
    const lateOnTheTenth = new Date('2024-03-10T22:30:00.000Z');
    await seedAlert(lateOnTheTenth);

    const result = await retention.sweepRetention(
      lateOnTheTenth.getTime() + RETENTION_DAYS * DAY_MS + DAY_MS,
    );

    assert.equal(result.skipped, false, 'the sweep did not run');
    const rolled = await buckets();
    assert.equal(rolled.length, 1, 'expected exactly one bucket');
    assert.equal(rolled[0]!.day, '2024-03-10', 'the row was bucketed in the session timezone, not UTC');
  });

  it('takes only the expired part of a partially expired day', async () => {
    /*
     * One day, two rows, cutoff between them. Deleting the whole day — which is
     * what the day list alone would say to do — takes a finding that is still
     * inside the retention window, by up to 24 hours. Against the 7-day floor
     * that is a seventh of the window.
     */
    const day = '2024-06-01';
    const expired = new Date(`${day}T01:00:00.000Z`);
    const stillInWindow = new Date(`${day}T23:00:00.000Z`);
    await seedAlert(expired, { kind: 'expired_half' });
    await seedAlert(stillInWindow, { kind: 'live_half' });

    // Noon on that day, plus the window: 01:00 has expired, 23:00 has not.
    const now = new Date(`${day}T12:00:00.000Z`).getTime() + RETENTION_DAYS * DAY_MS;
    const result = await retention.sweepRetention(now);

    assert.equal(result.alertsDeleted, 1, 'the sweep deleted more than the expired half');
    assert.equal(await countAlerts(), 1, 'a finding still inside the window was deleted');

    const rolled = await buckets();
    // Bug 3, the same fault on the INSERT: a bucket that counted the unexpired
    // row would claim two findings for a day only one of which has aged out.
    assert.equal(rolled.length, 1, 'the rollup counted a row that had not expired');
    assert.equal(rolled[0]!.kind, 'expired_half');
    assert.equal(rolled[0]!.alerts, 1);
  });

  it('folds the rest of that day in when it expires later, rather than replacing it', async () => {
    // The other half of the partial-day rule, and the reason ON CONFLICT adds
    // instead of overwriting: a day rolled up twice must end up with the sum.
    const day = '2024-06-02';
    await seedAlert(new Date(`${day}T01:00:00.000Z`), { occurrences: 3 });
    await seedAlert(new Date(`${day}T23:00:00.000Z`), { occurrences: 4 });

    await retention.sweepRetention(new Date(`${day}T12:00:00.000Z`).getTime() + RETENTION_DAYS * DAY_MS);
    await retention.sweepRetention(new Date(`${day}T23:30:00.000Z`).getTime() + RETENTION_DAYS * DAY_MS);

    const rolled = await buckets();
    assert.equal(rolled.length, 1, 'the second sweep wrote a second bucket for one day');
    assert.equal(rolled[0]!.alerts, 2, 'the second rollup replaced the first rather than adding to it');
    assert.equal(Number(rolled[0]!.occurrences), 7, 'occurrences did not accumulate');
    assert.equal(await countAlerts(), 0);
  });

  it('leaves everything inside the window alone', async () => {
    // The guard that makes the others mean something: a sweep that deleted
    // nothing would satisfy "did not over-delete" trivially, and a sweep that
    // deleted everything would satisfy nothing at all.
    await seedAlert(new Date('2024-06-03T10:00:00.000Z'));

    const result = await retention.sweepRetention(new Date('2024-06-04T10:00:00.000Z').getTime());

    assert.equal(result.skipped, false);
    assert.equal(result.alertsDeleted, 0);
    assert.equal(result.daysProcessed, 0, 'a day still inside the window was processed');
    assert.equal(await countAlerts(), 1);
    assert.deepEqual(await buckets(), []);
  });

  it('lets only one of two sweeps in this process do the work', async () => {
    /*
     * The cheap guard: an in-process flag, for the common overlap of this
     * process's own interval firing while a long reclaim is still going.
     *
     * Started without awaiting the first, so they genuinely overlap. Note what
     * this does NOT cover — two sweeps in one process never reach the advisory
     * lock, because the flag turns the second back first. The cross-process case
     * is the test below, and finding that out is why both exist: this one was
     * written claiming to cover the lock, and reintroducing the lock bug left it
     * green.
     */
    const day = '2024-06-04';
    await seedAlert(new Date(`${day}T01:00:00.000Z`), { occurrences: 5 });
    const now = new Date(`${day}T12:00:00.000Z`).getTime() + RETENTION_DAYS * DAY_MS;

    const [first, second] = await Promise.all([retention.sweepRetention(now), retention.sweepRetention(now)]);

    const outcomes = [first.skipped, second.skipped].sort();
    assert.deepEqual(outcomes, [false, 'in-progress'], 'both sweeps ran, or neither did');

    const rolled = await buckets();
    assert.equal(rolled.length, 1);
    assert.equal(rolled[0]!.alerts, 1, 'the day was counted twice');
    assert.equal(Number(rolled[0]!.occurrences), 5, 'occurrences were double-counted');
  });

  it('stands down when another process is already sweeping', async () => {
    /*
     * The advisory lock, which is the guard that actually matters: two
     * PROCESSES sharing a database, both on their own interval. Without it both
     * run the aggregate INSERT — the second still sees the rows, because the
     * first has not committed its DELETE — and the additive ON CONFLICT sums
     * them, so the bucket claims twice the findings that ever existed.
     *
     * Held from a connection of this test's own, which is the only way to
     * simulate another process from inside one: advisory locks are per-session,
     * so a lock taken on a separate client is invisible to this process's flag
     * and indistinguishable from a second deployment holding it.
     *
     * The key is duplicated from the service rather than exported for this.
     * Exporting a constant only so a test can read it widens the surface to
     * prove something about the inside; and if the two ever drift, this test
     * fails loudly — the sweep would take its own uncontended lock and report
     * `false` where the assertion wants `in-progress` — rather than passing for
     * the wrong reason.
     */
    const SWEEP_LOCK_KEY = 7_213_559_001;

    const day = '2024-06-05';
    await seedAlert(new Date(`${day}T01:00:00.000Z`), { occurrences: 9 });
    const now = new Date(`${day}T12:00:00.000Z`).getTime() + RETENTION_DAYS * DAY_MS;

    const holder = await database.pool!.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [SWEEP_LOCK_KEY]);

      const result = await retention.sweepRetention(now);

      assert.equal(result.skipped, 'in-progress', 'the sweep ran while another process held the lock');
      assert.equal(await countAlerts(), 1, 'a locked-out sweep deleted rows anyway');
      assert.deepEqual(await buckets(), [], 'a locked-out sweep wrote a bucket anyway');
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]).catch(() => {});
      holder.release();
    }

    // And it is a stand-down, not a failure: the work is still there to do.
    const after = await retention.sweepRetention(now);
    assert.equal(after.skipped, false, 'the sweep did not recover once the lock was free');
    assert.equal(after.alertsDeleted, 1);
  });

  it('reports a sweep that found nothing differently from one that did not run', async () => {
    // `skipped: false` with zero counts is "there was nothing old enough", which
    // an operator reading a log has to be able to tell from "another sweep has
    // it" and from "you turned this off".
    const result = await retention.sweepRetention(Date.UTC(2024, 5, 5));

    assert.equal(result.skipped, false);
    assert.equal(result.daysProcessed, 0);
  });
});
