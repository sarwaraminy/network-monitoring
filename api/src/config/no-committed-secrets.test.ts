import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs with no types, which is what a git hook should
// be: it has to run from `.husky/pre-commit` with no build step in front of it.
import { inspect, isPlaceholder, PLACEHOLDERS } from '../../../scripts/no-committed-secrets.mjs';

/**
 * The commit guard must not fire on this repository as it stands.
 *
 * That is the property that decides whether it survives, and the first version
 * did not have it. Nine tracked files carry a URL-shaped credential string — the
 * README's documented example, `api/.env.example`'s `CHANGE_ME`, the
 * `postgres:postgres` every CI Postgres service uses, and the deliberately
 * unusable `nobody:nothing@127.0.0.1:1` that five test files point at to prove
 * they never connect. Two of them were in the diff of the commit that introduced
 * the guard, so the hook refused the branch that added it.
 *
 * A guard that fires on the repository's own documentation and fixtures is one
 * that gets bypassed with `--no-verify` within a week, and a bypassed guard
 * leaves the real thing uncaught. So this runs the scanner over every tracked
 * file and fails if it objects to any of them — which is a check on the checker
 * rather than on the tree.
 *
 * The other direction is asserted too. A test that only proved the scanner stays
 * quiet would pass just as well against a scanner that had stopped looking, which
 * is exactly how the accident it guards against happened in the first place.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/** Every tracked file, by the names git actually holds. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '');
}

describe('the commit guard, against the repository it guards', () => {
  it('objects to nothing that is already tracked', () => {
    const problems: string[] = [];

    for (const path of trackedFiles()) {
      let content = '';
      try {
        content = readFileSync(join(ROOT, path), 'utf8');
      } catch {
        // Unreadable or binary; the name check still applies, and `inspect`
        // handles an empty body.
      }
      problems.push(...(inspect(path, content) as string[]));
    }

    assert.deepEqual(
      problems.sort(),
      [],
      'the pre-commit guard refuses files already in this repository, so the next person to touch ' +
        'one of them cannot commit without --no-verify — and a guard routinely bypassed catches ' +
        'nothing. Either narrow the pattern or add the value to PLACEHOLDERS, with a note saying why ' +
        'it is not a secret',
    );
  });

  it('still refuses a credential that is not a stand-in', () => {
    /*
     * The check on the check. A scanner that had stopped matching would satisfy
     * the case above perfectly.
     *
     * Assembled from halves rather than written out, because a file containing
     * the literal shape is a file this hook refuses — which it demonstrated by
     * refusing the commit that added this test. The join is what keeps the
     * fixture out of the scanner's way while still producing the string it has
     * to catch.
     */
    const credential = ['postgres://admin', 'hunter2xK9@db.internal:5432/app'].join(':');
    const problems = inspect('probe.mjs', `connect('${credential}')`);

    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /embedded password/);
  });

  it('still refuses a filename nobody could read', () => {
    // The half `.gitignore` cannot cover, and the half that actually let the
    // scratch file through: the name was garbage in `git status`, so it did not
    // register as a file.
    const problems = inspect('$P', 'harmless');

    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /not readable ASCII/);
  });

  it('recognises a stand-in by what it says about itself', () => {
    // The rule that keeps the exemptions from growing one incident at a time: a
    // credential worth protecting does not have the word "password" in it.
    for (const value of ['yourpassword', 'CHANGE_ME', 'ci-postgres-password', 'example-secret']) {
      assert.ok(isPlaceholder(value), `${value} should read as a stand-in`);
    }
  });

  it('does not wave through something that merely looks random', () => {
    // The other side. A high-entropy string says nothing about itself, so it is
    // exactly what this check is for.
    for (const value of ['hunter2xK9', 'aB3!xQ92zz', 'Tr0ub4dor3']) {
      assert.ok(!isPlaceholder(value), `${value} should not be treated as a stand-in`);
    }
  });

  it('keeps the exact-value list short enough to still mean something', () => {
    /*
     * The list exists so the guard can survive contact with this repository; it
     * is not a licence to wave things through. Past a handful it stops being
     * "these few strings are obviously not secrets" and becomes a pattern too
     * broad to be worth keeping — a decision to make deliberately rather than
     * arrive at one entry at a time.
     */
    assert.ok(
      (PLACEHOLDERS as Set<string>).size <= 8,
      'the placeholder list has grown past the point where the pattern is worth keeping — rethink ' +
        'the check rather than adding another exemption',
    );
  });
});
