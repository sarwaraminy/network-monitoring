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

    const used = Object.entries(sources)
      .filter(([path]) => !path.includes('/i18n/ui/'))
      .map(([, source]) => source)
      .join('\n');

    expect(KEYS.filter((key) => !used.includes(`'${key}'`))).toEqual([]);
  });
});
