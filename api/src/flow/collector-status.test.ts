import assert from 'node:assert/strict';
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
});
