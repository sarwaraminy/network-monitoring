import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * One query, one set of settings.
 *
 * `runAdhocQuery` takes a snapshot — `const settings = currentAdhocSettings()` —
 * because the statement timeout, the row cap and the FETCH size have to describe
 * the same query. A save landing between two of those reads sets a timeout from
 * the old settings and a cap from the new one, and the truncation message then
 * names a number that was never applied: a lowered cap reports a cut-off result
 * as complete, a raised one slices 1001 rows to 10.
 *
 * This is a SOURCE-LEVEL check, and that is deliberate.
 *
 * The defect was reported three times. The first two rounds rewrote the comment
 * at the snapshot to describe the guarantee more carefully while `declareAndFetch`
 * and `translate` went on calling `currentAdhocSettings()` again — so the
 * snapshot was taken and never used, and each round made the comment more
 * confident about something the code did not do.
 *
 * A runtime test cannot pin this down honestly: the window is between the
 * snapshot and the DECLARE, so hitting it means racing a settings save against a
 * pool acquisition. A test that passes because the timing happened to work is
 * worth less than no test, and this repository already has the scar of a suite
 * that was green because nothing ran.
 *
 * What is deterministic is the invariant itself: **nothing downstream of the
 * snapshot may read the settings again.** That is what recurred, so that is what
 * is asserted. The end-to-end behaviour of the cap is covered by
 * `adhoc-sql.test.ts` ("reports a truncated result as truncated").
 *
 * No database and no imports from the module under test, so this cannot skip.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'adhoc.service.ts'), 'utf8');

/** The functions that run inside one query and must use the caller's snapshot. */
const DOWNSTREAM = ['declareAndFetch', 'declareAndFetchStrict', 'translate'];

/**
 * The body of a top-level `function` / `async function` declaration.
 *
 * Brace-counted rather than matched with a regex, because the bodies contain
 * both braces and template literals and a lazy match would stop at the first
 * `}` in a comment.
 */
function bodyOf(name: string): string {
  const declaration = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
  const start = SOURCE.search(declaration);
  assert.notEqual(start, -1, `no top-level function named ${name} in adhoc.service.ts`);

  const open = SOURCE.indexOf('{', start);
  assert.notEqual(open, -1, `no body found for ${name}`);

  let depth = 0;
  for (let i = open; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1;
    else if (SOURCE[i] === '}') {
      depth -= 1;
      if (depth === 0) return SOURCE.slice(open, i + 1);
    }
  }

  throw new Error(`unbalanced braces reading ${name}`);
}

describe('the query settings snapshot', () => {
  it('finds the functions it is about, so a pass means something', () => {
    // Guards the parsing. If these are renamed or inlined and this file silently
    // finds nothing, every assertion below passes vacuously — which is the same
    // shape of failure as the bug it exists to prevent.
    for (const name of DOWNSTREAM) {
      const body = bodyOf(name);
      assert.ok(body.length > 40, `${name} parsed as a ${body.length}-character body`);
    }

    assert.match(
      SOURCE,
      /const settings = currentAdhocSettings\(\);/,
      'runAdhocQuery no longer takes a snapshot at all',
    );
  });

  it('is threaded downstream, not read again', () => {
    /*
     * The invariant, and the one that kept breaking. Each of these runs inside a
     * single query and must take its values from the caller's snapshot:
     * `declareAndFetch`/`declareAndFetchStrict` take `maxRows`, `translate` takes
     * `timeoutMs`.
     */
    const offenders = DOWNSTREAM.filter((name) => bodyOf(name).includes('currentAdhocSettings('));

    assert.deepEqual(
      offenders,
      [],
      `these re-read the settings instead of using the snapshot: ${offenders.join(', ')}. ` +
        'A save landing mid-query then applies one value to the statement and reports another. ' +
        'Thread it from `settings` in runAdhocQuery.',
    );
  });

  it('actually uses what it is given', () => {
    // The other half: a parameter that is accepted and then ignored would satisfy
    // the check above while leaving the original bug in place.
    assert.match(bodyOf('declareAndFetchStrict'), /FETCH \$\{maxRows \+ 1\}/, 'the FETCH ignores maxRows');
    assert.match(bodyOf('translate'), /\$\{timeoutMs\}/, 'the timeout message ignores timeoutMs');
  });
});
