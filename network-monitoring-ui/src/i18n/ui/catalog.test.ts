import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../generated/locales';
import { UI_DE } from './de';
import { UI_EN, type UiMessageKey } from './en';
import { UI_FA_AF } from './fa-AF';

/**
 * Standing checks on the interface catalogue.
 *
 * The same three the server-side catalogues get, for the same reason: every
 * failure here is silent at runtime by design — the renderer swallows a malformed
 * pattern and returns the key — which is right in production and wrong in
 * development, where a typo would otherwise only be found by whoever reads the
 * interface in the language nobody on the team speaks.
 */

const CATALOGS = { en: UI_EN, de: UI_DE, 'fa-AF': UI_FA_AF } as const;
const KEYS = Object.keys(UI_EN) as UiMessageKey[];

describe('the interface catalogue', () => {
  for (const locale of LOCALES) {
    it(`parses in ${locale}`, () => {
      const broken: string[] = [];
      for (const [key, pattern] of Object.entries(CATALOGS[locale])) {
        if (typeof pattern !== 'string') continue;
        try {
          new IntlMessageFormat(pattern, locale);
        } catch (error) {
          broken.push(`${key}: ${(error as Error).message}`);
        }
      }
      expect(broken).toEqual([]);
    });

    /*
     * A missing key is invisible: it renders a correct English string in the
     * middle of a translated page, which reads as a wording choice rather than as
     * a gap. Reported as the list still to translate, which is what a translator
     * needs.
     */
    it(`translates every key into ${locale}`, () => {
      const catalog = CATALOGS[locale] as Partial<Record<UiMessageKey, string>>;
      expect(KEYS.filter((key) => catalog[key] === undefined)).toEqual([]);
    });
  }

  /*
   * A key nothing renders is a string somebody translated three times for
   * nothing, and — worse — one that goes on being translated every time the
   * catalogue is revised. Cheap to check while the catalogue is small enough that
   * the answer is still "none".
   */
  it('has no key the application never asks for', async () => {
    const sources = import.meta.glob('../../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    /*
     * Excluded by SHAPE, not by substring, and that is the whole of this test.
     *
     * Vite names a glob key by the shortest relative path from the importing
     * module, so the catalogues sitting beside this file are `./en.ts` — which
     * does not contain `/i18n/ui/`. The old filter therefore kept them, `used`
     * included the catalogues themselves, and every key was "found" by the very
     * line that defines it. The check could not fail, and reported success while
     * dozens of keys went unreferenced.
     *
     * Anything in this directory is a sibling of the catalogue rather than a
     * caller, so the rule is "the path has to climb out".
     */
    const used = Object.entries(sources)
      .filter(([path]) => path.startsWith('../') && !path.includes('/i18n/ui/'))
      .map(([, source]) => source)
      .join('\n');

    /*
     * Keys composed at runtime count as used.
     *
     * `evidence.*` is built as `evidence.${field}`, so no literal
     * `'evidence.flowBytes'` exists anywhere and a naive check calls every one of
     * them dead. Collecting the template prefixes keeps this honest in both
     * directions: a key nothing composes and nothing names still fails.
     */
    const dynamicPrefixes = [...used.matchAll(/`([A-Za-z][\w.]*)\.\$\{/g)].map((match) => `${match[1]}.`);

    const orphans = KEYS.filter(
      (key) => !used.includes(`'${key}'`) && !dynamicPrefixes.some((prefix) => key.startsWith(prefix)),
    );

    expect(orphans).toEqual([]);
  });
});
