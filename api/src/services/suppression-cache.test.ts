import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { SuppressionRow } from '../db/schema.js';

/**
 * The rule cache: write ordering, and what happens when the database is down.
 *
 * suppression-rules.test.ts covers what a rule matches. This covers the layer
 * around it, where the two interesting behaviours are both about *timing* rather
 * than about Postgres — so the loader is injected and no database is involved,
 * the same seam `EmailChannel` takes as `transportFactory`.
 *
 * Both cases came out of review, and both fail quietly in production:
 *
 *  - A mutation that awaits a reload already in flight can be satisfied by a query
 *    that ran *before* its own write committed, publishing a set without the new
 *    rule and stamping it fresh. The rule then does not apply for up to the refresh
 *    interval — breaking exactly the guarantee the mutations claim, that a rule is
 *    in force by the time its 201 arrives.
 *  - `suppressions()` runs once per finding batch, so an unreachable database with
 *    no backoff means back-to-back failing queries and a continuous error stream
 *    for the length of the outage, at the moment findings arrive fastest.
 */

let service: typeof import('./suppression.service.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  // Imported after the environment is set; the module builds a pool at import
  // time, though nothing here ever lets it connect.
  service = await import('./suppression.service.js');
});

/** A stored row, with only the columns matching looks at filled in. */
function row(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return {
    id: 1,
    kind: 'port_scan',
    sourceCidr: null,
    targetCidr: null,
    port: null,
    reason: 'test',
    enabled: true,
    expiresAt: null,
    createdBy: 'test',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    matchCount: 0,
    lastMatchAt: null,
    ...overrides,
  };
}

/** A promise plus its resolver, so a test decides when a load finishes. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { promise, open };
}

beforeEach(() => {
  service.setRuleLoaderForTests(null);
  service.resetSuppressionCache();
});

describe('rule cache write ordering', () => {
  it('does not let a write be satisfied by a query that ran before it', async () => {
    // The table as the database holds it. The loader snapshots it when its query
    // *runs*, which is what makes the ordering observable.
    const table: SuppressionRow[] = [];
    const first = gate();
    let calls = 0;

    service.setRuleLoaderForTests(async () => {
      calls += 1;
      // Only the first load is held open; later ones resolve immediately.
      if (calls === 1) await first.promise;
      return [...table];
    });

    // A background reload is in flight — what `suppressions()` starts every 30
    // seconds on any system that is seeing findings.
    const inflight = service.refreshSuppressions();

    // The write commits while that load is still outstanding.
    table.push(row({ id: 7 }));

    // The mutation's reload. It must not be the one already running.
    const afterWrite = service.reloadAfterWrite();
    first.open();
    await afterWrite;

    assert.equal(
      service.suppressions().match({ kind: 'port_scan' }),
      7,
      'the rule was not in force when the write returned',
    );
    await inflight;
    assert.equal(calls, 2, 'the write reused the in-flight load instead of chaining after it');
  });

  it('still coalesces reads, so a burst does not start a load each', async () => {
    // The other half. Chaining every caller would undo the reason the coalescing
    // exists: one reload per burst, not one per batch.
    const held = gate();
    let calls = 0;
    service.setRuleLoaderForTests(async () => {
      calls += 1;
      await held.promise;
      return [];
    });

    const a = service.refreshSuppressions();
    const b = service.refreshSuppressions();
    const c = service.refreshSuppressions();
    held.open();
    await Promise.all([a, b, c]);

    assert.equal(calls, 1);
  });

  it('serialises two writes so the later one is published last', async () => {
    const table: SuppressionRow[] = [];
    service.setRuleLoaderForTests(async () => [...table]);

    table.push(row({ id: 1 }));
    const firstWrite = service.reloadAfterWrite();
    table.push(row({ id: 2, kind: 'host_sweep' }));
    const secondWrite = service.reloadAfterWrite();

    await Promise.all([firstWrite, secondWrite]);
    // Both rules present: the second load cannot have been published before the
    // first, and neither can have overwritten the other's rows.
    assert.equal(service.suppressions().size, 2);
  });
});

describe('rule cache when the database is unreachable', () => {
  it('keeps the previous rules in force rather than suppressing nothing or everything', async () => {
    service.setRuleLoaderForTests(async () => [row({ id: 3 })]);
    await service.refreshSuppressions();
    assert.equal(service.suppressions().match({ kind: 'port_scan' }), 3);

    service.setRuleLoaderForTests(async () => {
      throw new Error('connection refused');
    });
    await service.refreshSuppressions();

    // Fail-open would be losing the rule; fail-closed would be suppressing
    // everything. Neither: the last good set stays exactly as it was.
    assert.equal(service.suppressions().match({ kind: 'port_scan' }), 3);
  });

  it('retries promptly a few times and then stops hammering', async () => {
    let calls = 0;
    service.setRuleLoaderForTests(async () => {
      calls += 1;
      throw new Error('connection refused');
    });

    // `suppressions()` is the hot-path read, called once per finding batch. With
    // no load ever having succeeded it is stale, so each call is a chance to
    // start one.
    for (let batch = 0; batch < 20; batch += 1) {
      service.suppressions();
      // Let the rejected load settle, so `loading` is clear for the next call —
      // otherwise the in-flight guard, not the backoff, would be what stops it.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    // The prompt retries, and then nothing: without the backoff this is 20.
    assert.ok(calls > 1, 'the first failures should retry promptly, not back off immediately');
    assert.ok(
      calls <= 4,
      `20 finding batches against a dead database started ${calls} loads; expected the retries to be bounded`,
    );
  });

  it('says so when the rules load again after failing', async () => {
    // The transition matters as much as the failure: suppression was not being
    // applied in between, and nothing else would ever say that.
    service.setRuleLoaderForTests(async () => {
      throw new Error('connection refused');
    });
    await service.refreshSuppressions();

    service.setRuleLoaderForTests(async () => [row({ id: 5 })]);
    await service.refreshSuppressions();

    assert.equal(service.suppressions().match({ kind: 'port_scan' }), 5);
    // A recovered load clears the gate, so reads resume at the normal interval.
    assert.equal(service.suppressions().size, 1);
  });
});
