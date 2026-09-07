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
let sensorScope: typeof import('../notify/sensor-scope.js');

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
    sensorScope = await import('../notify/sensor-scope.js');
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

  it('lists every sensor, and names itself even with nothing stored', async () => {
    await seedAlert('sensor-b', 'b-1');

    const sensors = await alertService.listSensors();

    assert.deepEqual(
      sensors.map((sensor) => [sensor.sensorId, sensor.self]),
      [
        // Present with nothing stored: a sensor just installed and still quiet is
        // exactly the one an operator goes looking for, and leaving it out renders
        // a working install as one that does not exist.
        ['sensor-a', true],
        ['sensor-b', false],
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

    const result = await devices.forgetDevice('aa:bb:cc:dd:ee:ff', { id: 1, name: 'tester' }, 'sensor-a');
    assert.deepEqual(result, { outcome: 'forgotten', sensorId: 'sensor-a' });

    const remaining = await devices.listKnownDevices();
    assert.deepEqual(
      remaining.map((device) => device.sensorId),
      ['sensor-b'],
      'forgetting a device on one sensor must not re-arm detection on another',
    );
  });

  it('refuses to guess which sensor should forget an address two of them know', async () => {
    /*
     * This used to default to the sensor serving the request, which disagreed with
     * the list beside it: `listKnownDevices()` spans every sensor, so a client that
     * read the list and posted a MAC back — the obvious way to write one — deleted
     * a row it had never seen. Re-arming new-device detection on a segment nobody
     * was looking at is not a thing to do on a caller's behalf.
     */
    await seedDevice('sensor-a', 'aa:bb:cc:dd:ee:ff', new Date());
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());

    const result = await devices.forgetDevice('aa:bb:cc:dd:ee:ff', { id: 1, name: 'tester' });

    assert.deepEqual(result, { outcome: 'ambiguous', sensors: ['sensor-a', 'sensor-b'] });
    assert.equal((await devices.listKnownDevices()).length, 2, 'and nothing was deleted');
  });

  it('resolves the one holder, even when it is not the sensor answering', async () => {
    /*
     * The other half of the same disagreement: the MAC is in the list, on one
     * sensor, and it is not this one. The old default scoped the delete to
     * `sensor-a` and answered "no known device" for an address plainly on screen.
     *
     * This is also the single-sensor case, which is every installation that has not
     * set SENSOR_ID: exactly one holder, resolved, deleted — as it always was.
     */
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());

    const result = await devices.forgetDevice('aa:bb:cc:dd:ee:ff', { id: 1, name: 'tester' });

    assert.deepEqual(result, { outcome: 'forgotten', sensorId: 'sensor-b' });
    assert.equal((await devices.listKnownDevices()).length, 0);
  });

  it('reports an address no sensor knows as not found', async () => {
    const result = await devices.forgetDevice('aa:bb:cc:dd:ee:ff', { id: 1, name: 'tester' });
    assert.deepEqual(result, { outcome: 'not-found' });
  });

  it('separates “no such device” from “not on that sensor”', async () => {
    /*
     * The device list spans sensors, so a caller looking at the MAC on screen and
     * naming the wrong sensor used to be told the device did not exist. That is
     * false, and it points at nothing they could fix — where the sensor is the one
     * thing they could.
     */
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());

    const wrongSensor = await devices.forgetDevice(
      'aa:bb:cc:dd:ee:ff',
      { id: 1, name: 'tester' },
      'sensor-a',
    );
    assert.deepEqual(wrongSensor, { outcome: 'wrong-sensor', sensors: ['sensor-b'] });
    assert.equal((await devices.listKnownDevices()).length, 1, 'and nothing was deleted');

    // Unknown everywhere stays a plain not-found: there is no sensor to suggest.
    const unknown = await devices.forgetDevice('11:22:33:44:55:66', { id: 1, name: 'tester' }, 'sensor-a');
    assert.deepEqual(unknown, { outcome: 'not-found' });
  });

  it('lists a sensor that has devices but has never raised a finding', async () => {
    /*
     * The identity has to outlive — and precede — the findings.
     *
     * A second sensor on a quiet segment learns devices and finds nothing. Read
     * from `alerts` alone it does not exist, so no sensor column and no filter
     * render anywhere, and the dashboard's device tile sums both sensors with
     * nothing on screen to separate them — on exactly the installation this
     * feature is for.
     */
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());

    const sensors = await alertService.listSensors();

    assert.deepEqual(
      sensors.map((sensor) => sensor.sensorId),
      // Present on the strength of a device row alone, which is the point: this
      // list is identity, and identity has to outlive and precede the findings.
      ['sensor-a', 'sensor-b'],
    );
  });

  it('keeps listing a sensor whose findings have been rolled up', async () => {
    // The same rule from the other direction. Once retention rolls a sensor's
    // alerts away, its rows still feed the trend chart through the rollup — so
    // dropping it from the list would leave a sensor visible in the chart and
    // unselectable in the filter.
    const expired = new Date(Date.now() - (RETENTION_DAYS + 3) * DAY_MS);
    await seedAlert('sensor-b', 'b-old', { lastSeen: expired });
    await retention.sweepRetention();

    const { rows } = await database.pool!.query<{ n: string }>(
      "SELECT count(*) AS n FROM alerts WHERE sensor_id = 'sensor-b'",
    );
    assert.equal(rows[0]!.n, '0', 'the fixture must actually have been rolled up');

    const sensors = await alertService.listSensors();
    assert.ok(
      sensors.some((sensor) => sensor.sensorId === 'sensor-b'),
      'a sensor whose data moved to the rollup is still a sensor',
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

  it('tells a single-sensor installation apart from a multi-sensor one', async () => {
    /*
     * The question a human-facing notification asks before naming its sensor.
     *
     * It used to ask a different one — is this sensor's name still `default` — and
     * the two answers disagree on exactly the install this feature is for, because
     * `SENSOR_ID=default` is what ships and V16 backfills to it. Head office keeps
     * the shipped name, adds a branch, and only the branch's alerts carry a sensor
     * line.
     */
    sensorScope.resetSensorScope();
    assert.equal(await sensorScope.refreshSensorScope(), false, 'this sensor alone is not multi-sensor');

    // Its own findings do not make it two.
    await seedAlert('sensor-a', 'a-1');
    sensorScope.resetSensorScope();
    assert.equal(await sensorScope.refreshSensorScope(), false);

    // A second sensor does — and a device row is enough, before it has found
    // anything, which is the case a findings-only read would miss.
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());
    sensorScope.resetSensorScope();
    assert.equal(await sensorScope.refreshSensorScope(), true);
    assert.equal(sensorScope.hasMultipleSensors(), true, 'and the cached read agrees');
  });

  it('counts another sensor even when this one has stored nothing', async () => {
    // The freshly-installed sensor, whose own tables are empty. It still has to
    // know it is not alone, or its first alerts go out unlabelled.
    await seedAlert('sensor-b', 'b-1');

    sensorScope.resetSensorScope();

    assert.equal(await sensorScope.refreshSensorScope(), true);
  });

  it('keeps the previous answer rather than assuming one sensor', async () => {
    /*
     * The failure direction that matters. Answering "one sensor" because a query
     * failed is the same silence this module exists to prevent, and it would happen
     * during a database problem — when nobody is reading release notes to find out
     * why the sensor line disappeared.
     */
    await seedDevice('sensor-b', 'aa:bb:cc:dd:ee:ff', new Date());
    sensorScope.resetSensorScope();
    assert.equal(await sensorScope.refreshSensorScope(), true);

    // Nothing to read from, and the answer holds.
    await truncateAll(database.pool!);
    assert.equal(
      sensorScope.hasMultipleSensors(),
      true,
      'the cached answer stands until a refresh replaces it',
    );
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
