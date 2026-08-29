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
  console.log('[setup-env] CI detected (CI env var set) — skipping .env generation.');
  process.exit(0);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function generateSecret() {
  return randomBytes(48).toString('base64');
}

function generateDbPassword() {
  return randomBytes(24).toString('base64url');
}

function emptyValuePattern(key) {
  return new RegExp(`^${key}=\\s*$`, 'm');
}

// Every JWT_SECRET= line looks the same across .env.example files; each call
// site still mints its own fresh secret (api's and the root .env's are
// unrelated to each other, unlike the DB password).
function jwtSecretSubstitution() {
  return {
    key: 'JWT_SECRET',
    pattern: emptyValuePattern('JWT_SECRET'),
    replacement: `JWT_SECRET=${generateSecret()}`,
    description: 'an empty JWT_SECRET= line',
  };
}

// Applies one `{ pattern, replacement, description }` substitution, warning
// with concrete next steps (not a pointer to env.ts's crash message, which
// assumes a *missing* file — by the time that crash could fire, this script
// already created one) if the pattern didn't match anything.
function applySubstitution(contents, { pattern, replacement, description, key }, fileLabel) {
  const next = contents.replace(pattern, replacement);
  if (next === contents) {
    console.warn(
      `[setup-env] Could not find ${description} in ${fileLabel} — wrote it unfilled. ` +
        `Add "${key}=<a random value>" to ${fileLabel} yourself before starting the app.`,
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

// Copies dir/exampleName to dir/.env (if dir/.env doesn't already exist),
// applying each substitution in order. Never throws: a filesystem error is
// logged and treated the same as "nothing to do" so it can't fail `npm install`.
function createEnvFile(dir, exampleName, substitutions) {
  const label = dir === '.' ? '.env' : `${dir}/.env`;
  try {
    const file = readExampleIfEnvMissing(dir, exampleName);
    if (!file) return false;

    let contents = file.contents;
    for (const substitution of substitutions) {
      contents = applySubstitution(contents, substitution, file.label);
    }

    // 0o600: these files hold real secrets (JWT_SECRET, a DB password) — on a
    // shared machine, the process's default umask-derived mode (typically
    // 0o644) would leave them readable by any other local user.
    writeFileSync(file.envPath, contents, { mode: 0o600 });
    console.log(`[setup-env] Created ${file.label}.`);
    return true;
  } catch (err) {
    console.warn(`[setup-env] Could not set up ${label}: ${err.message}`);
    return false;
  }
}

// Extracts the DB password from whichever of api/.env or the root .env
// already exists, so that creating the other one (a contributor who already
// hand-configured one of the two, pulling this in) matches it instead of
// getting an unrelated fresh password. Only when neither exists yet — a
// fully fresh clone — does a new shared password get generated below.
function existingDbPassword() {
  try {
    const apiEnvPath = resolve(ROOT, 'api', '.env');
    if (existsSync(apiEnvPath)) {
      const match = readFileSync(apiEnvPath, 'utf8').match(/^DATABASE_URL=postgres:\/\/[^:]+:([^@]+)@/m);
      if (match) return match[1];
    }
  } catch {
    // Fall through to the root .env / fresh-generation below.
  }
  try {
    const rootEnvPath = resolve(ROOT, '.env');
    if (existsSync(rootEnvPath)) {
      const match = readFileSync(rootEnvPath, 'utf8').match(/^POSTGRES_PASSWORD=(.+)$/m);
      if (match) return match[1].trim();
    }
  } catch {
    // Neither file is readable; fall back to generating a fresh one.
  }
  return null;
}

// One password, used for both files: when a fresh clone gets both api/.env and
// the root .env in the same run, they end up pointing at the same database.
// When only one of the two already exists, reuse its password instead.
const dbPassword = existingDbPassword() ?? generateDbPassword();

const apiCreated = createEnvFile('api', '.env.example', [
  jwtSecretSubstitution(),
  {
    key: 'DATABASE_URL',
    pattern: /^(DATABASE_URL=postgres:\/\/[^:]+:)CHANGE_ME(@.*)$/m,
    replacement: `$1${dbPassword}$2`,
    description: 'DATABASE_URL=...:CHANGE_ME@...',
  },
]);

createEnvFile('network-monitoring-ui', '.env.example', []);

createEnvFile('.', '.env.docker.example', [
  jwtSecretSubstitution(),
  {
    key: 'POSTGRES_PASSWORD',
    pattern: emptyValuePattern('POSTGRES_PASSWORD'),
    replacement: `POSTGRES_PASSWORD=${dbPassword}`,
    description: 'an empty POSTGRES_PASSWORD= line',
  },
]);

if (apiCreated) {
  console.log(
    '[setup-env] api/.env now has a generated DATABASE_URL password. If you already run Postgres ' +
      'locally, update DATABASE_URL to match it — otherwise `npm run dev` will offer to start a ' +
      'matching Postgres for you with Docker.',
  );
}
