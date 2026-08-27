import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALERT_KINDS } from '../packet/detect/types.js';
import { type SuppressibleEvent, type SuppressionCriteria, SuppressionSet } from './suppression-rules.js';

/**
 * Suppression matching.
 *
 * Every test here is really the same question asked from a different angle: does
 * this rule suppress more than its author wrote down? A suppression that is too
 * narrow produces a nuisance alert somebody closes. A suppression that is too
 * broad produces silence, and silence is indistinguishable from a quiet network.
 *
 * So the emphasis is on the negative cases — the finding that must survive — and
 * on the two asymmetries that are easy to get backwards: a criterion left unset
 * matches anything, while a criterion set against a field the finding does not
 * have matches nothing.
 */

const NEVER = null;
const NOW = Date.parse('2026-08-27T12:00:00Z');

function rule(overrides: Partial<SuppressionCriteria> = {}): SuppressionCriteria {
  return {
    id: 1,
    kind: null,
    sourceCidr: null,
    targetCidr: null,
    port: null,
    enabled: true,
    expiresAt: NEVER,
    ...overrides,
  };
}

function event(overrides: Partial<SuppressibleEvent> = {}): SuppressibleEvent {
  return {
    kind: 'port_scan',
    sourceIp: '10.20.30.40',
    targetIp: '10.20.30.99',
    port: null,
    ...overrides,
  };
}

