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
  const secret = generateSecret();
  return {
    key: 'JWT_SECRET',
    pattern: emptyValuePattern('JWT_SECRET'),
    replacement: () => `JWT_SECRET=${secret}`,
    description: 'an empty JWT_SECRET= line',
  };
}

// Applies one `{ pattern, replacement, description }` substitution, warning
// with concrete next steps (not a pointer to env.ts's crash message, which
// assumes a *missing* file — by the time that crash could fire, this script
// already created one) if the pattern didn't match anything. `replacement` is
// always a function, not a string: String.prototype.replace()'s string form
// treats '$'-sequences specially ($1/$2 as capture groups, $$ as a literal
// '$'), which would silently mangle a *reused* value (existingDbPassword(),
// read back from a hand-set password) containing one — a function's return
// value is inserted verbatim, no escaping required at any call site.
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
    // shared POSIX machine, the process's default umask-derived mode
    // (typically 0o644) would leave them readable by any other local user.
    // No effect on Windows: verified `mode` there only toggles the read-only
    // attribute, not POSIX permission bits — restricting access would need an
    // explicit ACL change instead (e.g. icacls), not attempted here.
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
      // postgresql:// is an equally valid scheme, and the password itself can
      // contain '@' — greedy `.+` backtracks to the last '@' (before the
      // host), rather than `[^@]+` wrongly stopping at the password's own.
      const match = readFileSync(apiEnvPath, 'utf8').match(
        /^DATABASE_URL=postgres(?:ql)?:\/\/[^:]+:(.+)@[^@]+$/m,
      );
      // match[1].trim() !== '', not just `if (match)`: a blank/whitespace-only
      // value (a plausible half-finished hand-edit) would otherwise be
      // returned and used as-is by the `??` at the call site below — `??`
      // only substitutes on null/undefined, not on an empty string.
      if (match && match[1].trim() !== '') {
        const raw = match[1].trim();
        try {
          // A URL's password segment is percent-encoded (verified: pg's own
          // parser decodes it) — decode here too, or a reserved character
          // (e.g. '@', '%') would get written into the root .env's
          // POSTGRES_PASSWORD still encoded, an effectively different
          // password from what api/.env actually connects with
          // (docker-compose passes it through as a literal env var, no
          // URL-decoding).
          return decodeURIComponent(raw);
        } catch (err) {
          // A stray literal '%' not part of valid percent-encoding (an easy
          // typo — Postgres passwords don't require '%' to mean anything)
          // throws here specifically, not a read failure — caught separately
          // so the outer catch below doesn't misreport it as one. The raw,
          // un-decoded value is still usable as a fallback.
          console.warn(
            `[setup-env] Could not decode api/.env's DATABASE_URL password (${err.message}) — using it as-is.`,
          );
          return raw;
        }
      }
    }
  } catch (err) {
    // Falls through to the root .env / fresh-generation below, same as a
    // missing file — but unlike a missing file, this means api/.env exists
    // and couldn't be read, which silently reintroduces the password
    // mismatch this function exists to prevent, so it's worth surfacing.
    console.warn(`[setup-env] Could not read api/.env to check for an existing DB password: ${err.message}`);
  }
  try {
    const rootEnvPath = resolve(ROOT, '.env');
    if (existsSync(rootEnvPath)) {
      const match = readFileSync(rootEnvPath, 'utf8').match(/^POSTGRES_PASSWORD=(.+)$/m);
      if (match && match[1].trim() !== '') return match[1].trim();
    }
  } catch (err) {
    console.warn(`[setup-env] Could not read .env to check for an existing DB password: ${err.message}`);
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
    // dbPassword may come from the root .env's POSTGRES_PASSWORD (a literal,
    // never URL-encoded there) — encode it here since this splice site is a
    // URL; a reserved character (e.g. '/', '#') would otherwise break the
    // URL outright (verified: both WHATWG URL and pg-connection-string throw
    // on it). A freshly generated password (base64url) is already URL-safe,
    // so this is a no-op in the common case.
    replacement: (_match, prefix, suffix) => `${prefix}${encodeURIComponent(dbPassword)}${suffix}`,
    description: 'DATABASE_URL=...:CHANGE_ME@...',
  },
]);

createEnvFile('network-monitoring-ui', '.env.example', []);

createEnvFile('.', '.env.docker.example', [
  jwtSecretSubstitution(),
  {
    key: 'POSTGRES_PASSWORD',
    pattern: emptyValuePattern('POSTGRES_PASSWORD'),
    replacement: () => `POSTGRES_PASSWORD=${dbPassword}`,
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
