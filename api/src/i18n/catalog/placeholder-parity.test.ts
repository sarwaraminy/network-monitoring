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

/**
 * Argument names with the node types they appear as.
 *
 * A `Set` per name rather than one type, because a pattern may legitimately use
 * the same argument twice in different roles — `{flag, select, …}: {flag}`.
 * Divergence is then a difference of sets, not of a single value.
 */
function argumentTypesOf(pattern: string, locale: string): Map<string, Set<number>> {
  const types = new Map<string, Set<number>>();

  const walk = (nodes: readonly IcuNode[]): void => {
    for (const node of nodes) {
      if (typeof node.value === 'string' && node.type !== 0 && node.type !== 7) {
        const seen = types.get(node.value) ?? new Set<number>();
        seen.add(node.type);
        types.set(node.value, seen);
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
  return types;
}

/** ICU node types, by the name the pattern spells them with. */
const TYPE_NAMES: Readonly<Record<number, string>> = {
  1: 'plain',
  2: 'number',
  3: 'date',
  4: 'time',
  5: 'select',
  6: 'plural',
  8: 'tag',
};

const describeTypes = (types: Set<number>): string =>
  [...types]
    .map((type) => TYPE_NAMES[type] ?? `type ${type}`)
    .sort()
    .join('+');

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

    /*
     * The same check one level down, on what each argument is used *as*.
     *
     * Names matching is not enough. A translation that turns a plain `{count}`
     * into `{count, plural, …}` interpolates exactly the same argument, so the
     * check above stays green — but the call site passes a pre-formatted string,
     * ICU cannot select a plural branch on it, and that locale alone renders the
     * raw key. The mirror case is worse and quieter: `{port}` becoming `{port,
     * number}` turns an identifier into a quantity, and `445` is displayed as
     * `۴۴۵` in Dari, which no longer matches what the switch prints.
     *
     * Neither is visible to `tsc`, to the names check, or to a reader who does
     * not have the two languages open side by side.
     */
    it(`keeps every ${name} translation using its arguments the same way`, () => {
      const english = catalogs.en as Record<string, string>;
      const divergent: string[] = [];

      for (const locale of LOCALES) {
        if (locale === 'en') continue;
        const translated = catalogs[locale] as Record<string, string>;

        for (const [key, pattern] of Object.entries(translated)) {
          const source = english[key];
          if (source === undefined) continue;

          const expected = argumentTypesOf(source, 'en');
          const actual = argumentTypesOf(pattern, locale);

          for (const [argument, types] of expected) {
            const found = actual.get(argument);
            // A name the translation does not use at all is the check above's
            // business; reporting it here would give one defect two failures.
            if (!found) continue;
            const same = found.size === types.size && [...types].every((type) => found.has(type));
            if (!same) {
              divergent.push(
                `${locale} ${key}: {${argument}} is ${describeTypes(types)} in English, ` +
                  `${describeTypes(found)} here`,
              );
            }
          }
        }
      }

      assert.deepEqual(
        divergent,
        [],
        'a translation uses an argument as a different kind of placeholder than English does. ' +
          'The call site passes one type, so the diverging locale either renders the raw key or ' +
          'formats an identifier as a number.',
      );
    });
  }
});
