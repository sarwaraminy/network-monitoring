import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * Retiring a sensor, against a real database.
 *
 * Postgres rather than a mock, for the same reason the retention tests use one:
 * the substance here is four deletes and an audit insert in one transaction, and
 * mocking that would be testing the mock. What the assertions are actually about
 * is scope — every case below is one where deleting *slightly* too much or too
 * little is silent.
 *
 * The two dangerous directions:
 *
 *  - **Too much.** A delete missing its `sensor_id` predicate empties the table
 *    for every installation sharing the database, which is the failure V16 exists
 *    to have made impossible and the one this action is most able to reintroduce.
 *  - **Too little.** Half a decommission leaves the sensor in `listSensors`, which
 *    reads three of these tables, so it reappears in the filter with nothing
 *    behind it — indistinguishable from a sensor that has gone quiet.
 */

process.env.SENSOR_ID = 'live-sensor';

const database = await openTestDatabase({ id: 'sensordecommission' });

let sensor: typeof import('./sensor.service.js');
let alertService: typeof import('./alert.service.js');

const ACTOR = { name: 'admin@example.com', id: null };

const RETIRED = 'retired-sensor';
const KEPT = 'other-sensor';

/** A finding, a device, a rollup bucket and a capture session, under one name. */
async function seed(sensorId: string, at = '2026-09-01T12:00:00Z'): Promise<void> {
  const pool = database.pool!;
  await pool.query(
    `INSERT INTO alerts (sensor_id, dedup_key, kind, severity, message_key, message_params,
                         first_seen, last_seen, occurrences, evidence)
     VALUES ($1, $2, 'port_scan', 'high', 'port_scan.packet', '{}'::jsonb, $3, $3, 1, '{}'::jsonb)`,
    [sensorId, `${sensorId}-scan`, at],
  );
  await pool.query(
    `INSERT INTO known_devices (sensor_id, mac_address, first_seen, last_seen)
     VALUES ($1, $2, $3, $3)`,
    [sensorId, `aa:bb:cc:00:00:${sensorId.length.toString(16).padStart(2, '0')}`, at],
  );
  await pool.query(
    `INSERT INTO alert_rollup_daily (sensor_id, day, kind, severity, alerts, occurrences,
                                      first_seen, last_seen)
     VALUES ($1, DATE '2026-08-01', 'port_scan', 'high', 3, 40,
             TIMESTAMPTZ '2026-08-01T01:00:00Z', TIMESTAMPTZ '2026-08-01T23:00:00Z')`,
    [sensorId],
  );
  await pool.query(
    `INSERT INTO capture_session (sensor_id, scope, interface_name, snapshot_length, timeout_ms,
                                  started_at, started_by)
     VALUES ($1, 'interface', 'eth0', 65535, 1000, $2, 'alice@example.com')`,
    [sensorId, at],
  );
}

