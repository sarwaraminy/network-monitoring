import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * What a restart leaves behind, and what the next process says about it.
 *
 * Capture lives in process memory: `startCapture` opens a pcap handle and sets
 * some fields, and nothing survives the process that did it. Flow collection
 * comes back at boot from `FLOW_ENABLED`; capture did not, and the Capture screen
 * afterwards said "Idle" — the same word it uses for a host that has never
 * captured anything. For a monitoring product a gap in monitoring that nothing
 * reports is the worst state it can be in, because it looks exactly like the good
 * one.
 *
 * A database test because the record is the feature. Everything here is about
 * what one process writes and the next one reads, which is the part that could
 * not be checked in memory.
 *
 * The pcap library is not needed: `recordCaptureStarted` and
 * `findInterruptedCapture` are the seam under test, and driving them directly is
 * what lets these cases run on CI, where there is no interface to capture from.
 */

process.env.SENSOR_ID = 'capture-sensor';

const database = await openTestDatabase({ id: 'capturesession' });

let sessions: typeof import('./capture-session.service.js');

const started = (over: Partial<Parameters<typeof sessions.recordCaptureStarted>[1]> = {}) => ({
  interfaceName: 'eth0',
  snapshotLength: 65_535,
  timeoutMs: 1000,
  filterIp: null,
  startedAt: new Date('2026-09-09T03:14:00.000Z'),
  startedBy: 'alice',
  ...over,
});

describe('the record of what a sensor was capturing', { skip: database.skip }, () => {
  before(async () => {
    sessions = await import('./capture-session.service.js');
  });

  beforeEach(async () => {
    await database.pool!.query('TRUNCATE capture_session');
  });

  after(async () => {
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('reports nothing when no capture was ever started', async () => {
    assert.equal(await sessions.findInterruptedCapture('interface'), null);
  });

  it('reports a capture that was never stopped', async () => {
    await sessions.recordCaptureStarted('interface', started());

    const interrupted = await sessions.findInterruptedCapture('interface');
    assert.equal(interrupted?.interfaceName, 'eth0');
    assert.equal(interrupted?.startedBy, 'alice');
    assert.equal(interrupted?.startedAt, '2026-09-09T03:14:00.000Z');
  });

  it('reports nothing once it was stopped cleanly', async () => {
    await sessions.recordCaptureStarted('interface', started());
    await sessions.recordCaptureStopped('interface');

    assert.equal(await sessions.findInterruptedCapture('interface'), null);
  });

  it('reports it only once, so a second restart is quiet', async () => {
    /*
     * The notice belongs to the process that found it. Left unstamped, an
     * interruption would be announced at every boot until somebody captured
     * again — a banner about a machine that has since been fine for a week.
     */
    await sessions.recordCaptureStarted('interface', started());

    assert.ok(await sessions.findInterruptedCapture('interface'), 'the first boot reports it');
    // What `restoreInterruptedCapture` does after reporting.
    await sessions.recordCaptureStopped('interface');
    assert.equal(await sessions.findInterruptedCapture('interface'), null, 'the second boot does not');
  });

  it('keeps the two capture scopes apart', async () => {
    /*
     * One process runs two captures — interface-wide and IP-filtered, from
     * `packet-capture.registry.ts` — each with its own handle and buffer. Keyed on
     * the sensor alone they would overwrite each other's session, so starting a
     * filtered capture while an interface-wide one ran would erase the first: a
     * restart resumes one and silently forgets the other.
     *
     * The same shape as the `known_devices` bug V16 fixed, one table along.
     */
    await sessions.recordCaptureStarted('interface', started({ interfaceName: 'eth0' }));
    await sessions.recordCaptureStarted(
      'filtered-ip',
      started({ interfaceName: 'eth1', filterIp: '10.0.0.5' }),
    );

    const wide = await sessions.findInterruptedCapture('interface');
    const filtered = await sessions.findInterruptedCapture('filtered-ip');

    assert.equal(wide?.interfaceName, 'eth0', 'the filtered capture overwrote the interface-wide one');
    assert.equal(filtered?.interfaceName, 'eth1');
    assert.equal(filtered?.filterIp, '10.0.0.5');
  });

  it('stops one scope without stopping the other', async () => {
    await sessions.recordCaptureStarted('interface', started());
    await sessions.recordCaptureStarted('filtered-ip', started({ filterIp: '10.0.0.5' }));

    await sessions.recordCaptureStopped('interface');

    assert.equal(await sessions.findInterruptedCapture('interface'), null);
    assert.ok(
      await sessions.findInterruptedCapture('filtered-ip'),
      'stopping one scope marked the other stopped too',
    );
  });

  it('replaces a stopped session rather than accumulating rows', async () => {
    // The row is reused, so a previous session's `stopped_at` has to be cleared —
    // otherwise a running capture reads back as one that already finished.
    await sessions.recordCaptureStarted('interface', started({ interfaceName: 'eth0' }));
    await sessions.recordCaptureStopped('interface');
    await sessions.recordCaptureStarted('interface', started({ interfaceName: 'eth9' }));

    const interrupted = await sessions.findInterruptedCapture('interface');
    assert.equal(interrupted?.interfaceName, 'eth9', 'the restart was not recorded as running');

    const { rows } = await database.pool!.query<{ n: string }>('SELECT count(*) AS n FROM capture_session');
    // One scope was used here, so one row — three captures did not become three.
    assert.equal(rows[0]!.n, '1', 'one row per scope, not one per capture');
  });

  it('keeps enough to start the same capture again', async () => {
    // A resume has to reproduce what the operator asked for. The values are stored
    // unclamped so `startCapture` stays the only place that clamps them.
    await sessions.recordCaptureStarted(
      'filtered-ip',
      started({ interfaceName: 'eth3', snapshotLength: 128, timeoutMs: 250, filterIp: '10.0.0.7' }),
    );

    assert.deepEqual(await sessions.findInterruptedCapture('filtered-ip'), {
      interfaceName: 'eth3',
      snapshotLength: 128,
      timeoutMs: 250,
      filterIp: '10.0.0.7',
      startedAt: '2026-09-09T03:14:00.000Z',
      startedBy: 'alice',
    });
  });
});
