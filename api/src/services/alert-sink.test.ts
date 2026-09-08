import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Finding } from '../packet/detect/types.js';

/**
 * `AlertSink.record()`'s in-memory merge, in isolation from `flush()` — this needs
 * no database, unlike the rest of alert.service.ts. See the review that caught the
 * bug this guards: the flow collector documents findings arriving out of order, and
 * an unconditional `existing.lastSeen = finding.timestamp` (or the DB-side
 * `onConflictDoUpdate` mirroring it) can pull `lastSeen` behind `firstSeen` — a
 * pairing the alerts table's own CHECK constraint forbids. The fix clamps with
 * `Math.max`/`Math.min` here and `greatest()`/`least()` in `upsertAlert`; only the
 * in-memory half is practical to unit test without a live Postgres.
 *
 * ---------------------------------------------------------------------------
 * "NEEDS NO DATABASE" WAS A CLAIM, NOT A FACT, AND THE DIFFERENCE COST REAL ROWS.
 *
 * `record()` does not only merge: it calls `scheduleFlush()`, which sets a 3-second
 * timer that writes the buffer to Postgres. This file has no database of its own,
 * so that write went to whatever `DATABASE_URL` resolves to — and `env.ts` loads
 * `api/.env`, so on a developer machine that is their DEV database. The API suite
 * runs far longer than three seconds, so the timer always fired; every sink here
 * shares one dedup window bucket, so they merged into exactly one row. One "Test
 * finding" alert appeared in the developer's real data on every `npm test`, and the
 * comment above said the file could not do that.
 *
 * The fix is the pattern four other suites here already use, and for this exact
 * reason: point `DATABASE_URL` somewhere unreachable BEFORE anything imports the
 * pool. A stray flush then fails at connect and `flush()` swallows it, which is
 * what it does with every other transient database error.
 *
 * That has to happen before the import, not in a hook — `env.ts` reads
 * `process.env` once at module load, and a static `import` is evaluated before any
 * statement in this file. Hence the dynamic imports below, which is also why
 * `bucketStart` and friends are computed in `before` rather than at module scope.
 */

process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
// Deliberately unreachable. Nothing here should reach a query; this makes a stray
// flush a connection error rather than a silent write to the developer's data.
process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/should-never-connect';

type AlertService = typeof import('./alert.service.js');
type Sink = InstanceType<AlertService['AlertSink']>;

let AlertSink: AlertService['AlertSink'];
/** Two timestamps guaranteed to land in the same dedup window bucket. */
let later: Date;
let earlier: Date;

before(async () => {
  ({ AlertSink } = await import('./alert.service.js'));
  const { env } = await import('../config/env.js');

  // `windowedKey()` buckets by absolute epoch time, so these are computed from the
  // window rather than from "now" — otherwise the pair straddles a boundary
  // whenever the suite happens to run near one, and the merge under test never
  // happens.
  const windowMs = env.detection.alertWindowMs;
  const bucketStart = Math.floor(Date.now() / windowMs) * windowMs;
  later = new Date(bucketStart + Math.floor(windowMs * 0.6));
  earlier = new Date(bucketStart + Math.floor(windowMs * 0.1));
});

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: 'port_scan',
    severity: 'high',
    messageKey: 'port_scan.packet',
    messageParams: { source: '10.0.0.66', target: '10.0.0.89', count: 22, seconds: 60 },
    dedupKey: 'test-finding',
    evidence: {},
    timestamp: new Date(),
    ...overrides,
  };
}

function onlyEntry(sink: Sink) {
  const entries = [...sink.pendingSnapshot.values()];
  assert.equal(entries.length, 1, 'expected exactly one pending entry — the two findings did not merge');
  return entries[0]!;
}

describe('AlertSink.record merge', () => {
  it('extends lastSeen forward on an in-order repeat', () => {
    const sink = new AlertSink();
    sink.record([makeFinding({ timestamp: earlier })]);
    sink.record([makeFinding({ timestamp: later })]);

    const entry = onlyEntry(sink);
    assert.equal(entry.lastSeen.getTime(), later.getTime());
    assert.equal(entry.firstSeen.getTime(), earlier.getTime());
    assert.equal(entry.occurrences, 2);
  });

  it('does not let an out-of-order repeat pull lastSeen backward', () => {
    const sink = new AlertSink();
    // Processed later, timestamped earlier — the flow-collector case.
    sink.record([makeFinding({ timestamp: later })]);
    sink.record([makeFinding({ timestamp: earlier })]);

    const entry = onlyEntry(sink);
    assert.equal(entry.lastSeen.getTime(), later.getTime());
    assert.equal(entry.occurrences, 2);
  });

  it('pulls firstSeen backward when an earlier occurrence is discovered later', () => {
    const sink = new AlertSink();
    sink.record([makeFinding({ timestamp: later })]);
    sink.record([makeFinding({ timestamp: earlier })]);

    const entry = onlyEntry(sink);
    assert.equal(entry.firstSeen.getTime(), earlier.getTime());
  });

  it('never leaves lastSeen before firstSeen, in either arrival order', () => {
    for (const order of [
      [earlier, later],
      [later, earlier],
    ]) {
      const sink = new AlertSink();
      for (const timestamp of order) sink.record([makeFinding({ timestamp })]);

      const entry = onlyEntry(sink);
      assert.ok(
        entry.lastSeen.getTime() >= entry.firstSeen.getTime(),
        `lastSeen (${entry.lastSeen.toISOString()}) fell before firstSeen ` +
          `(${entry.firstSeen.toISOString()}) for arrival order ${order.map((d) => d.toISOString())}`,
      );
    }
  });
});
