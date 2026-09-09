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
   * The guard before the read is not enough on its own, because the read yields.
   *
   * A capture starting while `findInterruptedCapture` is in flight is invisible to
   * the first check, and its own live row is what comes back — so the sequence the
   * guard exists to prevent runs anyway, one query's width later.
   *
   * Sitting in that window needs no stub. `reportInterruptedCapture` runs
   * synchronously as far as the read and then yields, so anything done between
   * the call and the `await` below happens while the query is in flight — which
   * is precisely where an operator's capture would land.
   */
  it('re-checks after the read, which is where the window actually is', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();

    const pending = service.reportInterruptedCapture();
    pretendCapturing(service);
    await pending;

    assert.equal(service.getStatus().interrupted, null, 'a live capture was reported as interrupted');
    assert.equal(await isOpen(), true, 'a live capture had its own session stamped stopped');
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
   * The guards cover the decision; this covers the write.
   *
   * A start that is mid-flight has already written its own open row while its
   * `capturing` flag is still false, so every in-memory check passes and the
   * unconditional `UPDATE … WHERE (sensor_id, scope)` stamps *that* row. The
   * capture then runs with nothing open and the next boot has nothing to report —
   * the same silence, reached through the one statement a process-memory guard
   * cannot fence.
   *
   * Driven by replacing the row between the read and the write, which is what a
   * concurrent start does: `reportInterruptedCapture` is left mid-flight while a
   * newer session is recorded over the old one.
   */
  /*
   * The guards cover the decision; the `WHERE` covers the write.
   *
   * A start that is mid-flight has already written its own open row while its
   * `capturing` flag is still false, so every in-memory check passes and an
   * unconditional `UPDATE … WHERE (sensor_id, scope)` stamps *that* row. The
   * capture then runs with nothing open and the next boot has nothing to report —
   * the same silence, reached through the one statement a process-memory guard
   * cannot fence.
   *
   * Asserted on `recordCaptureStopped` directly rather than by racing
   * `reportInterruptedCapture` against a concurrent start. Nothing orders a test's
   * write between that function's read and its stamp, so the racing version
   * passed whichever way the interleaving fell — it closed the *old* row about as
   * often as the new one, and the assertion held for the wrong reason. What the
   * fix actually promises is "stamp only the session you were given", and that is
   * a statement about one call.
   */
  it('stamps only the session it was given', async () => {
    const OLD = new Date('2026-09-09T03:14:00.000Z');
    const NEW = new Date('2026-09-09T04:00:00.000Z');

    await sessions.recordCaptureStarted(SCOPE, { ...STARTED, startedAt: OLD });
    // The row is replaced, as a concurrent `POST /start` replaces it: same scope,
    // its own `started_at`, and open.
    await sessions.recordCaptureStarted(SCOPE, { ...STARTED, startedAt: NEW });

    // A stop that believes it is closing the session it read a moment ago.
    await sessions.recordCaptureStopped(SCOPE, { startedAt: OLD });

    const still = await sessions.findInterruptedCapture(SCOPE);
    assert.ok(still, 'a live session was stamped stopped by a call that never read it');
    assert.equal(still.startedAt, NEW.toISOString(), 'the wrong row survived');
  });

  /*
   * The other half: a stop that does name the current session still closes it.
   * Without this the case above would pass with the update never running at all.
   */
  it('still stamps the session it did read', async () => {
    const AT = new Date('2026-09-09T03:14:00.000Z');
    await sessions.recordCaptureStarted(SCOPE, { ...STARTED, startedAt: AT });

    await sessions.recordCaptureStopped(SCOPE, { startedAt: AT });

    assert.equal(await isOpen(), false, 'the session it was given was left open');
  });

  /*
   * Two callers, one instance.
   *
   * With resuming on, the banner and its Resume button go live early in boot while
   * the auto-resume waits for `startIntel()`. An operator pressing Resume in that
   * gap used to get through `startCapture`'s guard alongside the auto-resume,
   * because `capturing` is only set several awaits in — leaving two pcap handles
   * and two poll timers, the first of each never released.
   *
   * Asserted on the claim rather than on handles, since neither start can open one
   * here: the second call must return without entering the body at all.
   */
  it('lets only one start claim the instance', async () => {
    const service = new PacketCaptureService(SCOPE);
    const innards = service as unknown as { starting: boolean; openCapture: () => Promise<void> };

    let entered = 0;
    innards.openCapture = async () => {
      entered += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    await Promise.all([
      service.startCapture('eth0', 65_535, 1000, null, 'alice'),
      service.startCapture('eth0', 65_535, 1000, null, 'the-auto-resume'),
    ]);

    assert.equal(entered, 1, 'two starts ran on one instance');
    assert.equal(innards.starting, false, 'the claim was not released');
  });

  /*
   * A stop can arrive before the start's own row has been written.
   *
   * The capture is live and stoppable as soon as the handle is open and the timer
   * running, which is several lines before the insert. Scoping the stop's update
   * to `started_at` — the right fix for the previous round — is what made this
   * matter: the update matches nothing, returns, and then the insert lands
   * unstamped. A capture the operator stopped cleanly is recorded as still
   * running, so the next boot reports it as interrupted and, with resuming on,
   * starts it again.
   *
   * Driven by holding the start mid-flight: `openCapture` is replaced with one
   * that sets up the same state and leaves the write pending, which is the window.
   */
  it('closes the row even when the stop beats the start-record', async () => {
    const service = new PacketCaptureService(SCOPE);
    const innards = service as unknown as {
      capturing: boolean;
      session: typeof STARTED;
      startedAt: Date;
      sessionWrite: Promise<void> | null;
      openCapture: () => Promise<void>;
    };

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    innards.openCapture = async () => {
      // Everything `openCapture` does before its insert: live, stoppable, and
      // recorded only once the write it is holding completes.
      innards.capturing = true;
      innards.session = STARTED;
      innards.startedAt = STARTED.startedAt;
      innards.sessionWrite = held.then(() => sessions.recordCaptureStarted(SCOPE, STARTED));
      await innards.sessionWrite;
    };

    const starting = service.startCapture('eth0', 65_535, 1000, null, 'alice');
    const stopping = service.stopCapture('operator');

    release();
    await Promise.all([starting, stopping]);

    assert.equal(await isOpen(), false, 'a capture the operator stopped was left recorded as running');
  });

  /*
   * `startCapture` declines when another caller holds the instance, and the resume
   * used to log success regardless — telling an unattended host's log that the
   * interruption had been handled when it had not.
   */
  it('does not claim a resume it did not perform', async () => {
    const service = new PacketCaptureService(SCOPE);
    await openRow();
    await service.reportInterruptedCapture();

    // The operator's Resume, in the gap before the auto-resume fires.
    const innards = service as unknown as { starting: boolean };
    innards.starting = true;

    const warnings: string[] = [];
    const log = (service as unknown as { log: { warn: (...args: unknown[]) => void } }).log;
    const realWarn = log.warn.bind(log);
    log.warn = (...args: unknown[]) => {
      warnings.push(JSON.stringify(args[1] ?? args[0]));
    };

    try {
      await service.resumeInterruptedCapture();
    } finally {
      log.warn = realWarn;
      innards.starting = false;
    }

    assert.equal(
      warnings.some((line) => line.includes('Resumed the capture')),
      false,
      'a resume that never ran was logged as having succeeded',
    );
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
