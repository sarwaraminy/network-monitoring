import { describe, expect, it } from 'vitest';

/**
 * Nothing may put a rendered translation into component state.
 *
 * Reported from the running application: switching from Dari to German left Dari
 * words on screen. The cause was `setMessage({ text: t('…') })` — correct exactly
 * once, because the string is fixed at the moment of the action and the reader can
 * change language afterwards. Twenty-one call sites did it, across banners,
 * toasts, sign-in errors and the capture toolbar.
 *
 * Every other guard was green while that shipped: the catalogues are complete,
 * parity holds, and the memos name `t` in their dependencies. The defect is not in
 * the catalogue or in the rendering, it is in *when* the rendering happens, and
 * this is the shape that reads it.
 *
 * LanguageToggle.test.tsx drives the behaviour through a real page. This is the
 * cheaper net beside it: the behavioural test proves the mechanism on one banner,
 * this one says no twenty-second call site has quietly appeared.
 */

/** A call to a `setSomething(...)` state setter, with its argument text. */
interface Assignment {
  readonly where: string;
  readonly setter: string;
  readonly argument: string;
}

/** Every state assignment in a file, with balanced parentheses. */
function assignments(path: string, source: string): Assignment[] {
  const found: Assignment[] = [];

  for (const match of source.matchAll(/\bset[A-Z]\w*\(/g)) {
    const open = match.index + match[0].length;
    let depth = 1;
    let i = open;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    const line = source.slice(0, match.index).split('\n').length;
    found.push({
      where: `${path}:${line}`,
      setter: match[0].slice(0, -1),
      argument: source.slice(open, i - 1),
    });
  }

  return found;
}

describe('messages held in component state', () => {
  it('are keys rather than rendered text', () => {
    const sources = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    /*
     * `t(` preceded by a word character or a dot is somebody else's call —
     * `format(`, `fmt.t(` — rather than the translate hook.
     */
    const renders = /(?<![\w.])t\(|\bdescribeError\(/;

    const offenders = Object.entries(sources)
      /*
       * `startsWith('../')` is what excludes `src/i18n` itself, not the `/i18n/`
       * that would read more naturally: Vite names a sibling of this file
       * `./message-state.ts`, so matching on the directory name would leave the
       * catalogues and this module's own documentation in the scan.
       */
      .filter(([path]) => path.startsWith('../') && !path.includes('.test.'))
      .flatMap(([path, source]) => assignments(path, source))
      .filter((assignment) => renders.test(assignment.argument))
      .map((assignment) => `${assignment.where}  ${assignment.setter}(…) stores a rendered translation`);

    // Reported as the list rather than as a count: the fix is per call site, and
    // the file and line are the whole of what someone needs to make it.
    expect(offenders).toEqual([]);
  });
});
