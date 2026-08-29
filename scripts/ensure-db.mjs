#!/usr/bin/env node
// Runs before `npm run dev` / `npm run dev:api` (see the root package.json
// "predev" and "predev:api" scripts). If DATABASE_URL isn't reachable and
// Docker is available, starts a dev Postgres via docker-compose.dev.yml so a
// fresh clone can run `npm run dev` without installing Postgres by hand. Does
// nothing if DATABASE_URL already authenticates against something — a native
// install or an already-running container both count.
//
// dotenv and pg are workspace-hoisted from api/package.json, not declared
// here — the root package.json devDependencies pin the same versions so this
// script keeps resolving them even if hoisting ever stops covering it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PG_DISCRETE_VARS = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

// Node network errors (nothing there to talk to) vs. anything else, which
// means a real Postgres answered — most commonly 28P01 (auth failed) because
// a leftover container volume has a different password baked in from a
// previous clone or a since-regenerated api/.env. pg's own connect-timeout
// (connectionTimeoutMillis elapsing on a dropped/blackholed connection, as
// opposed to Node's net-level ETIMEDOUT) throws with code undefined and this
// exact message — checked separately since `code` alone can't catch it.
const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET']);
const PG_CONNECT_TIMEOUT_MESSAGE = 'timeout expired';

function isNetworkError({ code, message }) {
  return NETWORK_ERROR_CODES.has(code) || message === PG_CONNECT_TIMEOUT_MESSAGE;
}

// { envExists, databaseUrl } — databaseUrl is null both when api/.env is
// missing and when it configures Postgres via the discrete PGHOST/PGPORT/...
// vars api/src/config/env.ts also accepts; usesDiscreteVars distinguishes them.
function loadDatabaseConfig() {
  const envPath = resolve(ROOT, 'api', '.env');
  try {
    if (!existsSync(envPath)) return { envExists: false };

    const parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
    if (parsed.DATABASE_URL) return { envExists: true, databaseUrl: parsed.DATABASE_URL };
    return {
      envExists: true,
      databaseUrl: null,
      usesDiscreteVars: PG_DISCRETE_VARS.some((key) => parsed[key]),
    };
  } catch (err) {
    // A transient read failure (permission hiccup, antivirus lock, the file
    // vanishing between existsSync and readFileSync) shouldn't abort
    // `npm run dev` — skip the check the same as a missing file would.
    console.warn(`[ensure-db] Could not read api/.env, skipping the database check: ${err.message}`);
    return { envExists: false };
  }
}

async function tryAuth(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  } finally {
    await client.end().catch(() => {});
  }
}

// WHATWG URL's hostname setter silently no-ops for a bare IPv6 literal — it
// requires bracket syntax (`[::1]`), and assigning `'::1'` leaves the URL
// unchanged with no error. Any candidate containing a colon is IPv6.
function withHost(connectionString, candidate) {
  const url = new URL(connectionString);
  url.hostname = candidate.includes(':') ? `[${candidate}]` : candidate;
  return url.toString();
}

// `localhost` can resolve to either 127.0.0.1 or ::1 depending on the OS and
// Node version, and Docker Desktop doesn't always publish a port on both —
// probing the wrong family looks identical to nothing running at all. Try
// both explicitly by swapping the URL's hostname per attempt (passing `host`
// alongside `connectionString` to pg.Client doesn't work: pg parses the
// connection string over top of it, so the string's own host always wins).
// Stop early if either succeeds, or if either gets an actual reply from
// Postgres (as opposed to a bare connection failure), since that's the more
// informative result either way.
async function checkAuth(connectionString, hostname) {
  if (hostname !== 'localhost') return tryAuth(connectionString);

  let last;
  for (const candidate of ['127.0.0.1', '::1']) {
    last = await tryAuth(withHost(connectionString, candidate));
    if (last.ok || !isNetworkError(last)) return last;
  }
  return last;
}

async function main() {
  const db = loadDatabaseConfig();
  if (!db.envExists) return; // No api/.env yet; npm install's postinstall explains that.
  if (!db.databaseUrl) {
    if (db.usesDiscreteVars) {
      console.warn(
        '[ensure-db] api/.env configures Postgres via PGHOST/PGPORT/etc. rather than DATABASE_URL — ' +
          "ensure-db.mjs doesn't check that form yet, so it won't verify it's reachable or offer to " +
          'start one with Docker. Set DATABASE_URL instead, or make sure Postgres is running yourself.',
      );
    }
    return;
  }
  const databaseUrl = db.databaseUrl;

  let hostname;
  let port;
  try {
    const url = new URL(databaseUrl);
    hostname = url.hostname;
    port = Number(url.port) || 5432;
  } catch {
    return; // Not a URL — shouldn't happen once db.databaseUrl is set, but nothing generic to check if so.
  }

  // Only offer to help for the local target this exists for; a remote/shared
  // DATABASE_URL being unreachable is not something Docker here can fix.
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return;

  const initial = await checkAuth(databaseUrl, hostname);
  if (initial.ok) return;
  if (!isNetworkError(initial)) {
    console.warn(
      `[ensure-db] Something is already listening at ${hostname}:${port}, but rejected DATABASE_URL's ` +
        `credentials (${initial.code ?? initial.message}). Leaving it alone — update api/.env's ` +
        'DATABASE_URL to match it, or free the port for a Docker-managed dev database.',
    );
    return;
  }

  const dockerCheck = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
  if (dockerCheck.status !== 0) {
    console.warn(
      `[ensure-db] No Postgres reachable at ${hostname}:${port}, and Docker isn't available to start one. ` +
        'Install Postgres locally (see README setup) or install Docker, then try again.',
    );
    return;
  }

  if (!existsSync(resolve(ROOT, '.env'))) {
    console.warn(
      '[ensure-db] No Postgres reachable, and no root .env to configure a dev container with ' +
        '(npm install should have created one from .env.docker.example — try running it again).',
    );
    return;
  }

  console.log(
    `[ensure-db] No Postgres reachable at ${hostname}:${port} — starting one with Docker Compose. ` +
      "If you have a native Postgres install that's just not running right now (rather than none at " +
      'all), start that instead and re-run this — a Docker container will bind the same port with an ' +
      'empty database, and your real one will fail to start afterwards while this is still running.',
  );
  // --wait blocks until the db service's own healthcheck (pg_isready) passes,
  // rather than racing a TCP-only probe against Postgres's two-phase startup
  // (initdb, a brief listen, then a restart) on a fresh volume.
  const up = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait', 'db'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (up.status !== 0) {
    console.warn('[ensure-db] Failed to start the dev Postgres container — see the error above.');
    return;
  }

  const after = await checkAuth(databaseUrl, hostname);
  if (after.ok) {
    console.log(`[ensure-db] Postgres is up and reachable at ${hostname}:${port}.`);
    return;
  }
  console.warn(
    `[ensure-db] Started the dev Postgres container, but DATABASE_URL's credentials were rejected ` +
      `(${after.code ?? after.message}). If this container's volume is left over from a previous clone ` +
      "or a regenerated api/.env, its password no longer matches. Reset it with 'docker compose down -v db' " +
      "(this deletes the dev database's data) and run npm run dev again.",
  );
}

// This runs as the predev/predev:api npm lifecycle hook — an uncaught
// rejection here would abort `npm run dev` entirely over what should be, at
// worst, a skipped convenience check.
try {
  await main();
} catch (err) {
  console.warn(`[ensure-db] Unexpected error, skipping the database check: ${err.message}`);
}
