import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { componentLogger } from '../logger.js';
import { closeDb, pool } from './index.js';

const log = componentLogger('migrate');

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_TABLE = 'schema_migrations';
const FLYWAY_TABLE = 'flyway_schema_history';

interface Migration {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

/** Works both from src/ (tsx) and from dist/ (compiled, SQL copied alongside). */
function migrationsDir(): string {
  const candidates = [join(HERE, 'migrations'), resolve(HERE, '../../src/db/migrations')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Could not locate migrations directory. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

/**
 * Reads `V<version>__<name>.sql` files, matching the Flyway naming convention the
 * Spring Boot app used, and orders them by numeric version.
 */
async function loadMigrations(): Promise<Migration[]> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql'));

  const migrations: Migration[] = [];
  for (const file of files) {
    const match = /^V(\d+(?:[._]\d+)*)__(.+)\.sql$/.exec(file);
    if (!match) {
      log.warn({ file }, 'Skipping file: not named V<version>__<name>.sql');
      continue;
    }
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({
      version: match[1]!,
      name: match[2]!.replace(/_/g, ' '),
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }

  return migrations.sort((a, b) => compareVersions(a.version, b.version));
}

function compareVersions(a: string, b: string): number {
  const left = a.split(/[._]/).map(Number);
  const right = b.split(/[._]/).map(Number);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [
    table,
  ]);
  return rows[0]?.exists ?? false;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version    TEXT PRIMARY KEY,
      name       TEXT        NOT NULL,
      checksum   TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * A database created by the old Spring Boot app already has the tables and a
 * `flyway_schema_history` row per migration. Import those versions (or, failing
 * that, infer from the presence of `users`) so we never re-run a CREATE TABLE.
 */
async function baselineFromExistingDatabase(client: PoolClient, migrations: Migration[]): Promise<void> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${MIGRATION_TABLE}`,
  );
  if (Number(rows[0]?.count ?? '0') > 0) return;

  let appliedVersions: string[] = [];

  if (await tableExists(client, FLYWAY_TABLE)) {
    const flyway = await client.query<{ version: string | null }>(
      `SELECT version FROM ${FLYWAY_TABLE} WHERE success = true AND version IS NOT NULL`,
    );
    appliedVersions = flyway.rows.map((row) => row.version!).filter(Boolean);
    if (appliedVersions.length > 0) {
      log.info({ versions: appliedVersions.length, table: FLYWAY_TABLE }, 'Adopting Flyway history');
    }
  } else if (await tableExists(client, 'users')) {
    appliedVersions = migrations.map((migration) => migration.version);
    log.info('Existing schema without Flyway history; baselining all migrations as applied');
  }

  for (const version of appliedVersions) {
    const migration = migrations.find((candidate) => candidate.version === version);
    await client.query(
      `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum) VALUES ($1, $2, $3)
       ON CONFLICT (version) DO NOTHING`,
      [version, migration?.name ?? 'baselined', migration?.checksum ?? 'baselined'],
    );
  }
}

export async function runMigrations(): Promise<void> {
  const migrations = await loadMigrations();
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    await baselineFromExistingDatabase(client, migrations);

    const { rows: applied } = await client.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM ${MIGRATION_TABLE}`,
    );
    const appliedByVersion = new Map(applied.map((row) => [row.version, row.checksum]));

    let ran = 0;
    for (const migration of migrations) {
      const existingChecksum = appliedByVersion.get(migration.version);

      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum && existingChecksum !== 'baselined') {
          log.warn(
            { version: migration.version, file: migration.file },
            'Checksum mismatch: the file changed after it was applied; database left untouched',
          );
        }
        continue;
      }

      log.info({ version: migration.version, name: migration.name }, 'Applying migration');
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${MIGRATION_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`, [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        ran += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration V${migration.version} (${migration.file}) failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    }

    log.info({ applied: ran }, ran === 0 ? 'Database already up to date' : 'Migrations applied');
  } finally {
    client.release();
  }
}

// `npm run migrate` runs this file directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      log.fatal({ err: error }, 'Migration failed');
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
