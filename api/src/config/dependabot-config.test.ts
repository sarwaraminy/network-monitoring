import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `.github/dependabot.yml` must deliver what its own comments promise.
 *
 * That file has now been wrong three times, always the same way: a comment
 * asserting something the configuration underneath does not do, and twice the
 * comment was the only place the reasoning lived. The sequence, because the pattern
 * is the point:
 *
 *  1. The header explained the PR ceiling while three of the four ecosystems had no
 *     limit set at all, defaulting to 5 each — an effective ceiling of 20 against a
 *     comment describing a handful.
 *  2. "Majors stay individual, because those are the ones that actually need
 *     reading" was true except for `0.x` packages, where Dependabot reads
 *     `0.36 -> 0.45` as a minor. So the one upgrade that warranted review — an ORM
 *     major closing a high-severity advisory — arrived buried in a nine-package
 *     group.
 *  3. "Schedule, grouping and open-pull-requests-limit do not hold back a security
 *     update" was false for this repository, because Dependabot *security updates*
 *     were switched off while alerts were on. Two high-severity advisories had
 *     generated alerts that could never generate a PR, so every security fix was
 *     in fact arriving monthly, grouped and capped.
 *
 * None of the three was catchable by reading the file, which is why this exists. It
 * compares the YAML against the repository it governs, the same way
 * env-defaults.test.ts compares `.env.example` and Compose against env.ts — text
 * in, no library, no network.
 *
 * What it cannot check is the repository setting from (3): that lives in GitHub, not
 * in the tree. So it checks the next best thing — that the file still *names* the
 * setting its guarantee depends on, so the next person to read the guarantee is
 * told what it rests on.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const read = (relative: string) => readFileSync(join(REPO, relative), 'utf8');

const CONFIG = '.github/dependabot.yml';
const PACKAGE_FILES = ['package.json', 'api/package.json', 'network-monitoring-ui/package.json'];

/** One `- package-ecosystem:` entry, as raw text, keyed by ecosystem and directory. */
function ecosystemBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string>();
  // Split on the two-space list marker that starts each entry, which is the only
  // indentation level the file uses for them.
  const parts = text.split(/^ {2}- package-ecosystem:/m).slice(1);

  for (const part of parts) {
    const ecosystem = (/^\s*([a-z-]+)/.exec(part)?.[1] ?? '').trim();
    const directory = (/^\s*directory:\s*(\S+)/m.exec(part)?.[1] ?? '').trim();
    blocks.set(`${ecosystem}:${directory}`, part);
  }

  return blocks;
}

/** `exclude-patterns: ['a', 'b']` from the named group, as written on one line. */
function excludePatterns(text: string, group: string): string[] {
  const groupIndex = text.indexOf(`${group}:`);
  assert.notEqual(groupIndex, -1, `${CONFIG} has no group named ${group}`);

  const match = /exclude-patterns:\s*\[([^\]]*)\]/.exec(text.slice(groupIndex));
  if (!match) return [];

  return (match[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry !== '');
}

/**
 * Production dependencies pinned to a `0.x` range.
 *
 * The whole reason finding (2) happened: for a `0.x` package the minor field is
 * what a breaking change moves, so Dependabot classifies it as a minor and a group
 * matching `[minor, patch]` swallows it. `npm audit` calls the same bump
 * `isSemVerMajor: true`, which is the more honest reading.
 */
function zeroVersionProductionDeps(): { name: string; range: string; file: string }[] {
  const found: { name: string; range: string; file: string }[] = [];

  for (const file of PACKAGE_FILES) {
    const manifest = JSON.parse(read(file)) as { dependencies?: Record<string, string> };
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (/^[~^]?0\./.test(range)) found.push({ name, range, file });
    }
  }

  return found;
}

