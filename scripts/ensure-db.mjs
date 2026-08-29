#!/usr/bin/env node
// Runs before `npm run dev` / `npm run dev:api` (see the root package.json
// "predev" and "predev:api" scripts). If DATABASE_URL isn't reachable and
// Docker is available, starts a dev Postgres via docker-compose.dev.yml so a
// fresh clone can run `npm run dev` without installing Postgres by hand. Does
// nothing if something is already listening there — a native install or an
// already-running container both count.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDatabaseUrl() {
  const envPath = resolve(ROOT, 'api', '.env');
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.*)$/m);
  return match ? match[1].trim() : null;
}

function probe(host, port, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function main() {
  const databaseUrl = loadDatabaseUrl();
  if (!databaseUrl) return; // No api/.env yet; npm install's postinstall explains that.

  let host;
  let port;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    port = Number(url.port) || 5432;
  } catch {
    return; // Not a URL — PGHOST/PGPORT are in play instead, nothing generic to probe.
  }

  // Only offer to help for the local target this exists for; a remote/shared
  // DATABASE_URL being unreachable is not something Docker here can fix.
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return;

  if (await probe(host, port)) return;

  const dockerCheck = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
  if (dockerCheck.status !== 0) {
    console.warn(
      `[ensure-db] No Postgres reachable at ${host}:${port}, and Docker isn't available to start one. ` +
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

  console.log(`[ensure-db] No Postgres reachable at ${host}:${port} — starting one with Docker Compose...`);
  const up = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml', 'up', '-d', 'db'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (up.status !== 0) {
    console.warn('[ensure-db] Failed to start the dev Postgres container — see the error above.');
    return;
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await probe(host, port)) {
      console.log(`[ensure-db] Postgres is up and reachable at ${host}:${port}.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(
    `[ensure-db] Started the dev Postgres container, but it never became reachable at ${host}:${port}.`,
  );
}

await main();
