import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase, truncateAll } from '../test/database.js';

/**
 * Two sensors, one database — the separation V16 introduced, against real SQL.
 *
 * This has to be a database test rather than a unit test, because every part of
 * the bug it guards lived in a constraint. `alerts.dedup_key` was globally UNIQUE
 * and the application upserts on it, so two sensors watching two segments wrote
 * into one row: their occurrence counts added together, `first_seen`/`last_seen`
 * widened to span both networks, and the title, severity and evidence became
 * whichever sensor flushed last. Nothing threw. At the database level there was no
 * conflict to report, because the two sensors genuinely agreed on the key — the key
 * is derived from what was observed, and a port scan from 10.0.0.1 looks the same
 * on any segment that has a 10.0.0.1.
 *
 * `known_devices` was the quieter half and the one worth writing a test for first.
 * Its primary key was the MAC alone, so a phone the first sensor had learned was
 * already "seen before" to every other sensor sharing the database, and
 * new-device detection — an unknown machine appearing on a segment, which is close
 * to the whole point of the product — never fired for it. A merged alert row is
 * visibly wrong to anyone who looks at it. A detection that does not happen leaves
 * nothing to look at.
 *
 * Each case here fails against its own defect: revert V16's key and the first two
 * fail, revert the `sensor_id` filter in `loadKnownMacAddresses` and the device
 * case returns the other sensor's address.
 */

/** This process is `sensor-a`; `sensor-b` is only ever written by raw SQL below. */
process.env.SENSOR_ID = 'sensor-a';
process.env.RETENTION_ENABLED = 'true';
process.env.ALERT_RETENTION_DAYS = '30';
process.env.DEVICE_RETENTION_DAYS = '30';

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const database = await openTestDatabase({ id: 'sensorid' });

let devices: typeof import('./device.service.js');
let alertService: typeof import('./alert.service.js');
let retention: typeof import('./retention.service.js');

/** One alert, under whichever sensor the case is about. */
async function seedAlert(
  sensor: string,
  dedupKey: string,
  options: { lastSeen?: Date; occurrences?: number; kind?: string } = {},
) {
  const { lastSeen = new Date(), occurrences = 1, kind = 'port_scan' } = options;

  await database.pool!.query(
    `INSERT INTO alerts
       (sensor_id, kind, severity, title, description, dedup_key, source_ip,
        first_seen, last_seen, occurrences, evidence)
     VALUES ($1, $2, 'medium', $3, 'Seeded by sensor-id.test.ts', $4, '10.0.0.1', $5, $5, $6, '{}'::jsonb)`,
    [sensor, kind, `${kind} from 10.0.0.1`, dedupKey, lastSeen, occurrences],
  );
}

async function seedDevice(sensor: string, mac: string, lastSeen: Date) {
  await database.pool!.query(
    `INSERT INTO known_devices (sensor_id, mac_address, first_ip, last_ip, first_seen, last_seen)
     VALUES ($1, $2, '10.0.0.9', '10.0.0.9', $3, $3)`,
    [sensor, mac, lastSeen],
  );
}

