import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ERRORS_EN } from './errors.en.js';
import { NOTIFY_EN } from './notify.en.js';

/**
 * A key no code asks for is three translations maintained for nothing.
 *
 * The interface catalogue got this check in an earlier round of review and the
 * server-side ones did not, which is exactly why two dead error keys survived a
 * refactor here: `error.capture_failed` and `error.unexpected` were carried in
 * three locales apiece with no caller, and were revised on every pass over the
 * file because nothing said they were unreachable.
 *
 * Findings are deliberately not checked. Their keys are composed at runtime —
 * `${base}.title` and `${base}.description` from a `FindingMessageBase` the
 * detectors set — so no literal `'port_scan.packet.title'` exists anywhere, and
 * `findings-catalog.test.ts` already pins them from the other direction by
 * asserting every base has both halves.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, '..', '..');
const UI_SRC = join(HERE, '..', '..', '..', '..', 'network-monitoring-ui', 'src');

/** Every `.ts`/`.tsx` under `root`, minus the catalogues themselves. */
function sourcesUnder(root: string): string[] {
  const out: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        // The catalogue directories define these keys; a definition is not a
        // reader, and counting one would make this check unable to fail — the
        // exact defect the UI's version of it had.
        if (entry === 'catalog' || entry === 'generated' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };

  walk(root);
  return out;
}

const SOURCE = [...sourcesUnder(API_SRC), ...sourcesUnder(UI_SRC)]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('server catalogues have no key nothing asks for', () => {
  for (const [name, catalog] of [
    ['errors', ERRORS_EN],
    ['notify', NOTIFY_EN],
  ] as const) {
    it(`every ${name} key has a caller`, () => {
      const orphans = Object.keys(catalog).filter((key) => !SOURCE.includes(`'${key}'`));

      assert.deepEqual(
        orphans,
        [],
        `these are defined and never raised: ${orphans.join(', ')}. Delete them, or the ` +
          'translation of a sentence nobody can reach is revised on every pass over the file.',
      );
    });
  }
});
