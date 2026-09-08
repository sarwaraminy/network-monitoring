import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import IntlMessageFormat from 'intl-messageformat';
import { LOCALES } from '../locales.js';
import { ERRORS_EN } from './errors.en.js';
import { ERROR_CATALOGS } from './errors.js';
import { FINDINGS_EN } from './findings.en.js';
import { FINDING_CATALOGS } from './findings.js';

/**
 * Standing checks on the catalogue itself.
 *
 * Every failure mode here is silent at runtime by design — the renderer swallows a
 * malformed pattern and returns the key, because one bad entry must not cost the
 * whole alert list. That is the right behaviour in production and the wrong one in
 * development, where a typo would otherwise ship and only be noticed by whoever
 * reads the interface in the language nobody on the team speaks.
 */

const ENGLISH_KEYS = Object.keys(FINDINGS_EN);

describe('every pattern is valid ICU', () => {
  for (const locale of LOCALES) {
    it(`parses in ${locale}`, () => {
      const broken: string[] = [];
      for (const [key, pattern] of Object.entries(FINDING_CATALOGS[locale])) {
        if (pattern === undefined) continue;
        try {
          new IntlMessageFormat(pattern, locale);
        } catch (error) {
          broken.push(`${key}: ${(error as Error).message}`);
        }
      }
      assert.deepEqual(broken, [], `unparseable patterns in ${locale}`);
    });
  }
});

describe('the catalogue is shaped the way the renderer assumes', () => {
  /*
   * `message_key` names a pair, and `renderFinding` derives both halves from it.
   * A `.title` whose `.description` was never written renders the row with its own
   * key as the body text — visible, but only to whoever opens that one finding.
   */
  it('pairs every title with a description', () => {
    const unpaired: string[] = [];
    for (const key of ENGLISH_KEYS) {
      if (key.endsWith('.title') && !(`${key.slice(0, -6)}.description` in FINDINGS_EN)) {
        unpaired.push(key);
      }
      if (key.endsWith('.description') && !(`${key.slice(0, -12)}.title` in FINDINGS_EN)) {
        unpaired.push(key);
      }
    }
    assert.deepEqual(unpaired, []);
  });

  /*
   * Fragments — the DNS reasons, the threat-intel `via` and attribution clauses —
   * are interpolated into a sentence rather than being one, so they are the only
   * entries allowed to stand alone.
   */
  it('allows only known fragments to stand outside a pair', () => {
    const fragments = ENGLISH_KEYS.filter((key) => !key.endsWith('.title') && !key.endsWith('.description'));
    assert.deepEqual(fragments.sort(), [
      'dns_tunneling.reason.encoded',
      'dns_tunneling.reason.length',
      'dns_tunneling.reason.subdomains',
      'threat_intel.attribution',
      'threat_intel.via.dns_query',
      'threat_intel.via.flow_export',
      'threat_intel.via.packet_capture',
    ]);
  });
});

describe('every locale is complete', () => {
  /*
   * The other half of the `Partial` decision.
   *
   * The type lets a translation land key by key so that work in progress compiles,
   * and the renderer falls back to English per key so that a gap is readable rather
   * than broken. Neither of those should let an incomplete language *ship*, and a
   * missing key is otherwise invisible: it renders a correct English sentence in
   * the middle of a translated page, which looks like a wording choice.
   *
   * Reported as the list of keys still to translate — the thing a translator
   * actually needs — rather than as a count.
   */
  for (const locale of LOCALES) {
    it(`translates every key into ${locale}`, () => {
      const catalog = FINDING_CATALOGS[locale];
      const missing = ENGLISH_KEYS.filter((key) => catalog[key as keyof typeof catalog] === undefined);
      assert.deepEqual(missing, [], `untranslated in ${locale}`);
    });
  }
});

describe('the error catalogue', () => {
  const ERROR_KEYS = Object.keys(ERRORS_EN);

  for (const locale of LOCALES) {
    it(`parses in ${locale}`, () => {
      const broken: string[] = [];
      for (const [key, pattern] of Object.entries(ERROR_CATALOGS[locale])) {
        if (pattern === undefined) continue;
        try {
          new IntlMessageFormat(pattern, locale);
        } catch (error) {
          broken.push(`${key}: ${(error as Error).message}`);
        }
      }
      assert.deepEqual(broken, [], `unparseable patterns in ${locale}`);
    });

    it(`translates every key into ${locale}`, () => {
      const catalog = ERROR_CATALOGS[locale];
      const missing = ERROR_KEYS.filter((key) => catalog[key as keyof typeof catalog] === undefined);
      assert.deepEqual(missing, [], `untranslated in ${locale}`);
    });
  }

  /*
   * The two catalogues are separate and must stay separate: a finding's text is
   * persisted and re-rendered months later, an error's is rendered once. A key in
   * both would be one somebody could move between them without noticing.
   */
  it('shares no key with the finding catalogue', () => {
    const findingKeys = new Set(Object.keys(FINDING_CATALOGS.en));
    assert.deepEqual(
      ERROR_KEYS.filter((key) => findingKeys.has(key)),
      [],
    );
  });
});
