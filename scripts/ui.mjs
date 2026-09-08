// Runs one of the UI workspace's tools from the repository root, wherever npm
// decided to put it.
//
// The root scripts used to name `vite` and `vitest` directly, which worked while
// both hoisted into the root `node_modules/.bin`. Vite 8 stopped hoisting: it
// declares an *optional* peer on esbuild `^0.27 || ^0.28`, drizzle-kit pins
// `^0.25.4`, and npm resolves that by nesting vite — and vitest with it — under
// `network-monitoring-ui/`. `npm run build` from the root then failed with
// "'vite' is not recognized", and CI runs exactly those root scripts.
//
// Nothing is wrong with the nesting. Vite 8 bundles with rolldown and only
// reaches for esbuild if asked to, which this configuration does not, so the
// peer it cannot satisfy is one it never loads. The note beside the override in
// package.json predicted this trade and took it deliberately: a global esbuild
// override would swap a real advisory for an unsatisfied peer on whichever tool
// lost.
//
// So this resolves the tool rather than assuming a layout. Node's own resolution
// is asked where the package is, starting from the UI workspace, which answers
// correctly whether npm nested it or hoisted it — and a fresh `npm ci` on CI's
// Linux runners does not have to agree with a developer's Windows tree for both
// to work.
//
// `npm run <script> -w network-monitoring-ui` is the obvious alternative and is
// not used, for a reason worth writing down: npm puts *every* ancestor
// directory's `node_modules/.bin` on PATH when it runs a script. A checkout
// under a home directory that once had `npm install` run in it therefore
// inherits whatever npm that pulled in — here, an npm 2.15.12 dragged in by
// `irm`, which appended the workspace name as a positional argument and failed.
// That particular install has since been disabled, but the shape of it has not:
// a nested package manager resolves through the environment's accumulated state,
// and `node` does not.
//
//   node scripts/ui.mjs vite build
//   node scripts/ui.mjs vitest run
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const UI = join(ROOT, 'network-monitoring-ui');

const [tool, ...args] = process.argv.slice(2);
if (!tool) {
  console.error('Usage: node scripts/ui.mjs <tool> [args...]');
  process.exit(2);
}

/** The tool's entry script, found from the UI workspace rather than assumed. */
function entryPoint(name) {
  // Resolved relative to the workspace's own package.json, so node walks
  // network-monitoring-ui/node_modules first and the root's after it.
  const require = createRequire(join(UI, 'package.json'));
  const manifestPath = require.resolve(`${name}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // `bin` is a string for a single-command package and a map for the rest.
  const relative = typeof bin === 'string' ? bin : bin?.[name];
  if (!relative) throw new Error(`${name} declares no bin entry called ${name}`);
  return resolve(dirname(manifestPath), relative);
}

// Spawned rather than imported: these are CLIs that read `process.argv` and set
// an exit code, and running them in this process would put their signal handling
// and ours in the same place.
const child = spawn(process.execPath, [entryPoint(tool), ...args], {
  cwd: UI,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  // A signalled child has no exit code. Reporting 1 keeps `&&` chains in the
  // root scripts behaving as they read.
  process.exit(signal ? 1 : (code ?? 1));
});
