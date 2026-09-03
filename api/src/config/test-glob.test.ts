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
 * all, so the pattern reached `tsx` intact and `tsx` expanded it properly.
 *
 * The result was a green CI running **456** tests while the suite was **496**, for
 * as long as that script has existed. The file it dropped was
 * `packet/detect/detect.test.ts` — the attack simulations and the false-positive
 * guards, the suite the README calls the one that matters most, and the only place
 * several deliberately-reintroduced-bug guards live. Nothing about the failure was
 * visible: no error, no warning, and a test count nobody had a second source for.
 *
 * Quoting the pattern makes `tsx` do the expansion on every platform. This file is
 * the standing check on that, in the family of repository-configuration guards
 * alongside `env-defaults.test.ts` and `dependabot-config.test.ts` — text in, no
 * library, no network.
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

/** Every test file under api/src, repo-relative, with forward slashes. */
function testFiles(dir = API_SRC): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (entry.name.endsWith('.test.ts')) found.push(relative(REPO, full).split(sep).join('/'));
  }

  return found;
}

describe('the API test glob', () => {
  it('is invoked by more than one script, all of which are checked', () => {
    // `test`, `ci` and `test:api` at the root plus `test` in the workspace. Fixing
    // one and leaving the others is the obvious way for this to come back, and CI
    // runs `test:api` while a developer is most likely to run `npm test`.
    const scripts = runnerScripts();

    assert.ok(scripts.length >= 3, `expected several runner scripts, found ${scripts.length}`);
  });

  it('is quoted in every one of them, so tsx expands it and not sh', () => {
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

  it('reaches every test file under api/src', () => {
    // The other direction: quoting is no help if the pattern itself stops covering
    // something. `tsx` expands `**` to any depth, so this holds by construction
    // today — asserted anyway, because the pattern is the thing under test and a
    // narrowed one would fail here rather than in a count nobody can check.
    const pattern = runnerScripts()[0]?.command.match(/"([^"]+)"/)?.[1];
    assert.ok(pattern, 'no quoted glob to check');

    const prefix = pattern.slice(0, pattern.indexOf('**'));
    const uncovered = testFiles().filter((file) => !file.startsWith(prefix) || !file.endsWith('.test.ts'));

    assert.deepEqual(uncovered, [], 'these test files are outside the glob the runner is given');
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
    const deep = testFiles().filter((file) => file.replace('api/src/', '').split('/').length > 2);

    assert.ok(
      deep.length > 0,
      'no test file sits deeper than api/src/<dir>/<file>, so nothing here can detect a ' +
        'shell-degraded glob any more — if that is deliberate, this file can go',
    );
  });
});
