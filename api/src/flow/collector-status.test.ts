import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { before, describe, it } from 'node:test';
import { buildNetflowV5, buildSflowHeader } from './test-datagrams.js';

/**
 * What `GET /api/flow/status` can tell an operator, and what it could not.
 *
 * The route's own docblock states the case it exists for: "configured but
 * receiving nothing" and "receiving but every record is awaiting a template" are
 * the two failure modes during setup, and they are indistinguishable from a
 * single total. That reasoning applied one level down to `ignored`, which counted
 * three unrelated causes under one number — an allowlist that does not include
 * the device, a device configured for sFlow, and a version with no parser. Each
 * has a different fix on a different box, and the interface being built on top of
 * this could say only that the number was going up.
 *
 * The allowlist case is the sharpest: a rejected sender never reaches `statsFor`,
 * so it appears nowhere in the per-exporter breakdown either. The whole of what
 * a mistyped `FLOW_EXPORTERS` entry looked like was a datagram count climbing
 * while the record count stayed at zero.
 *
 * `handleDatagram` is driven directly rather than through a socket. Binding one
 * would make this a test of `dgram` and of whichever port CI has free; what is
 * under test is the bookkeeping a datagram produces once it has arrived.
 */

process.env.JWT_SECRET ??= 'flow-status-test-secret';
/*
 * An allowlist with one entry, so `notAllowed` is reachable. Set before the
 * dynamic import below, because `env.ts` reads `process.env` once at module load
 * — and assigned rather than deleted for the reason `test/env.ts` gives about
 * dotenv restoring anything absent from `api/.env`.
 */
process.env.FLOW_EXPORTERS = '10.0.0.1';

let FlowCollector: typeof import('./collector.js').FlowCollector;

/** The private entry point a bound socket would call. */
type Receiver = { handleDatagram: (datagram: Buffer, exporter: string) => void };

const netflowV5 = () => buildNetflowV5([{ srcIp: '1.1.1.1', dstIp: '2.2.2.2', srcPort: 1, dstPort: 2 }]);

/** A version word nothing here implements, in an otherwise plausible header. */
function unsupportedVersion(): Buffer {
  const datagram = Buffer.alloc(24);
  datagram.writeUInt16BE(7, 0);
  datagram.writeUInt16BE(1, 2);
  return datagram;
}

