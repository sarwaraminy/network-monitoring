import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderFinding } from './catalog/findings.js';
import { DEFAULT_LOCALE, isRtl, resolveLocale } from './locales.js';
import { parseMessageParams } from './message.js';
import { createRenderer } from './render.js';

/**
 * The rendering layer, on its own.
 *
 * Most of what is asserted here is a *fallback*: a missing translation, a
 * parameter that is not the shape the pattern expects, a key that no longer
 * exists. All of them are reachable in an ordinary deployment — V16 made two
 * sensors on one database supported, so a row can be written by a version that
 * has moved on from the one reading it — and all of them are silent by design,
 * because one bad row must never cost the whole alert list. Silent and untested
 * is how a fallback stops working without anyone finding out.
 */

const FSI = '⁨';
const PDI = '⁩';

describe('choosing a locale', () => {
  it('takes an exact tag', () => {
    assert.equal(resolveLocale('fa-AF'), 'fa-AF');
    assert.equal(resolveLocale('de'), 'de');
  });

  it('ignores case and the underscore spelling', () => {
    assert.equal(resolveLocale('FA_af'), 'fa-AF');
  });

  it('strips a region we do not have a catalogue for', () => {
    // A Swiss German browser gets German, not English.
    assert.equal(resolveLocale('de-CH'), 'de');
    assert.equal(resolveLocale('en-GB'), 'en');
  });

  /*
   * Iranian Persian reaching the Dari catalogue is a deliberate choice rather than
   * an accident of the matching rule. It is not the same variety, but it is far
   * closer than English is, and this is the only Persian catalogue there is.
   */
  it('sends plain Persian to the Dari catalogue', () => {
    assert.equal(resolveLocale('fa'), 'fa-AF');
    assert.equal(resolveLocale('fa-IR'), 'fa-AF');
  });

  it('falls back to English for anything else, including nothing at all', () => {
    assert.equal(resolveLocale('ja'), DEFAULT_LOCALE);
    assert.equal(resolveLocale(''), DEFAULT_LOCALE);
    assert.equal(resolveLocale(null), DEFAULT_LOCALE);
  });

  it('knows which way each locale is written', () => {
    assert.equal(isRtl('fa-AF'), true);
    assert.equal(isRtl('de'), false);
  });
});

describe('rendering a message', () => {
  const renderer = createRenderer({
    en: {
      greeting: 'Seen at {where}',
      counted: '{n, plural, one {# host} other {# hosts}}',
      composed: 'via {how}',
      listed: 'because {reasons}',
      reason: 'reason {n}',
      broken: 'unclosed {',
      chosen: '{flag, select, true {on} other {off}} for {where}',
      both: '{flag, select, true {yes} other {no}}: {flag}',
    },
    de: { greeting: 'Gesehen bei {where}' },
    'fa-AF': {
      greeting: '{where} دیده شد در',
      chosen: '{flag, select, true {on} other {off}} for {where}',
      both: '{flag, select, true {yes} other {no}}: {flag}',
    },
  });

  it('uses the requested locale', () => {
    assert.equal(renderer.render({ key: 'greeting', params: { where: 'x' } }, 'de'), 'Gesehen bei x');
  });

  /*
   * The important half of the `Partial` catalogue decision: a translation lands key
   * by key, and the keys it has not reached must read as English sentences rather
   * than as raw keys. An operator reading one English line in a German interface
   * has lost consistency; one reading `arp_spoofing.sprawl.title` has lost the
   * finding.
   */
  it('falls back to English for a key a locale has not translated', () => {
    assert.equal(renderer.render({ key: 'counted', params: { n: 2 } }, 'de'), '2 hosts');
  });

  it('shows the key when no locale has the message at all', () => {
    assert.equal(renderer.render({ key: 'absent' }, 'en'), 'absent');
  });

  it('shows the key rather than throwing when the pattern is malformed', () => {
    assert.equal(renderer.render({ key: 'broken' }, 'en'), 'broken');
  });

  it('shows the key rather than throwing when a parameter is missing', () => {
    // The shape a row written by a different version of the detectors arrives in.
    assert.equal(renderer.render({ key: 'greeting' }, 'en'), 'greeting');
  });

  it('interpolates a nested reference', () => {
    const rendered = renderer.render(
      { key: 'composed', params: { how: { key: 'greeting', params: { where: 'here' } } } },
      'en',
    );
    assert.equal(rendered, 'via Seen at here');
  });

  /*
   * Joined by `Intl.ListFormat` rather than by a hardcoded comma, so the separator
   * and the final conjunction are the reader's rather than English's.
   */
  it('joins a list of references the way the locale joins lists', () => {
    const reasons = [1, 2, 3].map((n) => ({ key: 'reason', params: { n } }));
    assert.equal(
      renderer.render({ key: 'listed', params: { reasons } }, 'en'),
      // The serial comma is CLDR's answer for `en`, not a choice made here — which
      // is the point: the old code joined with a bare ', ' and no conjunction at
      // all, in every language.
      'because reason 1, reason 2, and reason 3',
    );
  });

  /*
   * The bidi rule, and the reason it is applied centrally rather than remembered
   * at each interpolation site. Without the isolates an address inside a
   * right-to-left sentence is reordered against the paragraph direction, and the
   * operator reads an address that is not the one in the finding.
   */
  it('isolates interpolated strings in a right-to-left locale', () => {
    const rendered = renderer.render({ key: 'greeting', params: { where: '192.168.1.10' } }, 'fa-AF');
    assert.ok(rendered.includes(`${FSI}192.168.1.10${PDI}`), rendered);
  });

  it('leaves left-to-right locales unmarked', () => {
    const rendered = renderer.render({ key: 'greeting', params: { where: '192.168.1.10' } }, 'en');
    assert.equal(rendered, 'Seen at 192.168.1.10');
  });

  /*
   * The isolation and `select` collided, and only in RTL. ICU matches a select
   * operand against the option names, so `⁨true⁩` matches nothing and the pattern
   * falls to `other` — an enabled suppression rule announcing itself as "Enable
   * rule N" in Dari and nowhere else, which is exactly the kind of defect a
   * reader of that language cannot check against the English.
   *
   * Asserted for a string operand specifically. A boolean was never isolated and
   * so never broke; the point of the fix is that the call site no longer has to
   * know which it passed.
   */
  it('does not isolate a value the pattern only compares', () => {
    assert.equal(
      renderer.render({ key: 'chosen', params: { flag: 'true', where: 'x' } }, 'fa-AF'),
      `on for ${FSI}x${PDI}`,
    );
    assert.equal(
      renderer.render({ key: 'chosen', params: { flag: true, where: 'x' } }, 'fa-AF'),
      `on for ${FSI}x${PDI}`,
    );
  });

  it('still isolates a value that is compared and then displayed', () => {
    // The display is the use that needs the isolation, so it wins — and the
    // comparison has to be written against the isolated form, which is why a
    // pattern like this is worth failing loudly rather than half-fixing.
    const rendered = renderer.render({ key: 'both', params: { flag: 'true' } }, 'fa-AF');
    assert.ok(rendered.includes(`${FSI}true${PDI}`), rendered);
  });
});

