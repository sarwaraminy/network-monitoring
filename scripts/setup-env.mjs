#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
// Runs automatically after `npm install` (see the root package.json
// "postinstall" script). A fresh clone has no .env files, and api/src/config/env.ts
// refuses to boot without JWT_SECRET — so this creates the .env files a clone
// needs, generating real secrets instead of leaving that step for the first
// crash to explain. It never touches a .env that already exists, and never
// fails `npm install` itself — a filesystem error here just leaves a .env
// missing, which the app already reports clearly on its own.
//
// api/.env's DATABASE_URL and the root .env's POSTGRES_PASSWORD are filled
// with the same generated value, so that when both are created fresh (a new
// clone) the dev Postgres container scripts/ensure-db.mjs can start on demand
// already matches what the API expects — see that script.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Some CI platforms set CI=false explicitly (e.g. Create React App's convention
// for disabling treat-warnings-as-errors), so only a truthy, non-"false" value
// means we're actually in CI.
const isCI = Boolean(process.env.CI) && process.env.CI !== 'false';
if (isCI) {
  process.exit(0);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function generateSecret() {
  return randomBytes(48).toString('base64');
}

function generateDbPassword() {
  return randomBytes(24).toString('base64url');
}

function fillEmptyValue(contents, key, value, fileLabel) {
  const next = contents.replace(new RegExp(`^${key}=\\s*$`, 'm'), `${key}=${value}`);
  if (next === contents) {
    console.warn(
      `[setup-env] Could not find an empty ${key}= line in ${fileLabel} — wrote it without a generated value for it.`,
    );
  }
  return next;
}

// Loads dir/exampleName if dir/.env doesn't exist yet. Returns null (having
// already logged why) when there's nothing to do.
function readExampleIfEnvMissing(dir, exampleName) {
  const examplePath = resolve(ROOT, dir, exampleName);
  const envPath = resolve(ROOT, dir, '.env');
  const label = dir === '.' ? '.env' : `${dir}/.env`;

  if (!existsSync(examplePath)) return null;
  if (existsSync(envPath)) {
    console.log(`[setup-env] ${label} already exists, leaving it alone.`);
    return null;
  }
  return { envPath, label, contents: readFileSync(examplePath, 'utf8') };
}

function setupApiEnv(dbPassword) {
  try {
    const file = readExampleIfEnvMissing('api', '.env.example');
    if (!file) return { created: false };

    let contents = fillEmptyValue(file.contents, 'JWT_SECRET', generateSecret(), file.label);
    const withDbPassword = contents.replace(
      /^(DATABASE_URL=postgres:\/\/[^:]+:)CHANGE_ME(@.*)$/m,
      `$1${dbPassword}$2`,
    );
    if (withDbPassword === contents) {
      console.warn(
        `[setup-env] Could not find DATABASE_URL=...:CHANGE_ME@... in api/.env.example — wrote ${file.label} with the placeholder password still in it.`,
      );
    }
    contents = withDbPassword;

    writeFileSync(file.envPath, contents);
    console.log(`[setup-env] Created ${file.label} with a generated JWT_SECRET and DATABASE_URL password.`);
    return { created: true };
  } catch (err) {
    console.warn(`[setup-env] Could not set up api/.env: ${err.message}`);
    return { created: false };
  }
}

function setupUiEnv() {
  try {
    const file = readExampleIfEnvMissing('network-monitoring-ui', '.env.example');
    if (!file) return { created: false };

    writeFileSync(file.envPath, file.contents);
    console.log(`[setup-env] Created ${file.label}.`);
    return { created: true };
  } catch (err) {
    console.warn(`[setup-env] Could not set up network-monitoring-ui/.env: ${err.message}`);
    return { created: false };
  }
}

function setupRootEnv(dbPassword) {
  try {
    const file = readExampleIfEnvMissing('.', '.env.docker.example');
    if (!file) return { created: false };

    let contents = fillEmptyValue(file.contents, 'JWT_SECRET', generateSecret(), file.label);
    contents = fillEmptyValue(contents, 'POSTGRES_PASSWORD', dbPassword, file.label);

    writeFileSync(file.envPath, contents);
    console.log(
      `[setup-env] Created ${file.label} for docker compose, with a generated JWT_SECRET and POSTGRES_PASSWORD.`,
    );
    return { created: true };
  } catch (err) {
    console.warn(`[setup-env] Could not set up .env: ${err.message}`);
    return { created: false };
  }
}

// One password, used for both files: when a fresh clone gets both api/.env and
// the root .env in the same run, they end up pointing at the same database.
const dbPassword = generateDbPassword();

const api = setupApiEnv(dbPassword);
setupUiEnv();
setupRootEnv(dbPassword);

if (api.created) {
  console.log(
    '[setup-env] api/.env now has a generated DATABASE_URL password. If you already run Postgres ' +
      'locally, update DATABASE_URL to match it — otherwise `npm run dev` will offer to start a ' +
      'matching Postgres for you with Docker.',
  );
}
