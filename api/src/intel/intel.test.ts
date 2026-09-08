import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { assess, directionOf, isPrivateAddress } from './assess.js';
import { canonicalIpv6, IndicatorSet, ipv4ToInt, normalizeDomain, parseCidr } from './match.js';
import { classify, parseFeed } from './parse.js';

/**
 * Threat-intelligence matching.
 *
 * This detector's whole value is that a hit means something. A threshold detector
 * that fires wrongly is annoying; an indicator detector that fires wrongly is
 * worse, because it claims certainty — "this address is known malicious" — and
 * the operator has no way to argue with it. So the tests below lean hard on what
 * must *not* match: private ranges a feed wrongly listed, junk lines, partial
 * domain matches that are not really parents.
 *
 * The direction grading gets the same attention. Inbound scanning from listed
 * addresses is constant on any internet-facing network, and grading it critical
 * would bury the operator on the first day.
 */

let registry: typeof import('./registry.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  registry = await import('./registry.js');
});

function setWith(...entries: Array<[string, Parameters<IndicatorSet['add']>[0]['type'], string?]>) {
  const set = new IndicatorSet();
  for (const [value, type, note] of entries) {
    set.add({ value, type, source: 'test-feed', ...(note ? { note } : {}) });
  }
  set.seal();
  return set;
}

/**
 * A stand-in for "how this was observed".
 *
 * `assess` takes a message reference rather than a phrase since the finding text
 * became translatable, and none of the assertions below are about which one it
 * was — they are about the grading, which does not read it.
 */
const VIA = { key: 'threat_intel.via.packet_capture' } as const;

describe('address parsing', () => {
  it('converts dotted quads', () => {
    assert.equal(ipv4ToInt('0.0.0.0'), 0);
    assert.equal(ipv4ToInt('1.2.3.4'), 16_909_060);
    // Must stay unsigned; a bare shift would make this negative.
    assert.equal(ipv4ToInt('255.255.255.255'), 4_294_967_295);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['1.2.3', '1.2.3.4.5', '256.0.0.1', '1.2.3.-1', 'a.b.c.d', '', '1.2.3.04x']) {
      assert.equal(ipv4ToInt(bad), null, `${bad} should be rejected`);
    }
  });

  it('expands CIDR to an inclusive range', () => {
    assert.deepEqual(parseCidr('192.0.2.0/24'), {
      start: ipv4ToInt('192.0.2.0'),
      end: ipv4ToInt('192.0.2.255'),
    });
    assert.deepEqual(parseCidr('1.2.3.4/32'), { start: ipv4ToInt('1.2.3.4'), end: ipv4ToInt('1.2.3.4') });
    // /0 is a special case: shifting by 32 is a no-op in JS, not a zero mask.
    assert.deepEqual(parseCidr('0.0.0.0/0'), { start: 0, end: 4_294_967_295 });
  });

  it('rejects malformed CIDR', () => {
    for (const bad of ['1.2.3.0/33', '1.2.3.0/-1', '1.2.3.0/', 'x/24', '1.2.3.0/abc']) {
      assert.equal(parseCidr(bad), null, `${bad} should be rejected`);
    }
  });

  it('normalises domains and rejects non-domains', () => {
    assert.equal(normalizeDomain('EVIL.example.COM.'), 'evil.example.com');
    assert.equal(normalizeDomain('localhost'), null, 'a bare label is not a domain');
    assert.equal(normalizeDomain('has space.com'), null);
    assert.equal(normalizeDomain(''), null);
  });
});