describe('reading params back out of jsonb', () => {
  it('keeps the values a pattern can use', () => {
    assert.deepEqual(parseMessageParams({ a: 'x', b: 2, c: true, d: null }), {
      a: 'x',
      b: 2,
      c: true,
      d: null,
    });
  });

  it('drops what ICU would render as nonsense', () => {
    // "∞ ports" is worse than the parameter going missing, and a missing one is
    // already handled: the render falls back to the key.
    assert.deepEqual(parseMessageParams({ a: Number.POSITIVE_INFINITY, b: Number.NaN }), {});
  });

  it('drops a value that is not a shape the renderer has a rule for', () => {
    assert.deepEqual(parseMessageParams({ a: { notAKey: 1 }, b: [1, 2] }), {});
  });

  it('keeps nested references and arrays of them', () => {
    assert.deepEqual(parseMessageParams({ via: { key: 'k', params: { n: 1 } }, reasons: [{ key: 'r' }] }), {
      via: { key: 'k', params: { n: 1 } },
      reasons: [{ key: 'r' }],
    });
  });

  it('treats anything that is not an object as no params at all', () => {
    assert.deepEqual(parseMessageParams(null), {});
    assert.deepEqual(parseMessageParams('nope'), {});
    assert.deepEqual(parseMessageParams([1, 2]), {});
  });
});

describe('a finding renders as a title and a description', () => {
  /*
   * The pairing that `message_key` names. Asserted on a real catalogue entry rather
   * than a fixture, because the derivation — key plus `.title` / `.description` —
   * is the contract between the detectors and every display.
   */
  it('derives both halves from the one key', () => {
    const rendered = renderFinding(
      'host_sweep.packet',
      {
        source: '10.0.0.66',
        port: '445',
        count: 30,
        seconds: 60,
        service: 'SMB file sharing',
        hasService: true,
      },
      'en',
    );
    assert.equal(rendered.title, 'Host sweep: 10.0.0.66 probed port 445 on 30 hosts');
    assert.match(rendered.description, /SMB file sharing/);
  });

  /*
   * A port is an identifier, so it interpolates as a string and must survive
   * verbatim. As a number ICU would format it through `Intl.NumberFormat` — ۴۴۵ in
   * Dari, and `1,433` for Microsoft SQL Server in English — and stop matching what
   * the switch, the firewall and `tcpdump` print.
   */
  it('leaves an identifier alone in a locale that shapes digits', () => {
    const rendered = renderFinding(
      'host_sweep.packet',
      { source: '10.0.0.66', port: '445', count: 30, seconds: 60, service: null, hasService: false },
      'fa-AF',
    );
    assert.ok(rendered.title.includes('445'), rendered.title);
  });

  it('omits the optional clause when the detector says the value is absent', () => {
    const withIp = renderFinding(
      'new_device.discovered',
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.4', hasIp: true, vendorPrefix: 'aa:bb:cc' },
      'en',
    );
    const withoutIp = renderFinding(
      'new_device.discovered',
      { mac: 'aa:bb:cc:dd:ee:ff', ip: null, hasIp: false, vendorPrefix: 'aa:bb:cc' },
      'en',
    );
    assert.equal(withIp.title, 'New device on the network: aa:bb:cc:dd:ee:ff (10.0.0.4)');
    assert.equal(withoutIp.title, 'New device on the network: aa:bb:cc:dd:ee:ff');
    assert.match(withIp.description, /currently using 10\.0\.0\.4/);
    assert.doesNotMatch(withoutIp.description, /currently using/);
  });
});
