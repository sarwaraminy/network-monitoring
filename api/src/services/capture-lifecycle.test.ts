import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * The lifecycle of the session row, which is where this feature can go quiet.
 *
 * `capture-session.test.ts` covers what the row means. This covers what the
 * *service* does with it, and every case here is one where the feature reports
 * correctly in the ordinary run and says nothing in exactly the situation it was
 * written for — a silence that looks identical to a host that has simply never
 * captured anything.
 *
 * Resuming is switched ON for this file. It is the more dangerous half: with it
 * off, a lost row costs one notice, and with it on it costs unattended capture
 * permanently. The one case that needs it off mutates `env` in place and says so.
 */

process.env.SENSOR_ID = 'capture-lifecycle-sensor';
process.env.CAPTURE_RESUME_ON_START = 'true';

const database = await openTestDatabase({ id: 'capturelifecycle' });

let sessions: typeof import('./capture-session.service.js');
let env: typeof import('../config/env.js')['env'];
let PacketCaptureService: typeof import('./packet-capture.service.js')['PacketCaptureService'];

const SCOPE = 'interface';

const STARTED = {
  interfaceName: 'eth0',
  snapshotLength: 65_535,
  timeoutMs: 1000,
  filterIp: null,
  startedAt: new Date('2026-09-09T03:14:00.000Z'),
  startedBy: 'alice',
};

/**
 * The private state a running capture would have, without a pcap handle.
 *
 * `startCapture` is the honest way to reach it and needs an interface to capture
 * from, which CI does not have and a developer machine does not have reliably.
 * What is under test here is not pcap — it is what `stopCapture` and
 * `reportInterruptedCapture` do about a session they believe is running — so the
 * two fields that belief consists of are set directly.
 */
function pretendCapturing(service: InstanceType<typeof PacketCaptureService>): void {
  const innards = service as unknown as {
    capturing: boolean;
    session: typeof STARTED;
    startedAt: Date;
  };
  innards.capturing = true;
  innards.session = STARTED;
  innards.startedAt = STARTED.startedAt;
}

const openRow = () => sessions.recordCaptureStarted(SCOPE, STARTED);
const isOpen = async () => (await sessions.findInterruptedCapture(SCOPE)) !== null;

describe('what a process does with the session row', { skip: database.skip }, () => {
  before(async () => {
    sessions = await import('./capture-session.service.js');
    ({ env } = await import('../config/env.js'));
    ({ PacketCaptureService } = await import('./packet-capture.service.js'));
    assert.equal(env.captureResumeOnStart, true, 'this file is written for resuming ON');
  });

  beforeEach(async () => {
    await database.pool!.query('TRUNCATE capture_session');
  });

  after(async () => {
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  /*
   * `index.ts` calls `reportInterruptedCapture` after `listen()`, so the API is
   * already answering requests when it runs. An operator or a retrying client can
   * start a capture in that window — and the row that capture just wrote is
   * exactly what `findInterruptedCapture` returns.
   *
   * Without the guard the boot stamps the live row stopped. The capture goes on
   * running with nothing open, so the interruption that ends it later leaves the
   * next boot nothing to find, and the report never comes.
   */
  it('leaves the row alone when this process is already capturing', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();
    pretendCapturing(service);

    await service.reportInterruptedCapture();

    assert.equal(await isOpen(), true, 'a live capture had its own session stamped stopped');
    assert.equal(service.getStatus().interrupted, null, 'a live capture was reported as interrupted');
  });

  /*
   * The row is the only durable record. Stamping it before the resume is tried
   * makes the ordinary failure permanent: the host reboots, the interface is not
   * up yet, the resume fails, and the notice that survives lives in the memory of
   * a process nobody is watching. The next boot finds nothing and does not try
   * again — unattended capture is off for good, through the switch that exists to
   * prevent that.
   */
  it('leaves the row open while a resume is still to be attempted', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();

    await service.reportInterruptedCapture();

    assert.ok(service.getStatus().interrupted, 'the interruption was not reported');
    assert.equal(await isOpen(), true, 'the row was stamped before the resume could be tried');
  });

  it('still has the session to retry after a resume fails', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();

    await service.reportInterruptedCapture();
    // No pcap here, so this is the failing resume the comment above describes.
    await service.resumeInterruptedCapture();

    assert.equal(await isOpen(), true, 'a failed resume discarded the only record of the session');
  });

  /*
   * With resuming off nothing is going to bring it back, so the notice belongs to
   * the process that found it and the row is closed behind it — otherwise every
   * restart re-announces an interruption from a machine that has been fine since.
   */
  it('stamps the row when no resume will be attempted', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();

    // Mutated rather than set through the environment: the pair of behaviours is
    // the finding, and reading them apart in two files would hide that. `env` is
    // readonly to everything that is not a test, which is why this needs the cast.
    const mutable = env as { captureResumeOnStart: boolean };
    mutable.captureResumeOnStart = false;
    try {
      await service.reportInterruptedCapture();
    } finally {
      mutable.captureResumeOnStart = true;
    }

    assert.ok(service.getStatus().interrupted, 'the interruption was not reported');
    assert.equal(await isOpen(), false, 'the row was left open with nothing to reopen it');
  });

  /*
   * A read error is the pcap handle failing under a capture that is still the
   * current process's. It leaves the row open — which is what lets the next boot
   * speak — but the process it happened in showed a bare "Idle", so an operator
   * starting a new capture overwrote the row and erased the incident entirely.
   */
  it('reports a capture that died under it, in the process where it died', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();
    pretendCapturing(service);

    await service.stopCapture('read-error');

    const status = service.getStatus();
    assert.equal(status.capturing, false);
    assert.equal(status.interrupted?.interfaceName, 'eth0');
    assert.equal(status.interrupted?.startedBy, 'alice');
    assert.equal(await isOpen(), true, 'a capture that died on its own was recorded as a clean stop');
  });

  it('says nothing when the operator was the one who stopped it', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();
    pretendCapturing(service);

    await service.stopCapture('operator');

    assert.equal(service.getStatus().interrupted, null, 'an operator stop was reported as an interruption');
    assert.equal(await isOpen(), false);
  });
});