describe('suppression matching', () => {
  describe('a single criterion', () => {
    it('matches on kind alone', () => {
      const set = new SuppressionSet([rule({ kind: 'port_scan' })]);
      assert.equal(set.match(event(), NOW), 1);
      assert.equal(set.match(event({ kind: 'arp_spoofing' }), NOW), null);
    });

    it('matches on a source range alone', () => {
      const set = new SuppressionSet([rule({ sourceCidr: '10.20.30.0/24' })]);
      assert.equal(set.match(event(), NOW), 1);
      assert.equal(set.match(event({ sourceIp: '10.20.31.1' }), NOW), null);
    });

    it('matches on a target range alone', () => {
      const set = new SuppressionSet([rule({ targetCidr: '10.20.30.99' })]);
      assert.equal(set.match(event(), NOW), 1);
      assert.equal(set.match(event({ targetIp: '10.20.30.98' }), NOW), null);
    });

    it('matches on a port alone', () => {
      const set = new SuppressionSet([rule({ port: 445 })]);
      assert.equal(set.match(event({ port: 445 }), NOW), 1);
      assert.equal(set.match(event({ port: 446 }), NOW), null);
    });

    it('matches an IPv6 source range', () => {
      const set = new SuppressionSet([rule({ sourceCidr: 'fd00:1234::/32' })]);
      assert.equal(set.match(event({ sourceIp: 'fd00:1234:5678::9' }), NOW), 1);
      assert.equal(set.match(event({ sourceIp: 'fd00:1235::9' }), NOW), null);
    });
  });

  describe('several criteria', () => {
    it('requires every criterion that is set', () => {
      // The rule an operator actually writes: this scanner, this kind, this port.
      const set = new SuppressionSet([rule({ kind: 'host_sweep', sourceCidr: '10.20.30.0/24', port: 445 })]);
      const sweep = { kind: 'host_sweep', sourceIp: '10.20.30.40', port: 445 };

      assert.equal(set.match(sweep, NOW), 1);
      // One criterion off in turn — each must be enough to let the finding through.
      assert.equal(set.match({ ...sweep, kind: 'port_scan' }, NOW), null);
      assert.equal(set.match({ ...sweep, sourceIp: '10.99.0.1' }, NOW), null);
      assert.equal(set.match({ ...sweep, port: 3389 }, NOW), null);
    });

    it('lets an unset criterion match anything', () => {
      const set = new SuppressionSet([rule({ kind: 'new_device' })]);
      // No source, no target, no port on the rule: whatever the finding carries
      // in those fields is irrelevant, including nothing at all.
      assert.equal(set.match({ kind: 'new_device' }, NOW), 1);
      assert.equal(
        set.match({ kind: 'new_device', sourceIp: '203.0.113.9', targetIp: null, port: 22 }, NOW),
        1,
      );
    });
  });

  describe('the field the finding does not have', () => {
    it('does not match a sourceless finding against a source range', () => {
      // An ARP MAC-sprawl report has no source IP. A rule about 10.0.0.0/8 is a
      // statement about addresses, and a finding with no address is not covered
      // by it — the opposite reading would suppress exactly the findings whose
      // provenance is least clear.
      const set = new SuppressionSet([rule({ sourceCidr: '10.0.0.0/8' })]);
      assert.equal(set.match({ kind: 'arp_spoofing' }, NOW), null);
      assert.equal(set.match({ kind: 'arp_spoofing', sourceIp: null }, NOW), null);
    });

    it('does not match a portless finding against a port', () => {
      // The port-scan case, and the reason `port` is null unless exactly one port
      // describes the finding: a rule for 445 must not swallow a scan that
      // touched 445 among forty others.
      const set = new SuppressionSet([rule({ port: 445 })]);
      assert.equal(set.match(event({ port: null }), NOW), null);
      assert.equal(set.match({ kind: 'port_scan' }, NOW), null);
    });
  });

  describe('enabled and expiry', () => {
    it('never matches a disabled rule', () => {
      const set = new SuppressionSet([rule({ kind: 'port_scan', enabled: false })]);
      assert.equal(set.size, 0);
      assert.equal(set.match(event(), NOW), null);
    });

    it('matches before the expiry and not after it', () => {
      const set = new SuppressionSet([rule({ kind: 'port_scan', expiresAt: new Date(NOW + 60_000) })]);
      assert.equal(set.match(event(), NOW), 1);
      assert.equal(set.match(event(), NOW + 59_999), 1);
      assert.equal(set.match(event(), NOW + 60_001), null);
    });

    it('treats the expiry instant itself as expired', () => {
      // Boundary stated explicitly rather than left to whichever comparison got
      // typed: at the stated time the rule is over.
      const set = new SuppressionSet([rule({ kind: 'port_scan', expiresAt: new Date(NOW) })]);
      assert.equal(set.match(event(), NOW), null);
    });

    it('keeps an expired rule out of the way of a later one', () => {
      // A stale cache holds expired rules; they must not shadow the rule that
      // does apply, and they must not be dropped at compile time either — the
      // expiry has to be re-evaluated per finding for a cached set to be correct.
      const set = new SuppressionSet([
        rule({ id: 1, kind: 'port_scan', expiresAt: new Date(NOW - 1) }),
        rule({ id: 2, kind: 'port_scan' }),
      ]);
      assert.equal(set.size, 2);
      assert.equal(set.match(event(), NOW), 2);
    });
  });

  describe('bad data', () => {
    it('drops a rule whose range will not parse, and says which', () => {
      // Fail-open, deliberately: a rule this code cannot understand lets findings
      // through. The alternative — compiling the unparseable half as "any" —
      // turns a typo into a silent blind spot.
      const set = new SuppressionSet([
        rule({ id: 7, kind: 'port_scan', sourceCidr: '10.0.0.0/99' }),
        rule({ id: 8, kind: 'port_scan', targetCidr: 'not-an-address' }),
      ]);
      assert.equal(set.size, 0);
      assert.deepEqual(
        set.unusable.map((each) => each.id),
        [7, 8],
      );
      assert.equal(set.match(event(), NOW), null);
    });

    it('names the field that is wrong, not just the rule', () => {
      // The reason reaches the page and the log. "#8 is invalid" sends an operator
      // hunting; naming the field and the value does not.
      const set = new SuppressionSet([
        rule({ id: 7, sourceCidr: '10.0.0.0/99' }),
        rule({ id: 8, targetCidr: 'not-an-address' }),
      ]);
      assert.match(set.unusable[0]!.reason, /source .*10\.0\.0\.0\/99/);
      assert.match(set.unusable[1]!.reason, /target .*not-an-address/);
    });

    it('refuses a match-everything range even though the rest of the rule is valid', () => {
      const set = new SuppressionSet([rule({ id: 9, sourceCidr: '0.0.0.0/0' })]);
      assert.equal(set.size, 0);
      assert.deepEqual(
        set.unusable.map((each) => each.id),
        [9],
      );
    });

    it('drops a rule naming a kind no detector raises', () => {
      // Not reachable through the API, which validates against a closed enum. The
      // realistic route is a detector kind being renamed later, at which point
      // every rule naming the old one silently stops suppressing — the noise comes
      // back and nothing says why. This is what makes that rename fail visibly.
      const set = new SuppressionSet([rule({ id: 11, kind: 'port_scanning' })]);
      assert.equal(set.size, 0);
      assert.equal(set.unusable[0]?.id, 11);
      assert.match(set.unusable[0]!.reason, /no detector raises the kind "port_scanning"/);
    });

    it('accepts every kind a detector actually raises', () => {
      // The other half: the check must not reject a kind that is real, or the
      // guard above would take every rule down with it.
      const set = new SuppressionSet(ALERT_KINDS.map((kind, index) => rule({ id: index + 1, kind })));
      assert.equal(set.size, ALERT_KINDS.length);
      assert.deepEqual(set.unusable, []);
    });
  });

  describe('several rules', () => {
    it('attributes a finding covered twice to the first rule only', () => {
      // So the counters add up to findings suppressed rather than to rules that
      // would have suppressed something.
      const set = new SuppressionSet([
        rule({ id: 4, sourceCidr: '10.20.0.0/16' }),
        rule({ id: 5, kind: 'port_scan' }),
      ]);
      assert.equal(set.match(event(), NOW), 4);
    });

    it('is inert when empty', () => {
      const set = new SuppressionSet([]);
      assert.equal(set.size, 0);
      assert.equal(set.match(event(), NOW), null);
    });
  });
});