describe('what the flow status reports about dropped datagrams', () => {
  before(async () => {
    ({ FlowCollector } = await import('./collector.js'));
  });

  const receive = (datagrams: [Buffer, string][]) => {
    const collector = new FlowCollector();
    for (const [datagram, exporter] of datagrams) {
      (collector as unknown as Receiver).handleDatagram(datagram, exporter);
    }
    return collector.getStatus();
  };

  it('names the allowlist when a sender is refused', () => {
    const status = receive([[netflowV5(), '192.168.5.5']]);

    assert.equal(status.ignored, 1);
    assert.equal(status.ignoredReasons.notAllowed, 1);
    assert.equal(status.ignoredReasons.sflow, 0);
    assert.equal(status.ignoredReasons.unsupportedVersion, 0);
  });

  it('reports the allowlist the sender was refused against', () => {
    // The other half of that diagnosis, and useless without it: "1 datagram
    // refused" beside the list it was refused against is what lets an operator
    // compare a device's address to `FLOW_EXPORTERS` and see the typo.
    const status = receive([[netflowV5(), '192.168.5.5']]);

    assert.deepEqual(status.allowedExporters, ['10.0.0.1']);
  });

  it('leaves a refused sender out of the per-exporter list', () => {
    /*
     * Not a gap to fix — a sender the allowlist rejects is not an exporter of
     * this collector's, and tracking one would let remote input create rows.
     * Asserted because it is exactly why the reason counter had to exist: with
     * the sender absent from the breakdown, the count was the only place the
     * rejection could show up at all.
     */
    const status = receive([[netflowV5(), '192.168.5.5']]);

    assert.deepEqual(status.exporters, []);
  });

  it('tells sFlow apart, which is a different protocol rather than a fault', () => {
    // Its own count because its fix is on the device — configure it for NetFlow
    // or IPFIX — and not in this application's allowlist.
    const status = receive([[buildSflowHeader(), '10.0.0.1']]);

    assert.equal(status.ignoredReasons.sflow, 1);
    assert.equal(status.ignoredReasons.notAllowed, 0);
  });

  it('tells an unimplemented version apart from both', () => {
    const status = receive([[unsupportedVersion(), '10.0.0.1']]);

    assert.equal(status.ignoredReasons.unsupportedVersion, 1);
    assert.equal(status.ignoredReasons.sflow, 0);
    assert.equal(status.ignoredReasons.notAllowed, 0);
  });

  it('keeps the total and the breakdown in step', () => {
    /*
     * `ignored` is summed from the three rather than counted alongside them, so
     * the headline and the detail cannot disagree. A second counter is the sort
     * of thing that stays correct until somebody adds a fourth reason and
     * increments only one of them.
     */
    const status = receive([
      [netflowV5(), '192.168.5.5'],
      [netflowV5(), '192.168.5.6'],
      [buildSflowHeader(), '10.0.0.1'],
      [unsupportedVersion(), '10.0.0.1'],
    ]);

    const { notAllowed, sflow, unsupportedVersion: unsupported } = status.ignoredReasons;
    assert.equal(status.ignored, notAllowed + sflow + unsupported);
    assert.equal(status.ignored, 4);
  });

  it('counts an accepted datagram as received rather than ignored', () => {
    // The control. A reason counter that fired on the happy path would make the
    // whole panel read as broken on a working installation.
    const status = receive([[netflowV5(), '10.0.0.1']]);

    assert.equal(status.ignored, 0);
    assert.equal(status.datagrams, 1);
    assert.equal(status.records, 1);
    assert.equal(status.exporters.length, 1);
    assert.equal(status.exporters[0]?.exporter, '10.0.0.1');
  });

  it('reports not listening while nothing is bound', () => {
    /*
     * `enabled` and `listening` are separate fields and differ exactly when the
     * bind failed — the port is taken, or the address is not on this host — which
     * is the second most likely setup failure. A single on/off would hide it, so
     * the panel renders them as two facts.
     */
    const status = receive([]);

    assert.equal(status.listening, false);
    assert.equal(status.address, null);
    assert.equal(status.port, null);
  });

  it('closes the socket it opened when the bind fails', async () => {
    /*
     * `this.socket` is assigned only after a successful bind, so a rejection
     * escaped `start()` with the handle referenced by nothing — and the
     * persistent `error` listener's `this.stop()` found `this.socket` still null
     * and closed nothing. The descriptor stayed open for the life of the process.
     *
     * That cost one handle on a boot already failing, until settings became
     * something an operator changes repeatedly: every save rebinds, and there is
     * a Try binding again button on the screen built for somebody working
     * through a port conflict. The leak scaled with how hard they were trying.
     *
     * Driven by binding the port twice without `reuseAddr` on the second, so the
     * second `start()` genuinely fails the way a taken port does.
     */
    const holder = createSocket({ type: 'udp4' });
    await new Promise<void>((resolve) => holder.bind(0, '127.0.0.1', resolve));
    const { port } = holder.address();

    const collector = new FlowCollector();

    // Point the collector at the taken port. The cached settings object is what
    // `start()` reads, so mutating it is the same as having saved these values.
    const settings = await import('../services/flow-settings.service.js');
    Object.assign(settings.currentFlowSettings(), { port, bindAddress: '127.0.0.1' });

    let failed = false;
    try {
      await collector.start();
    } catch {
      failed = true;
    } finally {
      holder.close();
    }

    assert.equal(failed, true, 'binding a port already held should fail');
    // Nothing was retained, so nothing is left to leak — and a second attempt
    // still reports not listening rather than inheriting a half-open handle.
    assert.equal(collector.getStatus().listening, false);
  });

  it('starts the counters again when the socket is rebound', () => {
    /*
     * Counters belong to a binding, not to the process. They used to survive a
     * rebind, which broke the page in the situation it exists for: `Diagnosis`
     * branches on `datagrams === 0` and on every datagram having been refused,
     * and neither can be true again once a working binding has banked counts. So
     * an administrator who mistyped the port and saved went on seeing the green
     * "Collecting — N records", with figures from a binding that no longer
     * existed.
     */
    const collector = new FlowCollector();
    (collector as unknown as Receiver).handleDatagram(netflowV5(), '10.0.0.1');
    assert.equal(collector.getStatus().datagrams, 1);

    collector.resetForRebind();

    const status = collector.getStatus();
    assert.equal(status.datagrams, 0);
    assert.equal(status.records, 0);
    assert.equal(status.ignored, 0);
    assert.deepEqual(status.exporters, []);
    assert.equal(status.detection.findings, 0);
  });

  it('forgets the refusals when the allowlist changes, and nothing else', () => {
    /*
     * The counter that outlived the list it was counted against.
     *
     * `exporters` deliberately does not rebind — it is a filter test per
     * datagram, so reopening the socket for it would drop what is in flight for
     * nothing. That left `notAllowed` on screen beside an allowlist it was never
     * measured against: an administrator who has just corrected a mistyped
     * address watches the refusal count stand still and reads it as a fix that
     * did not take.
     *
     * Sharper still, clearing the allowlist entirely left `allowedExporterCount`
     * at zero with `notAllowed` above it, which the panel renders as "nothing
     * should have been refused, this is worth reporting" — a state its own
     * comment calls unreachable, reached by a routine edit.
     */
    const collector = new FlowCollector();
    const receiver = collector as unknown as Receiver;
    receiver.handleDatagram(netflowV5(), '192.168.5.5');
    receiver.handleDatagram(buildSflowHeader(), '10.0.0.1');
    receiver.handleDatagram(netflowV5(), '10.0.0.1');

    assert.equal(collector.getStatus().ignoredReasons.notAllowed, 1);

    collector.resetRefusals();

    const status = collector.getStatus();
    assert.equal(status.ignoredReasons.notAllowed, 0);
    /*
     * Only the refusals. `datagrams` counts what arrived on this binding and
     * that is still true — zeroing it would put the panel back into "nothing
     * has arrived", which is a different wrong answer. The sFlow tally is a
     * property of the sender rather than of the filter, and the accepted
     * exporter is still one.
     */
    assert.equal(status.datagrams, 3);
    assert.equal(status.ignoredReasons.sflow, 1);
    assert.equal(status.exporters.length, 1);
  });
});