const countsFor = async (sensorId: string) => {
  const pool = database.pool!;
  const one = async (table: string) =>
    Number(
      (
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${table} WHERE sensor_id = $1`,
          [sensorId],
        )
      ).rows[0]!.count,
    );
  return {
    alerts: await one('alerts'),
    devices: await one('known_devices'),
    rollupBuckets: await one('alert_rollup_daily'),
    captureSessions: await one('capture_session'),
  };
};

/*
 * Top level, so it runs after BOTH suites below. Inside the first one it closed
 * the pool before the second had run, and every case there failed with "cannot
 * use a pool after calling end".
 */
after(async () => {
  await database.pool?.end();
  const { closeDb } = await import('../db/index.js');
  await closeDb();
});

describe('decommissioning a sensor', { skip: database.skip }, () => {
  before(async () => {
    sensor = await import('./sensor.service.js');
    alertService = await import('./alert.service.js');
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  it('removes everything recorded under the name, and reports what it removed', async () => {
    await seed(RETIRED);

    const result = await sensor.decommissionSensor(RETIRED, ACTOR);

    assert.equal(result.outcome, 'decommissioned');
    assert.deepEqual(result.outcome === 'decommissioned' ? result.removed : null, {
      alerts: 1,
      devices: 1,
      rollupBuckets: 1,
      captureSessions: 1,
    });
    assert.deepEqual(await countsFor(RETIRED), {
      alerts: 0,
      devices: 0,
      rollupBuckets: 0,
      captureSessions: 0,
    });
  });

  it('leaves every other sensor alone', async () => {
    // The failure V16 exists to have made impossible, and the one this action is
    // most able to reintroduce: a delete that lost its `sensor_id` predicate
    // would pass the case above and empty the database for every installation.
    await seed(RETIRED);
    await seed(KEPT);

    await sensor.decommissionSensor(RETIRED, ACTOR);

    assert.deepEqual(await countsFor(KEPT), {
      alerts: 1,
      devices: 1,
      rollupBuckets: 1,
      captureSessions: 1,
    });
  });

  it('takes the sensor out of the filter it appeared in', async () => {
    /*
     * The point of the whole action, asserted through `listSensors` rather than
     * through the tables: that function unions three of them, so a decommission
     * that missed one would leave the name in the sensor dropdown with nothing
     * behind it — a sensor that reads as quiet rather than as retired, which is
     * exactly the state this exists to resolve.
     */
    await seed(RETIRED);
    await seed(KEPT);
    const before = await alertService.listSensors();
    assert.ok(
      before.some((entry) => entry.sensorId === RETIRED),
      'the fixture did not put the sensor in the filter to begin with',
    );

    await sensor.decommissionSensor(RETIRED, ACTOR);

    const after = (await alertService.listSensors()).map((entry) => entry.sensorId);
    assert.ok(!after.includes(RETIRED));
    assert.ok(after.includes(KEPT), 'a surviving sensor was dropped from the filter too');
  });

  it('records one audit entry carrying the counts', async () => {
    await seed(RETIRED);

    await sensor.decommissionSensor(RETIRED, ACTOR);

    const { rows } = await database.pool!.query<{
      actor: string;
      action: string;
      subject: string;
      detail: Record<string, number>;
    }>("SELECT actor, action, subject, detail FROM audit_events WHERE action = 'sensor.decommission'");

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actor, ACTOR.name);
    assert.equal(rows[0]!.subject, RETIRED);
    // The counts are the only surviving description of what was removed: the rows
    // are gone and the trail cannot be pruned, so this entry is the residue.
    assert.deepEqual(rows[0]!.detail, {
      alerts: 1,
      devices: 1,
      rollupBuckets: 1,
      captureSessions: 1,
    });
  });

  it('reports a name with nothing under it, and records nothing', async () => {
    await seed(KEPT);

    assert.deepEqual(await sensor.decommissionSensor('never-existed', ACTOR), { outcome: 'not-found' });

    const { rows } = await database.pool!.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE action = 'sensor.decommission'",
    );
    assert.equal(rows[0]!.count, '0', 'an act that did not happen was recorded');
  });

  it('refuses this installation, whose rows would come straight back', async () => {
    await seed('live-sensor');

    const result = await sensor.decommissionSensor('live-sensor', ACTOR);

    assert.deepEqual(result, { outcome: 'self', sensorId: 'live-sensor' });
    // Nothing touched. Emptying `known_devices` for a live sensor would re-arm
    // new-device detection across the whole segment.
    assert.deepEqual(await countsFor('live-sensor'), {
      alerts: 1,
      devices: 1,
      rollupBuckets: 1,
      captureSessions: 1,
    });
  });
});

describe('which sensors can be retired', { skip: database.skip }, () => {
  before(async () => {
    sensor = await import('./sensor.service.js');
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  it('never offers this installation', async () => {
    // `listSensors` deliberately includes it — the filter has to offer the sensor
    // the operator is looking at, even before it has written anything. This list
    // is what a destructive action is chosen from, so the same inclusion would be
    // an offer to retire the live one.
    await seed('live-sensor');
    await seed(RETIRED);

    const names = (await sensor.listRetirableSensors()).map((entry) => entry.sensorId);

    assert.deepEqual(names, [RETIRED]);
  });

  it('says what is under each name, so the dialog can say what would be lost', async () => {
    await seed(RETIRED, '2026-09-01T12:00:00Z');

    const [entry] = await sensor.listRetirableSensors();

    assert.equal(entry?.sensorId, RETIRED);
    assert.equal(entry?.alerts, 1);
    assert.equal(entry?.devices, 1);
    assert.equal(entry?.rollupBuckets, 1);
    assert.equal(entry?.lastSeen, '2026-09-01T12:00:00.000Z');
  });

  it('counts a sensor that has only aggregated history left', async () => {
    /*
     * Retention's end state, and the case that has to be representable: the
     * detail expired and was rolled up, so there are no `alerts` rows left. A join
     * that required one would drop the sensor from this list entirely — leaving
     * the only sensors that cannot be retired the ones whose rows nothing else can
     * reclaim either.
     *
     * The last-seen still resolves, out of the bucket's own extremes, which is why
     * V8 stores them rather than the day alone.
     */
    await database.pool!.query(
      `INSERT INTO alert_rollup_daily (sensor_id, day, kind, severity, alerts, occurrences,
                                       first_seen, last_seen)
       VALUES ($1, DATE '2026-08-01', 'port_scan', 'high', 3, 40,
               TIMESTAMPTZ '2026-08-01T01:00:00Z', TIMESTAMPTZ '2026-08-01T23:00:00Z')`,
      [RETIRED],
    );

    const [entry] = await sensor.listRetirableSensors();

    assert.equal(entry?.sensorId, RETIRED);
    assert.equal(entry?.rollupBuckets, 1);
    assert.equal(entry?.alerts, 0);
    assert.equal(entry?.lastSeen, '2026-08-01T23:00:00.000Z');
  });
});