describe('dependabot configuration', () => {
  const text = read(CONFIG);
  const blocks = ecosystemBlocks(text);

  it('parses into the four ecosystems the file is written around', () => {
    // A sanity check on the parsing above, so a silent zero-match cannot make
    // every assertion below vacuously true — which is how a guard passes while
    // watching nothing.
    assert.deepEqual([...blocks.keys()].sort(), [
      'docker:/api',
      'docker:/network-monitoring-ui',
      'github-actions:/',
      'npm:/',
    ]);
  });

  it('caps every ecosystem explicitly', () => {
    // The founding bug. An unset limit is 5 per ecosystem, so leaving three unset
    // gave an effective ceiling of 20 while the header described a handful.
    for (const [name, block] of blocks) {
      assert.match(
        block,
        /open-pull-requests-limit:\s*\d+/,
        `${name} has no open-pull-requests-limit, so it silently defaults to 5`,
      );
    }
  });

  it('groups every ecosystem, so none opens one PR per dependency', () => {
    for (const [name, block] of blocks) {
      assert.match(block, /\n\s+groups:/, `${name} has no groups block`);
    }
  });

  it('keeps every 0.x production dependency out of the production group', () => {
    // The generalisation of finding (2), which the issue asked for explicitly: the
    // reasoning is not about drizzle-orm, it is about 0.x. A new one added later
    // must fail here rather than silently join the group.
    const excluded = excludePatterns(text, 'production-updates');
    const zeroVersion = zeroVersionProductionDeps();

    assert.ok(
      zeroVersion.length > 0,
      'no 0.x production dependency found — if that is now true, this check and the ' +
        'exclude-patterns list should both be revisited rather than left asserting nothing',
    );

    for (const dep of zeroVersion) {
      assert.ok(
        excluded.includes(dep.name),
        `${dep.name} (${dep.range} in ${dep.file}) is a 0.x production dependency, so ` +
          'Dependabot will read a breaking bump as a minor and group it. Add it to ' +
          "production-updates' exclude-patterns so it lands on its own.",
      );
    }
  });

  it('does not exclude packages that are not 0.x', () => {
    // The other direction. An exclusion left behind after a package reached 1.0 is
    // a standalone PR nobody asked for, and it quietly consumes a slot from the
    // limit above.
    const excluded = excludePatterns(text, 'production-updates');
    const zeroVersionNames = new Set(zeroVersionProductionDeps().map((dep) => dep.name));

    for (const name of excluded) {
      assert.ok(
        zeroVersionNames.has(name),
        `${name} is excluded from production-updates but is no longer a 0.x production ` +
          'dependency. Remove the exclusion, or say why it still needs to stand alone.',
      );
    }
  });

  it('names the repository setting its security guarantee depends on', () => {
    // Finding (3). The file states that security updates bypass its caps, which is
    // true only while "Dependabot security updates" is enabled — a setting the file
    // cannot see and which was off here. This cannot verify the setting; it can
    // make sure the claim never travels without naming what it rests on.
    assert.match(
      text,
      /automated-security-fixes/,
      'the header promises that security updates bypass these caps. That holds only ' +
        'while Dependabot security updates are enabled for the repo, so the file must ' +
        'name the setting (automated-security-fixes) rather than assert the guarantee alone',
    );
  });

  it('keeps drizzle-orm out of the ignore list', () => {
    // It carries an open high-severity advisory, and an ignore rule suppresses the
    // security PR along with the version one. The file says so; this holds it to it.
    const ignoreIndex = text.indexOf('ignore:');
    assert.notEqual(ignoreIndex, -1);

    const npmBlock = blocks.get('npm:/') ?? '';
    const ignored = [...npmBlock.matchAll(/dependency-name:\s*'?"?([^'"\n]+)'?"?/g)].map((match) =>
      (match[1] ?? '').trim(),
    );

    assert.ok(
      !ignored.includes('drizzle-orm'),
      'drizzle-orm has an open advisory; an ignore rule would suppress its security PR too',
    );
  });
});
