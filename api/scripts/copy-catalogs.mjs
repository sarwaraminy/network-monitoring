// The i18n module is written once, in the API, and mirrored into the UI.
//
// It has to exist on both sides: the server renders findings for the email and
// Teams bodies and for the syslog and CEF exports, and the browser renders the
// same findings for whoever is reading the alert list — in their language, which
// the server does not know. Two hand-maintained copies of a three-language
// catalogue is the sort of duplication that drifts silently and is discovered by
// the reader who speaks the language nobody on the team does, so it is generated
// instead.
//
// The direction is API → UI and never back. The messages are authored next to the
// detectors that emit them, which is the only place their parameters are known.
//
// This mirrors `copy-migrations.mjs`: the same problem, of a source of truth that
// one build step cannot reach from where it sits, solved the same way. Unlike that
// one, the output is checked in and CI verifies it is current — a generated file
// that only exists after a build is a file the editor cannot resolve and review
// cannot read.
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(apiRoot);
const from = join(apiRoot, 'src', 'i18n');
const to = join(repoRoot, 'network-monitoring-ui', 'src', 'i18n', 'generated');

/** Tests stay behind: they run once, against the original. */
const skip = (name) => name.endsWith('.test.ts');

const BANNER = `// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run \`npm run i18n:sync\`; CI fails if this copy is stale.
`;

/**
 * NodeNext requires the `.js` suffix on a relative import and a bundler does not
 * want it — Vite resolves from the filesystem and there is no `locales.js` to
 * find. Rewriting on the way out keeps the API copy idiomatic for the runtime that
 * actually executes it, and the UI copy idiomatic for the one that bundles it.
 */
const forBundler = (source) => source.replace(/(from '\.\.?\/[^']*)\.js'/g, "$1'");

async function copyTree(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const written = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      written.push(...(await copyTree(join(sourceDir, entry.name), join(targetDir, entry.name))));
      continue;
    }
    if (skip(entry.name)) continue;
    const source = await readFile(join(sourceDir, entry.name), 'utf8');
    written.push({ path: join(targetDir, entry.name), content: BANNER + forBundler(source) });
  }
  return written;
}

const files = await copyTree(from, to);

/**
 * Everything currently sitting in the target tree.
 *
 * The check walked only the *source*, comparing each file it found there against
 * its copy — so a file deleted or renamed under `api/src/i18n` left its copy
 * behind and CI went on reporting "copies are current". A stray file is dead code
 * rather than wrong output, because `catalog/*.ts` would be regenerated with
 * correct imports. Worth closing anyway: this script is the only thing holding
 * the two halves of a three-language catalogue together, and a check whose
 * failures are unreachable reports success, which is the failure mode this
 * repository has been bitten by before.
 */
async function existingFiles(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await existingFiles(path)));
    else found.push(path);
  }
  return found;
}

const written = new Set(files.map((file) => file.path));
const orphans = (await existingFiles(to)).filter((path) => !written.has(path));

// `--check` is what CI runs: it reports staleness rather than fixing it, because a
// build that silently regenerates a checked-in file hides the fact that somebody
// committed one half of a change.
if (process.argv.includes('--check')) {
  const stale = [];
  for (const file of files) {
    const existing = await readFile(file.path, 'utf8').catch(() => null);
    if (existing !== file.content) stale.push(file.path);
  }
  if (stale.length > 0 || orphans.length > 0) {
    const listed = [
      ...stale.map((path) => `  stale    ${path}`),
      ...orphans.map((path) => `  orphaned ${path}`),
    ];
    console.error(
      `i18n copies are out of date:\n${listed.join('\n')}\n` +
        'Run `npm run i18n:sync` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`i18n copies are current (${files.length} files)`);
} else {
  const { mkdir } = await import('node:fs/promises');
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }
  // Removed rather than left behind: the write branch is what `--check` checks,
  // so running the sync has to reach a state the check calls current.
  for (const path of orphans) await rm(path);
  const removed = orphans.length > 0 ? `, removed ${orphans.length}` : '';
  console.log(`copied i18n -> ${to} (${files.length} files${removed})`);
}
