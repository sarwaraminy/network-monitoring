import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Feed loading, the detector, and the flow path.
 *
 * These are the parts the first round of tests left uncovered — and both
 * `loadFeeds(…, fetchImpl)` and `new ThreatIntelDetector(indicators)` carry
 * injection seams that were built for tests nobody wrote. One detector test would
 * have caught the missing DNS length guard, which threw `RangeError` out of
 * `readFirstQuestion` on a short payload and abandoned the whole packet
 * mid-inspection, so a listed *address* on it was missed too.
 */

let feeds: typeof import('./feeds.js');
let match: typeof import('./match.js');
let ThreatIntel: typeof import('../packet/detect/threat-intel.js');
let frames: typeof import('../packet/detect/test-frames.js');
let decode: typeof import('../packet/decode.js');

const dirs: string[] = [];
const workDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'intel-feeds-'));
  dirs.push(dir);
  return dir;
};

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  feeds = await import('./feeds.js');
  match = await import('./match.js');
  ThreatIntel = await import('../packet/detect/threat-intel.js');
  frames = await import('../packet/detect/test-frames.js');
  decode = await import('../packet/decode.js');
});

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const AT = new Date('2026-08-26T12:00:00Z');
const textResponse = (body: string) => new Response(body, { status: 200 });

describe('feed configuration', () => {
  it('parses name=location pairs', () => {
    const sources = feeds.parseFeedConfig('a=https://x.test/a.txt, b=/etc/nmt/b.txt');
    assert.deepEqual(sources, [
      { name: 'a', location: 'https://x.test/a.txt' },
      { name: 'b', location: '/etc/nmt/b.txt' },
    ]);
  });

  it('derives a name from a bare location', () => {
    const [source] = feeds.parseFeedConfig('https://feodotracker.abuse.ch/downloads/ipblocklist.txt');
    assert.equal(source?.name, 'feodotracker.abuse.ch');
  });

  it('ignores blanks and malformed entries', () => {
    assert.deepEqual(feeds.parseFeedConfig(''), []);
    assert.deepEqual(feeds.parseFeedConfig('  , ,  '), []);
    assert.deepEqual(feeds.parseFeedConfig('name='), []);
  });
});

describe('loading feeds', () => {
  it('reads a local file', async () => {
    const dir = workDir();
    const path = join(dir, 'local.txt');
    writeFileSync(path, '# comment\n203.0.113.5\nbad.example\n', 'utf8');

    const result = await feeds.loadFeeds([{ name: 'local', location: path }], join(dir, 'cache'));
    assert.equal(result.sources[0]?.from, 'file');
    assert.equal(result.sources[0]?.indicators, 2);
    assert.ok(result.set.matchIp('203.0.113.5'));
  });

  it('reports a missing file as failed without throwing', async () => {
    const dir = workDir();
    const result = await feeds.loadFeeds([{ name: 'gone', location: join(dir, 'nope.txt') }], dir);
    assert.equal(result.sources[0]?.from, 'failed');
    assert.match(result.sources[0]?.error ?? '', /no such file/);
    assert.equal(result.set.size, 0);
  });

  it('keeps loading the other sources when one fails', async () => {
    // Losing one feed degrades coverage; it must not remove detection entirely.
    const dir = workDir();
    const good = join(dir, 'good.txt');
    writeFileSync(good, '203.0.113.9\n', 'utf8');

    const result = await feeds.loadFeeds(
      [
        { name: 'broken', location: join(dir, 'missing.txt') },
        { name: 'good', location: good },
      ],
      join(dir, 'cache'),
    );

    assert.equal(result.sources[0]?.from, 'failed');
    assert.equal(result.sources[1]?.from, 'file');
    assert.ok(result.set.matchIp('203.0.113.9'));
  });

  it('caches a downloaded feed and falls back to it when the fetch fails', async () => {
    const dir = workDir();
    const cache = join(dir, 'cache');
    const source = [{ name: 'remote', location: 'https://feed.test/list.txt' }];

    const first = await feeds.loadFeeds(source, cache, async () => textResponse('203.0.113.77\n'));
    assert.equal(first.sources[0]?.from, 'network');

    // The monitoring host in these networks frequently has no outbound internet,
    // so a failed fetch is the expected case, not an exceptional one.
    const second = await feeds.loadFeeds(source, cache, async () => {
      throw new Error('ENETUNREACH');
    });
    assert.equal(second.sources[0]?.from, 'cache');
    assert.ok(second.set.matchIp('203.0.113.77'), 'the cached indicators must still load');
  });

  it('treats a non-200 as a failure and falls back', async () => {
    const dir = workDir();
    const cache = join(dir, 'cache');
    const source = [{ name: 'remote', location: 'https://feed.test/list.txt' }];

    await feeds.loadFeeds(source, cache, async () => textResponse('203.0.113.5\n'));
    const result = await feeds.loadFeeds(source, cache, async () => new Response('nope', { status: 503 }));
    assert.equal(result.sources[0]?.from, 'cache');
  });

  it('gives two feeds from one host separate cache files', async () => {
    // `deriveName` returns the hostname, so two unnamed abuse.ch lists used to
    // slug identically and share one file — the second download clobbering the
    // first, and a later offline start loading the same body twice while status
    // showed two healthy rows. Coverage silently halved.
    const dir = workDir();
    const cache = join(dir, 'cache');

    await feeds.loadFeeds(
      [
        { name: 'abuse.ch', location: 'https://abuse.ch/one.txt' },
        { name: 'abuse.ch', location: 'https://abuse.ch/two.txt' },
      ],
      cache,
      async (url) => textResponse(String(url).endsWith('one.txt') ? '203.0.113.1\n' : '203.0.113.2\n'),
    );

    const files = readdirSync(cache).filter((name) => name.endsWith('.txt'));
    assert.equal(files.length, 2, `expected two cache files, got ${files.join(', ')}`);

    // And both bodies survive: offline, each source loads its own indicators.
    const offline = await feeds.loadFeeds(
      [
        { name: 'abuse.ch', location: 'https://abuse.ch/one.txt' },
        { name: 'abuse.ch', location: 'https://abuse.ch/two.txt' },
      ],
      cache,
      async () => {
        throw new Error('offline');
      },
    );
    assert.ok(offline.set.matchIp('203.0.113.1'));
    assert.ok(offline.set.matchIp('203.0.113.2'));
  });

  it('refuses a body past the size cap while reading it', async () => {
    // The cap used to be checked after `response.text()` had already buffered
    // everything, and `content-length` is absent on a chunked response.
    const dir = workDir();
    const huge = 'x'.repeat(1024);
    const chunks = 40 * 1024; // ~40MB, over the 32MB ceiling

    const streaming = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            for (let index = 0; index < chunks; index += 1) controller.enqueue(encoder.encode(huge));
            controller.close();
          },
        }),
        { status: 200 },
      );

    const result = await feeds.loadFeeds(
      [{ name: 'huge', location: 'https://feed.test/huge.txt' }],
      join(dir, 'cache'),
      async () => streaming(),
    );

    assert.equal(result.sources[0]?.from, 'failed');
    assert.match(result.sources[0]?.error ?? '', /exceeded/);
  });
});

