#!/usr/bin/env node
// Runs before `npm run dev` / `npm run dev:api` (see the root package.json
// "predev" and "predev:api" scripts). If DATABASE_URL isn't reachable and
// Docker is available, starts a dev Postgres via docker-compose.dev.yml so a
// fresh clone can run `npm run dev` without installing Postgres by hand. Does
// nothing if DATABASE_URL already authenticates against something — a native
// install or an already-running container both count.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Node network errors (nothing there to talk to) vs. anything else, which
// means a real Postgres answered — most commonly 28P01 (auth failed) because
// a leftover container volume has a different password baked in from a
// previous clone or a since-regenerated api/.env.
const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET']);

function loadDatabaseUrl() {
  const envPath = resolve(ROOT, 'api', '.env');
  if (!existsSync(envPath)) return null;
  return dotenv.parse(readFileSync(envPath, 'utf8')).DATABASE_URL ?? null;
}

async function tryAuth(connectionString, hostOverride) {
  const client = new pg.Client({
    connectionString,
    ...(hostOverride ? { host: hostOverride } : {}),
    connectionTimeoutMillis: 3000,
  });
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

// `localhost` can resolve to either 127.0.0.1 or ::1 depending on the OS and
// Node version, and Docker Desktop doesn't always publish a port on both —
// probing the wrong family looks identical to nothing running at all. Try
// both explicitly; stop early if either succeeds, or if either gets an actual
// reply from Postgres (as opposed to a bare connection failure), since that's
// the more informative result either way.
async function checkAuth(connectionString, hostname) {
  const candidates = hostname === 'localhost' ? ['127.0.0.1', '::1'] : [hostname];
  let last;
  for (const candidate of candidates) {
    last = await tryAuth(connectionString, candidate);
    if (last.ok || !NETWORK_ERROR_CODES.has(last.code)) return last;
  }
  return last;
}

async function main() {
  const databaseUrl = loadDatabaseUrl();
  if (!databaseUrl) return; // No api/.env yet; npm install's postinstall explains that.

  let hostname;
  let port;
  try {
    const url = new URL(databaseUrl);
    hostname = url.hostname;
    port = Number(url.port) || 5432;
  } catch {
    return; // Not a URL — PGHOST/PGPORT are in play instead, nothing generic to check.
  }

  // Only offer to help for the local target this exists for; a remote/shared
  // DATABASE_URL being unreachable is not something Docker here can fix.
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return;

  const initial = await checkAuth(databaseUrl, hostname);
  if (initial.ok) return;
  if (!NETWORK_ERROR_CODES.has(initial.code)) {
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
    `[ensure-db] No Postgres reachable at ${hostname}:${port} — starting one with Docker Compose...`,
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

await main();
