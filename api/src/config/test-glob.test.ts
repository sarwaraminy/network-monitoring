import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The test runner has to be handed the glob, not the shell.
 *
 * `test:api` was `tsx --test api/src/**` + `/*.test.ts`, unquoted. npm runs scripts
 * through `sh` on Linux, and `sh` has no globstar — so `**` degraded to a single
 * `*`, the pattern expanded to depth two only, and the one test file living at depth
 * three was silently dropped. Locally it looked fine: cmd.exe does no globbing at
 * all, so the pattern reached the test runner intact and Node expanded it properly.
 *
 * The result was a green CI running **456** tests while the suite was **496**, for
 * as long as that script has existed. The file it dropped was
 * `packet/detect/detect.test.ts` — the attack simulations and the false-positive
 * guards, the suite the README calls the one that matters most, and the only place
 * several deliberately-reintroduced-bug guards live. Nothing about the failure was
 * visible: no error, no warning, and a test count nobody had a second source for.
 *
 * Quoting the pattern hands it to the **test runner** to expand instead, which is
 * where the first version of this comment was wrong in a way worth recording:
 * `tsx` has no test-path handling of its own, it forwards to `node --test`, and it
 * is Node's runner that understands `**`. So the fix depends on a Node version, not
 * on tsx — and Node 20 does not expand it. There the quoted pattern arrives as a
 * literal path, matches nothing, and the runner prints `tests 0` and **exits 0**:
 * green CI running no tests at all, which is a worse version of the bug this file
 * exists to catch. `engines` therefore requires Node 22, the LTS that CI actually
 * tests, rather than the 20 it used to allow.
 *
 * This file is the standing check on all of that, in the family of
 * repository-configuration guards alongside `env-defaults.test.ts` and
 * `dependabot-config.test.ts` — text in, no library, no network.
 *
 * It sits at depth two so that the glob it validates can reach it, which is not a
 * joke: a guard against a pattern that cannot see the guard would be the same bug
 * wearing a hat.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const API_SRC = join(REPO, 'api', 'src');

const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

interface Script {
  where: string;
  name: string;
  command: string;
}

/** Every package script in the repo that invokes the node test runner. */
function runnerScripts(): Script[] {
  const scripts: Script[] = [];

  for (const where of ['package.json', join('api', 'package.json')]) {
    const parsed = JSON.parse(read(where)) as { scripts?: Record<string, string> };
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      if (command.includes('tsx --test')) scripts.push({ where, name, command });
    }
  }

  return scripts;
}

/** Every test file under api/src, relative to `from`, with forward slashes. */
function testFiles(from: string, dir = API_SRC): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(from, full));
    else if (entry.name.endsWith('.test.ts')) found.push(relative(from, full).split(sep).join('/'));
  }

  return found;
}

/**
 * The glob, as a regular expression, so the *whole* pattern is compared.
 *
 * The first version of this file only checked the text to the left of `**` and then
 * asserted `startsWith` on it. Everything after — the `*.test.ts` half — was never
 * looked at, so `api/src/**` + `/*.spec.ts` passed every assertion here: the prefix
 * still matched, the quoting check still passed, and the depth check is about the
 * tree rather than the pattern. Combined with a runner that exits 0 on a glob
 * matching nothing, a one-word typo in the half this file ignored produced exactly
 * the silent green it was written to prevent.
 *
 * Only `**` and `*` are given meaning, which is all these patterns use. Everything
 * else is escaped, so a `.` in `.test.ts` cannot quietly match any character.
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';

  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern.startsWith('**/', i)) {
      // Any number of directories, including none.
      source += '(?:[^/]+/)*';
      i += 2;
      continue;
    }
    if (pattern[i] === '*') {
      source += '[^/]*';
      continue;
    }
    source += pattern[i]!.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`);
}

/** The quoted glob a script passes to the runner. */
function patternOf(script: Script): string {
  const quoted = script.command.match(/tsx --test "([^"]+)"/)?.[1];
  assert.ok(quoted, `${script.where} → ${script.name}: no quoted glob to read`);
  return quoted;
}

describe('the API test glob', () => {
  it('is invoked by more than one script, all of which are checked', () => {
    // `test`, `ci` and `test:api` at the root plus `test` in the workspace. Fixing
    // one and leaving the others is the obvious way for this to come back, and CI
    // runs `test:api` while a developer is most likely to run `npm test`.
    const scripts = runnerScripts();

    assert.ok(scripts.length >= 3, `expected several runner scripts, found ${scripts.length}`);
  });

  it('is quoted in every one of them, so the runner expands it and not sh', () => {
    /*
     * The assertion the whole file exists for.
     *
     * An unquoted `**` is not an error on any platform — it is a pattern that
     * quietly means something narrower on the one that matters, and the only
     * symptom is a test count that looks plausible.
     */
    for (const script of runnerScripts()) {
      const [, after] = script.command.split('tsx --test ');
      assert.ok(after, `${script.where} → ${script.name}: could not read the pattern`);
      assert.match(
        after,
        /^"[^"]*\*\*[^"]*"/,
        `${script.where} → ${script.name} passes the glob unquoted, so sh will expand it and ` +
          `drop anything deeper than one directory: ${script.command}`,
      );
    }
  });

  it('reaches every test file under api/src, from every script', () => {
    /*
     * Every script, not `runnerScripts()[0]`.
     *
     * Picking the first entry made this test depend on the order `Object.entries`
     * happened to yield: reordering scripts in the root package.json — an edit
     * nobody would connect to this file — would have made `[0]` resolve to the
     * workspace's `src/`-relative pattern, whose prefix does not match
     * repo-relative paths, failing against correct configuration. And whichever
     * script came second had its coverage never checked at all, which is the
     * assertion this test exists to provide.
     *
     * Each pattern is resolved against its own package.json's directory, because
     * the root script says `api/src/**` and the workspace one says `src/**` and
     * both are correct where they live.
     */
    for (const script of runnerScripts()) {
      const base = dirname(join(REPO, script.where));
      const pattern = globToRegExp(patternOf(script));
      const files = testFiles(base);

      assert.ok(files.length > 0, `${script.where}: found no test files to check against`);
      assert.deepEqual(
        files.filter((file) => !pattern.test(file)),
        [],
        `${script.where} → ${script.name}: its glob does not reach these test files, so the ` +
          'runner will never see them — and a glob matching nothing exits 0, so nothing else ' +
          'would tell you',
      );
    }
  });

  it('has something to be wrong about — at least one file below depth two', () => {
    /*
     * Guards the guard. Every assertion above would pass, and the original bug
     * would be undetectable, on a tree where every test file happened to sit two
     * levels under api/src. That was one file away from being true: the shell's
     * degraded pattern dropped exactly one, and if that file had been moved up for
     * unrelated reasons the shortfall would have vanished and come back later with
     * the next nested test.
     */
    const deep = testFiles(API_SRC).filter((file) => file.split('/').length > 2);

    assert.ok(
      deep.length > 0,
      'no test file sits deeper than api/src/<dir>/<file>, so nothing here can detect a ' +
        'shell-degraded glob any more — if that is deliberate, this file can go',
    );
  });
});
