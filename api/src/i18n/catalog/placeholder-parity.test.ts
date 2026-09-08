import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IntlMessageFormat } from 'intl-messageformat';
import { LOCALES } from '../locales.js';
import { ERROR_CATALOGS } from './errors.js';
import { FINDING_CATALOGS } from './findings.js';
import { NOTIFY_CATALOGS } from './notify.js';

/**
 * Every translation must interpolate exactly what its English pattern does.
 *
 * Nothing else in the suite checks this, and the failure it prevents is the
 * worst-behaved kind: `intl-messageformat` throws `MissingValueError` when a
 * pattern names an argument the caller did not pass, the renderer catches that
 * and falls back to the key — so a single extra `{ip}` in one German string
 * shows `arp_spoofing.claim.title` to German readers and nothing at all to
 * anyone else. It is invisible to `tsc`, invisible to every existing test, and
 * invisible in review unless somebody diffs two languages of prose side by side.
 *
 * The other direction is checked too, and is a real defect rather than a
 * tidiness rule: a translation that drops `{count}` renders a sentence with the
 * number missing, which for "3 findings" reads as a claim about no findings.
 *
 * Argument names are read from the ICU AST rather than matched in the text.
 * A first attempt used a regex and reported four false positives immediately:
 * `{was}` and `{were}` inside `one {was} other {were}` are plural BRANCH BODIES,
 * not arguments, and no amount of care with the pattern distinguishes those from
 * a real `{domain}` without actually parsing. `getAst()` already knows.
 */

/**
 * The shape this walk needs from an ICU node, and no more.
 *
 * Structural rather than `any`: the parser's own types are not exported through
 * `intl-messageformat`, and the three fields below are the whole of what
 * identifies an argument. Written out so a change in the AST is a compile error
 * here rather than a silently empty result.
 */
interface IcuNode {
  type: number;
  value?: unknown;
  options?: Record<string, { value?: unknown }>;
  children?: unknown;
}

/** Argument names a pattern interpolates, from the parsed message. */
function placeholdersOf(pattern: string, locale: string): Set<string> {
  const names = new Set<string>();

  const walk = (nodes: readonly IcuNode[]): void => {
    for (const node of nodes) {
      // Type 0 is literal text and type 7 is the `#` inside a plural; every
      // other type that carries a string `value` names an argument.
      if (typeof node.value === 'string' && node.type !== 0 && node.type !== 7) {
        names.add(node.value);
      }
      if (node.options) {
        for (const option of Object.values(node.options)) {
          if (Array.isArray(option.value)) walk(option.value as IcuNode[]);
        }
      }
      if (Array.isArray(node.children)) walk(node.children as IcuNode[]);
    }
  };

  walk(new IntlMessageFormat(pattern, locale).getAst() as unknown as IcuNode[]);
  return names;
}

const CATALOGUES = [
  ['findings', FINDING_CATALOGS],
  ['errors', ERROR_CATALOGS],
  ['notify', NOTIFY_CATALOGS],
] as const;

describe('placeholder parity across locales', () => {
  for (const [name, catalogs] of CATALOGUES) {
    it(`keeps every ${name} translation interpolating what English does`, () => {
      const english = catalogs.en as Record<string, string>;
      const mismatches: string[] = [];

      for (const locale of LOCALES) {
        if (locale === 'en') continue;
        const translated = catalogs[locale] as Record<string, string>;

        for (const [key, pattern] of Object.entries(translated)) {
          const source = english[key];
          // A key absent from English is the orphan check's business, not this
          // one; reporting it here would give the same defect two failures.
          if (source === undefined) continue;

          const expected = placeholdersOf(source, 'en');
          const actual = placeholdersOf(pattern, locale);

          const missing = [...expected].filter((argument) => !actual.has(argument));
          const extra = [...actual].filter((argument) => !expected.has(argument));

          if (missing.length > 0 || extra.length > 0) {
            mismatches.push(
              `${locale} ${key}: ${missing.length > 0 ? `missing ${missing.join(', ')}` : ''}` +
                `${missing.length > 0 && extra.length > 0 ? '; ' : ''}` +
                `${extra.length > 0 ? `unknown ${extra.join(', ')}` : ''}`,
            );
          }
        }
      }

      assert.deepEqual(
        mismatches,
        [],
        'a translation interpolates something its English pattern does not, or drops one it does. ' +
          'An unknown argument renders the raw key for that locale alone; a missing one renders a ' +
          'sentence with the value left out.',
      );
    });
  }
});
