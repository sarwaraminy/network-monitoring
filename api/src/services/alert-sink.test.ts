import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '../config/env.js';
import type { Finding } from '../packet/detect/types.js';
import { AlertSink } from './alert.service.js';

/**
 * `AlertSink.record()`'s in-memory merge, in isolation from `flush()` — this needs
 * no database, unlike the rest of alert.service.ts. See the review that caught the
 * bug this guards: the flow collector documents findings arriving out of order, and
 * an unconditional `existing.lastSeen = finding.timestamp` (or the DB-side
 * `onConflictDoUpdate` mirroring it) can pull `lastSeen` behind `firstSeen` — a
 * pairing the alerts table's own CHECK constraint forbids. The fix clamps with
 * `Math.max`/`Math.min` here and `greatest()`/`least()` in `upsertAlert`; only the
 * in-memory half is practical to unit test without a live Postgres.
 */

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: 'port_scan',
    severity: 'high',
    title: 'Test finding',
    description: 'test',
    dedupKey: 'test-finding',
    evidence: {},
    timestamp: new Date(),
    ...overrides,
  };
}

// Two timestamps guaranteed to land in the same dedup window bucket, regardless of
// when the suite happens to run — windowedKey() buckets by absolute epoch time.
const windowMs = env.detection.alertWindowMs;
const bucketStart = Math.floor(Date.now() / windowMs) * windowMs;
const later = new Date(bucketStart + Math.floor(windowMs * 0.6));
const earlier = new Date(bucketStart + Math.floor(windowMs * 0.1));

function onlyEntry(sink: AlertSink) {
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