describe('ThreatIntelDetector', () => {
  const withIndicators = (...entries: Array<[string, 'ipv4' | 'cidr' | 'domain']>) => {
    const set = new match.IndicatorSet();
    for (const [value, type] of entries) set.add({ value, type, source: 'test' });
    set.seal();
    return new ThreatIntel.ThreatIntelDetector(() => set);
  };

  const inspect = (detector: ReturnType<typeof withIndicators>, frame: Buffer) =>
    detector.inspect(decode.decodePacket(frame, AT, 'ETHERNET'));

  it('does nothing when no indicators are loaded', () => {
    const detector = new ThreatIntel.ThreatIntelDetector(() => new match.IndicatorSet());
    const frame = frames.buildTcp({ srcIp: '10.0.0.5', dstIp: '203.0.113.5', dstPort: 443 });
    assert.deepEqual(inspect(detector, frame), []);
  });

  it('raises a critical finding for an outbound connection to a listed address', () => {
    const detector = withIndicators(['203.0.113.5', 'ipv4']);
    const [finding] = inspect(
      detector,
      frames.buildTcp({ srcIp: '10.0.0.5', dstIp: '203.0.113.5', dstPort: 443 }),
    );

    assert.equal(finding?.severity, 'critical');
    assert.equal(finding?.kind, 'threat_intel');
    assert.equal(finding?.evidence.direction, 'outbound');
    assert.equal(finding?.evidence.destinationPort, 443);
  });

  it('grades inbound from a listed address as medium', () => {
    const detector = withIndicators(['203.0.113.5', 'ipv4']);
    const [finding] = inspect(
      detector,
      frames.buildTcp({ srcIp: '203.0.113.5', dstIp: '10.0.0.5', dstPort: 22 }),
    );
    assert.equal(finding?.severity, 'medium');
  });

  it('matches a DNS question against a listed parent domain', () => {
    const detector = withIndicators(['bad.example', 'domain']);
    const [finding] = inspect(
      detector,
      frames.buildDns({ srcIp: '10.0.0.5', dstIp: '10.0.0.1', queryName: 'c2.bad.example' }),
    );

    assert.equal(finding?.severity, 'critical');
    assert.equal(finding?.evidence.indicator, 'bad.example');
    assert.equal(finding?.evidence.queriedName, 'c2.bad.example');
  });

  it('survives a DNS packet too short to hold a question', () => {
    // The guard that made this safe lived in DnsTunnelingDetector.inspect() and
    // did not travel with readFirstQuestion when it was exported. A 3-byte
    // payload threw RangeError, and because inspect() aborts on the throw a
    // listed address on the same packet was missed as well.
    const detector = withIndicators(['203.0.113.5', 'ipv4']);
    const frame = frames.buildUdp({
      srcIp: '10.0.0.5',
      dstIp: '203.0.113.5',
      srcPort: 51234,
      dstPort: 53,
      payload: Buffer.from([0x12, 0x34, 0x00]),
    });

    let findings: ReturnType<typeof detector.inspect> = [];
    assert.doesNotThrow(() => {
      findings = inspect(detector, frame);
    });
    // And the address match still happens, rather than being lost to the throw.
    assert.equal(findings[0]?.evidence.indicator, '203.0.113.5');
  });

  it('says nothing about ordinary traffic', () => {
    const detector = withIndicators(['203.0.113.5', 'ipv4'], ['bad.example', 'domain']);
    assert.deepEqual(
      inspect(detector, frames.buildTcp({ srcIp: '10.0.0.5', dstIp: '142.250.187.206', dstPort: 443 })),
      [],
    );
    assert.deepEqual(
      inspect(
        detector,
        frames.buildDns({ srcIp: '10.0.0.5', dstIp: '10.0.0.1', queryName: 'www.google.com' }),
      ),
      [],
    );
  });

  it('throttles repeats of the same pairing', () => {
    const detector = withIndicators(['203.0.113.5', 'ipv4']);
    const frame = frames.buildTcp({ srcIp: '10.0.0.5', dstIp: '203.0.113.5', dstPort: 443 });

    assert.equal(inspect(detector, frame).length, 1);
    // A beacon calling home is one alert with a rising count, not thousands.
    assert.equal(inspect(detector, frame).length, 0);
  });
});
