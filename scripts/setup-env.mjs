#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
// Runs automatically after `npm install` (see the root package.json
// "postinstall" script). A fresh clone has no .env files, and api/src/config/env.ts
// refuses to boot without JWT_SECRET — so this creates the .env files a clone
// needs, generating a real secret instead of leaving that step for the first
// crash to explain. It never touches a .env that already exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI supplies real env vars directly; it doesn't need or want a generated .env.
if (process.env.CI) {
  process.exit(0);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function setupEnv(dir, { fillJwtSecret = false } = {}) {
  const examplePath = resolve(ROOT, dir, '.env.example');
  const envPath = resolve(ROOT, dir, '.env');

  if (!existsSync(examplePath)) return { created: false };
  if (existsSync(envPath)) {
    console.log(`[setup-env] ${dir}/.env already exists, leaving it alone.`);
    return { created: false };
  }

  let contents = readFileSync(examplePath, 'utf8');

  if (fillJwtSecret) {
    const secret = randomBytes(48).toString('base64');
    const withSecret = contents.replace(/^JWT_SECRET=\s*$/m, `JWT_SECRET=${secret}`);
    if (withSecret === contents) {
      console.warn(
        `[setup-env] Could not find an empty JWT_SECRET= line in ${dir}/.env.example — ` +
          `wrote ${dir}/.env without a generated secret. Set JWT_SECRET yourself before starting the API.`,
      );
    }
    contents = withSecret;
  }

  writeFileSync(envPath, contents);
  console.log(`[setup-env] Created ${dir}/.env${fillJwtSecret ? ' with a generated JWT_SECRET' : ''}.`);
  return { created: true };
}

const api = setupEnv('api', { fillJwtSecret: true });
setupEnv('network-monitoring-ui');

if (api.created) {
  console.log(
    '[setup-env] Check api/.env — DATABASE_URL still has the placeholder password until you point it at your Postgres instance.',
  );
}