describe('two sensors sharing one database', { skip: database.skip }, () => {
  before(async () => {
    devices = await import('./device.service.js');
    alertService = await import('./alert.service.js');
    retention = await import('./retention.service.js');
  });

  beforeEach(async () => {
    await truncateAll(database.pool!);
  });

  after(async () => {
    await retention?.retentionIdle();
    await database.pool?.end();
    await new Promise((resolve) => setTimeout(resolve, 10).unref());
  });

  it('keeps two sensors that agree on a dedup key in two rows', async () => {
    // The same key from both, which is the case that used to collapse: the key
    // describes the finding, and two segments can hold the same addresses.
    await seedAlert('sensor-a', 'port_scan|10.0.0.1|w1', { occurrences: 4 });
    await seedAlert('sensor-b', 'port_scan|10.0.0.1|w1', { occurrences: 7 });

    const { rows } = await database.pool!.query<{ sensor_id: string; occurrences: number }>(
      'SELECT sensor_id, occurrences FROM alerts ORDER BY sensor_id',
    );

    assert.deepEqual(rows, [
      { sensor_id: 'sensor-a', occurrences: 4 },
      { sensor_id: 'sensor-b', occurrences: 7 },
    ]);
  });

  it('still refuses a second row for one sensor and one key', async () => {
    // The other half of the same constraint, and the reason this is not simply a
    // dropped uniqueness rule: aggregation within a sensor has to go on working,
    // or every repeat becomes a new row and the table returns to one row per packet.
    await seedAlert('sensor-a', 'port_scan|10.0.0.1|w1');

    await assert.rejects(
      () => seedAlert('sensor-a', 'port_scan|10.0.0.1|w1'),
      /duplicate key|unique/i,
      'the dedup key must still be unique within one sensor',
    );
  });

  it('filters the alert list to one sensor, and shows every sensor by default', async () => {
    await seedAlert('sensor-a', 'a-1');
    await seedAlert('sensor-b', 'b-1');
    await seedAlert('sensor-b', 'b-2');

    const all = await alertService.listAlerts({ limit: 50, offset: 0 });
    assert.equal(all.length, 3, 'the default is every sensor: a shared database is the point');

    const onlyB = await alertService.listAlerts({ sensor: 'sensor-b', limit: 50, offset: 0 });
    assert.deepEqual(onlyB.map((alert) => alert.dedupKey).sort(), ['b-1', 'b-2']);
  });

  it('counts each sensor separately, and names itself even with nothing stored', async () => {
    await seedAlert('sensor-b', 'b-1');

    const sensors = await alertService.listSensors();

    assert.deepEqual(
      sensors.map((sensor) => [sensor.sensorId, sensor.self, sensor.alerts]),
      [
        // Present with zero findings: a sensor just installed and still quiet is
        // exactly the one an operator goes looking for, and leaving it out renders
        // a working install as one that does not exist.
        ['sensor-a', true, 0],
        ['sensor-b', false, 1],
      ],
    );
  });

  it('does not treat another sensor’s device as one it has seen', async () => {
    // The silent half of the bug. `loadKnownMacAddresses` seeds this sensor's
    // NewDeviceDetector, so an unscoped read hands sensor-a every device sensor-b
    // has ever learned and switches new-device detection off for all of them.
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());

    assert.deepEqual(await devices.loadKnownMacAddresses(), [], 'sensor-b’s sightings are not sensor-a’s');

    await devices.recordDevice('aa:bb:cc:dd:ee:ff', '10.0.0.9');

    assert.deepEqual(await devices.loadKnownMacAddresses(), ['aa:bb:cc:dd:ee:ff']);
    const { rows } = await database.pool!.query<{ n: string }>(
      "SELECT count(*) AS n FROM known_devices WHERE mac_address = 'aa:bb:cc:dd:ee:ff'",
    );
    assert.equal(rows[0]!.n, '2', 'one row per sensor: known to both, separately');
  });

  it('lists every sensor’s devices but forgets only the one asked for', async () => {
    await seedDevice('sensor-a', 'aa:bb:cc:dd:ee:ff', new Date());
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());

    assert.equal((await devices.listKnownDevices()).length, 2, 'the inventory spans sensors');
    assert.equal((await devices.listKnownDevices('sensor-b')).length, 1);

    // Defaults to this sensor, which is what leaves a single-sensor installation
    // behaving exactly as it did.
    assert.equal(await devices.forgetDevice('aa:bb:cc:dd:ee:ff', { id: 1, name: 'tester' }), true);

    const remaining = await devices.listKnownDevices();
    assert.deepEqual(
      remaining.map((device) => device.sensorId),
      ['sensor-b'],
      'forgetting a device on one sensor must not re-arm detection on another',
    );
  });

  it('rolls each sensor’s day into its own bucket', async () => {
    const expired = new Date(Date.now() - (RETENTION_DAYS + 3) * DAY_MS);
    await seedAlert('sensor-a', 'a-old', { lastSeen: expired, occurrences: 2 });
    await seedAlert('sensor-b', 'b-old', { lastSeen: expired, occurrences: 5 });

    await retention.sweepRetention();

    const { rows } = await database.pool!.query<{
      sensor_id: string;
      alerts: number;
      occurrences: string;
    }>('SELECT sensor_id, alerts, occurrences FROM alert_rollup_daily ORDER BY sensor_id');

    assert.deepEqual(rows, [
      { sensor_id: 'sensor-a', alerts: 1, occurrences: '2' },
      { sensor_id: 'sensor-b', alerts: 1, occurrences: '5' },
    ]);
  });

  it('measures device staleness against each sensor’s own clock', async () => {
    /*
     * `forgetStaleDevices` counts back from `max(last_seen)` rather than from now,
     * because `last_seen` only advances while a capture is running — see its
     * docblock. Taking that maximum across the whole table makes it one sensor's
     * clock: a sensor capturing continuously drags the cutoff forward until a
     * quieter sensor's entire device list falls behind it and goes in a single
     * sweep, which is the mass re-alert that function exists to prevent.
     */
    await seedDevice('sensor-a', 'aa:aa:aa:aa:aa:aa', new Date());
    // Well past the window measured from sensor-a, and current measured from
    // sensor-b's own newest sighting.
    const quiet = new Date(Date.now() - (RETENTION_DAYS + 10) * DAY_MS);
    await seedDevice('sensor-b', 'bb:bb:bb:bb:bb:bb', quiet);
    await seedDevice('sensor-b', 'bb:bb:bb:bb:bb:bc', new Date(quiet.getTime() + DAY_MS));

    await retention.sweepRetention();

    const surviving = (await devices.listKnownDevices()).map((device) => device.macAddress).sort();
    assert.deepEqual(
      surviving,
      ['aa:aa:aa:aa:aa:aa', 'bb:bb:bb:bb:bb:bb', 'bb:bb:bb:bb:bb:bc'],
      'a busy sensor’s clock must not expire a quiet sensor’s devices',
    );
  });
});
