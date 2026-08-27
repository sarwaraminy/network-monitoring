import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePrefix, prefixContains } from './prefix.js';

/**
 * Prefix parsing and containment.
 *
 * These are the tests that decide what a suppression rule actually covers, so
 * the emphasis is on the ways a prefix can quietly mean something wider than it
 * looks: a `/0`, host bits left set, a family mismatch, an address form the
 * canonicaliser refuses. Every one of those, mishandled, produces a rule that
 * hides findings its author never intended to hide — and unlike a rule that is
 * too narrow, nothing about it looks wrong afterwards.
 */

/** Parses and asserts success, so the cases below stay one line each. */
function prefix(value: string) {
  const parsed = parsePrefix(value);
  assert.ok(parsed, `expected ${value} to parse`);
  return parsed;
}

describe('parsePrefix', () => {
  it('treats a bare IPv4 address as a single host', () => {
    const parsed = prefix('10.0.0.7');
    assert.equal(parsed.family, 4);
    assert.equal(parsed.bits, 32);
    assert.equal(parsed.text, '10.0.0.7/32');
    assert.ok(prefixContains(parsed, '10.0.0.7'));
    assert.ok(!prefixContains(parsed, '10.0.0.8'));
  });

  it('treats a bare IPv6 address as a single host', () => {
    const parsed = prefix('2001:db8::1');
    assert.equal(parsed.family, 6);
    assert.equal(parsed.bits, 128);
    assert.ok(prefixContains(parsed, '2001:db8::1'));
    assert.ok(!prefixContains(parsed, '2001:db8::2'));
  });

  it('normalises host bits away, so the stored text is the range that matches', () => {
    // `10.0.0.7/24` is a legal way to write the whole /24. Storing it verbatim
    // would show an operator one address next to a rule covering 256 of them.
    assert.equal(prefix('10.0.0.7/24').text, '10.0.0.0/24');
    assert.equal(prefix('192.168.5.200/16').text, '192.168.0.0/16');
    assert.equal(prefix('2001:db8::dead:beef/64').text, '2001:db8:0:0:0:0:0:0/64');
  });

  it('refuses a zero-length prefix in both families', () => {
    // The reason this is a hard refusal rather than a wide match: a rule needs at
    // least one criterion so that no single rule can swallow every finding, and
    // `0.0.0.0/0` satisfies that check while defeating what it is for.
    assert.equal(parsePrefix('0.0.0.0/0'), null);
    assert.equal(parsePrefix('::/0'), null);
  });

  it('refuses a prefix length past the end of the family', () => {
    assert.equal(parsePrefix('10.0.0.0/33'), null);
    assert.equal(parsePrefix('2001:db8::/129'), null);
    // A v6 length on a v4 address is the plausible typo of the two.
    assert.equal(parsePrefix('10.0.0.0/64'), null);
  });

  it('refuses anything that is not unambiguously a prefix', () => {
    for (const value of [
      '',
      '   ',
      '10.0.0',
      '10.0.0.256',
      '10.0.0.1/',
      '10.0.0.1/abc',
      '10.0.0.1/-1',
      '10.0.0.1/ 8',
      'not-an-address',
      '10.0.0.0/8/8',
    ]) {
      assert.equal(parsePrefix(value), null, `expected ${JSON.stringify(value)} to be refused`);
    }
  });

  it('refuses the IPv6 forms the canonicaliser will not interpret', () => {
    // Inherited from intel/match.ts on purpose: whatever the observed address
    // side refuses, the rule side must refuse too, or the two disagree about
    // what an address means.
    assert.equal(parsePrefix('::ffff:1.2.3.4'), null);
    assert.equal(parsePrefix('fe80::1%eth0'), null);
    assert.equal(parsePrefix('2001:db8::1::2'), null);
  });

  it('handles the top of the IPv4 range without going negative', () => {
    const parsed = prefix('255.255.255.255');
    assert.ok(prefixContains(parsed, '255.255.255.255'));
    assert.ok(!prefixContains(parsed, '255.255.255.254'));
  });
});

describe('prefixContains', () => {
  it('includes both ends of the range and nothing beyond', () => {
    const parsed = prefix('10.1.2.0/24');
    assert.ok(prefixContains(parsed, '10.1.2.0'));
    assert.ok(prefixContains(parsed, '10.1.2.255'));
    assert.ok(!prefixContains(parsed, '10.1.1.255'));
    assert.ok(!prefixContains(parsed, '10.1.3.0'));
  });

  it('includes both ends of an IPv6 range and nothing beyond', () => {
    const parsed = prefix('2001:db8:0:1::/64');
    assert.ok(prefixContains(parsed, '2001:db8:0:1::'));
    assert.ok(prefixContains(parsed, '2001:db8:0:1:ffff:ffff:ffff:ffff'));
    assert.ok(!prefixContains(parsed, '2001:db8:0:2::'));
    assert.ok(!prefixContains(parsed, '2001:db8::ffff:ffff:ffff:ffff'));
  });

  it('matches an address written in a different but equivalent form', () => {
    // The v6 failure that matters most, and the one intel/match.ts had: two
    // spellings of one address must meet.
    const parsed = prefix('2001:db8::/32');
    assert.ok(prefixContains(parsed, '2001:0db8:0000:0000:0000:0000:0000:0001'));
    assert.ok(prefixContains(parsed, '2001:DB8::1'));
  });

  it('never matches across address families', () => {
    // A rule written for a v4 range must not suppress a v6 finding, and the
    // reverse. Both directions, because only one of them is obvious.
    assert.ok(!prefixContains(prefix('10.0.0.0/8'), '2001:db8::1'));
    assert.ok(!prefixContains(prefix('2001:db8::/32'), '10.0.0.1'));
    // `::` in a v4 rule is not a near-miss to be salvaged either.
    assert.ok(!prefixContains(prefix('0.0.0.1/32'), '::1'));
  });

  it('is false for a missing or unparseable address', () => {
    // Not an error, and deliberately not a match: an address this code failed to
    // understand is not evidence that a suppression applies.
    const parsed = prefix('10.0.0.0/8');
    assert.ok(!prefixContains(parsed, null));
    assert.ok(!prefixContains(parsed, undefined));
    assert.ok(!prefixContains(parsed, ''));
    assert.ok(!prefixContains(parsed, '  '));
    assert.ok(!prefixContains(parsed, '10.0.0.999'));
    assert.ok(!prefixContains(parsed, 'nonsense'));
  });

  it('tolerates surrounding whitespace on the observed address', () => {
    assert.ok(prefixContains(prefix('10.0.0.0/8'), ' 10.4.5.6 '));
  });
});