describe('indicator matching', () => {
  it('matches an exact address', () => {
    const set = setWith(['203.0.113.5', 'ipv4', 'Feodo C2']);
    const match = set.matchIp('203.0.113.5');
    assert.equal(match?.indicator, '203.0.113.5');
    assert.equal(match?.note, 'Feodo C2');
    assert.equal(set.matchIp('203.0.113.6'), null);
  });

  it('matches inside a CIDR and reports the prefix, not the address', () => {
    const set = setWith(['198.51.100.0/24', 'cidr']);
    const match = set.matchIp('198.51.100.77');
    assert.equal(match?.type, 'cidr');
    assert.equal(match?.indicator, '198.51.100.0/24', 'evidence must name the prefix that matched');
    assert.equal(match?.observed, '198.51.100.77');
    assert.equal(set.matchIp('198.51.101.1'), null);
  });

  it('handles overlapping ranges, which feeds routinely contain', () => {
    // The binary search finds the last range starting at or below the address,
    // which is only correct if ranges have been merged. Unmerged, the /24 would
    // shadow the /16 and addresses outside it would wrongly miss.
    const set = setWith(['203.0.0.0/16', 'cidr'], ['203.0.113.0/24', 'cidr']);
    assert.ok(set.matchIp('203.0.113.5'), 'inside both');
    assert.ok(set.matchIp('203.0.7.1'), 'inside the wider range only');
    assert.equal(set.matchIp('204.0.0.1'), null);
  });

  it('matches a parent domain, because listing a domain covers what it delegates', () => {
    const set = setWith(['bad.example', 'domain']);
    assert.ok(set.matchDomain('bad.example'));
    assert.ok(set.matchDomain('c2.bad.example'));
    assert.ok(set.matchDomain('a.b.c.bad.example'));
  });

  it('does not match a domain that merely ends with the same text', () => {
    // `notbad.example` must not match an indicator for `bad.example`.
    const set = setWith(['bad.example', 'domain']);
    assert.equal(set.matchDomain('notbad.example'), null);
    assert.equal(set.matchDomain('example'), null);
  });

  describe('refuses indicators that would light up the whole network', () => {
    it('rejects private and reserved addresses', () => {
      // Public blocklists do occasionally contain these. Accepting one would
      // alert on every host at once and destroy trust in the detector.
      const set = setWith(
        ['10.0.0.5', 'ipv4'],
        ['192.168.1.1', 'ipv4'],
        ['172.16.0.1', 'ipv4'],
        ['127.0.0.1', 'ipv4'],
        ['169.254.1.1', 'ipv4'],
        ['224.0.0.1', 'ipv4'],
      );
      assert.equal(set.size, 0, 'no private address should have been accepted');
      assert.equal(set.stats().rejected, 6);
    });

    it('rejects a CIDR covering private space', () => {
      const set = setWith(['10.0.0.0/8', 'cidr'], ['192.168.0.0/16', 'cidr'], ['0.0.0.0/0', 'cidr']);
      assert.equal(set.size, 0);
    });

    it('rejects IPv6 loopback, link-local, unique-local, multicast and unspecified', () => {
      const set = setWith(
        ['::1', 'ipv6'],
        // The same address written the long way. Prefix matching on the raw
        // string caught the first spelling and missed this one.
        ['0:0:0:0:0:0:0:1', 'ipv6'],
        ['fe80::1', 'ipv6'],
        ['febf::1', 'ipv6'],
        ['fd00::1', 'ipv6'],
        ['ff02::1', 'ipv6'],
        // Names no host at all, and a feed line of `::` is a parse accident.
        ['::', 'ipv6'],
      );
      assert.equal(set.size, 0);
    });

    it('refuses a v6 literal with a stray colon rather than rewriting it', () => {
      // This is the failure the module's own rule exists to prevent: filtering
      // empty groups unconditionally turned `:1:2:3:4:5:6:7:8` into the valid
      // but entirely different `1:2:3:4:5:6:7:8`, so one malformed feed line
      // became a confident indicator for an address it never named. Same class
      // as `999.999.999.999` being accepted as a domain.
      for (const malformed of [':1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:', '1:::2', ':', ':::']) {
        assert.equal(canonicalIpv6(malformed), null, `${malformed} should not canonicalise`);
      }

      const set = setWith([':1:2:3:4:5:6:7:8', 'ipv6'], ['1:2:3:4:5:6:7:8:', 'ipv6']);
      assert.equal(set.size, 0);
    });

    it('still canonicalises the well-formed spellings to one string', () => {
      assert.equal(canonicalIpv6('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8:0:0:0:0:0:1');
      assert.equal(canonicalIpv6('2001:db8::1'), '2001:db8:0:0:0:0:0:1');
      assert.equal(canonicalIpv6('::ffff:1.2.3.4'), null, 'an embedded v4 tail is refused, not folded');
    });

    it('still accepts ordinary public addresses', () => {
      const set = setWith(['8.8.8.8', 'ipv4'], ['203.0.113.0/24', 'cidr']);
      assert.equal(set.size, 2);
    });
  });

  it('reports per-source counts, so a silently empty feed is visible', () => {
    const set = new IndicatorSet();
    set.add({ value: '203.0.113.1', type: 'ipv4', source: 'feed-a' });
    set.add({ value: '203.0.113.2', type: 'ipv4', source: 'feed-a' });
    set.add({ value: 'bad.example', type: 'domain', source: 'feed-b' });
    set.seal();

    assert.deepEqual(set.stats().bySource, { 'feed-a': 2, 'feed-b': 1 });
  });

  it('honours the ceiling rather than growing without bound', () => {
    const set = new IndicatorSet(3);
    for (let index = 0; index < 10; index += 1) {
      set.add({ value: `203.0.113.${index}`, type: 'ipv4', source: 'feed' });
    }
    set.seal();
    assert.ok(set.size <= 3);
    assert.ok(set.stats().rejected > 0);
  });
});

describe('feed parsing', () => {
  it('classifies each token type', () => {
    assert.equal(classify('203.0.113.1'), 'ipv4');
    assert.equal(classify('203.0.113.0/24'), 'cidr');
    assert.equal(classify('2001:db8::1'), 'ipv6');
    assert.equal(classify('bad.example'), 'domain');
    assert.equal(classify('not an indicator'), null);
    assert.equal(classify(''), null);
  });

  it('reads a bare address list with comments, as abuse.ch ships', () => {
    const feed = ['# Feodo Tracker', '# Last updated: whenever', '', '203.0.113.5', '203.0.113.6'].join('\n');
    const { indicators, skipped } = parseFeed(feed, 'feodo');
    assert.equal(indicators.length, 2);
    assert.equal(skipped, 3);
    assert.equal(indicators[0]?.source, 'feodo');
  });

  it('reads CIDR with a trailing comment, as Spamhaus DROP ships', () => {
    const { indicators } = parseFeed('198.51.100.0/24 ; SBL123456\n203.0.113.0/24 ; SBL999', 'drop');
    assert.equal(indicators.length, 2);
    assert.equal(indicators[0]?.type, 'cidr');
    assert.equal(indicators[0]?.note, 'SBL123456');
  });

  it('reads CSV and skips an unprefixed header row', () => {
    // The header carries no `#`, so this exercises the type check rather than the
    // comment rule — which is what the docblock claims happens. The earlier
    // version used a `#`-prefixed header and proved neither.
    const feed = ['id,host,malware', '203.0.113.9,something,TrickBot'].join('\n');
    const { indicators, skipped } = parseFeed(feed, 'urlhaus');
    assert.equal(indicators.length, 1);
    assert.equal(skipped, 1, 'the header must be rejected by classify(), not the comment rule');
    assert.equal(indicators[0]?.value, '203.0.113.9');
  });

  it('skips junk instead of guessing at it', () => {
    // A line that is nearly an indicator must be dropped, not repaired. A wrong
    // indicator produces a confident false alarm, which is the worst outcome here.
    const { indicators, skipped } = parseFeed('999.999.999.999\n<html>\nnot-a-domain\n\n', 'junk');
    assert.equal(indicators.length, 0);
    assert.ok(skipped >= 3);
  });

  it('mixes types within one feed', () => {
    const { indicators } = parseFeed('203.0.113.1\n198.51.100.0/24\nbad.example', 'mixed');
    assert.deepEqual(
      indicators.map((i) => i.type),
      ['ipv4', 'cidr', 'domain'],
    );
  });
});

describe('direction grading', () => {
  it('recognises private addresses', () => {
    for (const local of ['10.1.2.3', '192.168.0.5', '172.20.1.1', '127.0.0.1', '169.254.5.5']) {
      assert.equal(isPrivateAddress(local), true, `${local} should be local`);
    }
    for (const remote of ['8.8.8.8', '203.0.113.1', '172.32.0.1']) {
      assert.equal(isPrivateAddress(remote), false, `${remote} should be remote`);
    }
  });

  it('recognises IPv6 loopback in either spelling', () => {
    // The v4 branch delegates to the loader's own predicate; the v6 branch used
    // to prefix-match a raw string, so these two spellings of one address
    // disagreed and a loopback conversation graded as remote.
    assert.equal(isPrivateAddress('::1'), true);
    assert.equal(isPrivateAddress('0:0:0:0:0:0:0:1'), true);
    assert.equal(isPrivateAddress('fe80::1'), true);
    assert.equal(isPrivateAddress('fd00::1'), true);
    assert.equal(isPrivateAddress('2001:db8::1'), false);
  });

  it('classifies the four directions', () => {
    assert.equal(directionOf('10.0.0.5', '203.0.113.1'), 'outbound');
    assert.equal(directionOf('203.0.113.1', '10.0.0.5'), 'inbound');
    assert.equal(directionOf('10.0.0.5', '10.0.0.6'), 'internal');
    assert.equal(directionOf('8.8.8.8', '203.0.113.1'), 'unknown');
  });

  it('grades an outbound match critical', () => {
    // Something inside chose to contact it: a compromised host, or software
    // nobody sanctioned.
    const graded = assess(
      { observed: '203.0.113.1', indicator: '203.0.113.1', type: 'ipv4', source: 'feodo', note: 'C2' },
      { localIp: '10.0.0.5', remoteIp: '203.0.113.1', direction: 'outbound', via: VIA },
    );
    assert.equal(graded.severity, 'critical');
    assert.equal(graded.messageKey, 'threat_intel.outbound');
  });

  it('grades an inbound match medium, not critical', () => {
    // The internet scans everything constantly and much of any blocklist is
    // scanners. Critical here would bury the operator and get the tool ignored.
    const graded = assess(
      { observed: '203.0.113.1', indicator: '203.0.113.1', type: 'ipv4', source: 'feodo', note: null },
      { localIp: '10.0.0.5', remoteIp: '203.0.113.1', direction: 'inbound', via: VIA },
    );
    assert.equal(graded.severity, 'medium');
  });

  it('grades a domain lookup critical whichever way the packet went', () => {
    const graded = assess(
      { observed: 'c2.bad.example', indicator: 'bad.example', type: 'domain', source: 'urlhaus', note: null },
      { localIp: '10.0.0.5', remoteIp: '10.0.0.1', direction: 'internal', via: VIA },
    );
    assert.equal(graded.severity, 'critical');
    assert.equal(graded.messageKey, 'threat_intel.domain');
  });

  it('gives the same pairing a stable dedup key, so repeats aggregate', () => {
    const match = {
      observed: '203.0.113.1',
      indicator: '203.0.113.1',
      type: 'ipv4' as const,
      source: 'feodo',
      note: null,
    };
    const context = {
      localIp: '10.0.0.5',
      remoteIp: '203.0.113.1',
      direction: 'outbound' as const,
      via: VIA,
    };
    // A beacon calling home every thirty seconds must be one alert with a rising
    // occurrence count, not thousands of rows.
    assert.equal(assess(match, context).dedupKey, assess(match, context).dedupKey);
  });

  it('separates different local hosts contacting the same indicator', () => {
    const match = {
      observed: '203.0.113.1',
      indicator: '203.0.113.1',
      type: 'ipv4' as const,
      source: 'feodo',
      note: null,
    };
    const a = assess(match, {
      localIp: '10.0.0.5',
      remoteIp: '203.0.113.1',
      direction: 'outbound',
      via: VIA,
    });
    const b = assess(match, {
      localIp: '10.0.0.9',
      remoteIp: '203.0.113.1',
      direction: 'outbound',
      via: VIA,
    });
    assert.notEqual(a.dedupKey, b.dedupKey, 'two compromised hosts are two findings');
  });
});

describe('registry', () => {
  it('reports disabled and matches nothing before any load', () => {
    assert.equal(registry.intel().indicators.size, 0);
    assert.equal(registry.intel().indicators.matchIp('203.0.113.1'), null);
  });

  it('exposes a status shape the UI can render', () => {
    const status = registry.intel().status();
    assert.equal(typeof status.enabled, 'boolean');
    assert.ok(Array.isArray(status.sources));
    assert.equal(typeof status.stats.total, 'number');
  });
});
