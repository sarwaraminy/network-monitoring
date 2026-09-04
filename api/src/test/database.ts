import pg from 'pg';

/**
 * A real Postgres, for the tests whose subject IS the SQL.
 *
 * Most of this suite deliberately needs no database: decoders, detectors and
 * guards are pure, and mocking a database to assert what SQL would do only ever
 * tests the mock. But the parts that are genuinely SQL — aggregate a day and
 * delete it in one transaction, a trigger that refuses an UPDATE, a role check
 * that has to read a user row — cannot be covered that way at all. Those were
 * verified by a probe run once by hand and then trusted, and retention alone
 * shipped four real SQL bugs that review caught and no test could have: timezone
 * bucketing, partial-day over-deletion, the rollup filter, and sweep
 * concurrency. This is what turns those probes into standing tests.
 *
 * ---------------------------------------------------------------------------
 * SKIPPING, AND WHY IT IS NOT ALLOWED TO BE SILENT
 *
 * A contributor with no Postgres running should still be able to run `npm test`
 * and get a useful answer, so these suites skip when no database answers.
 *
 * A skip that CI also honours is worse than no test at all, and this repository
 * has the scar: `test-glob.test.ts` exists because a quoted-glob bug ran 456 of
 * 496 tests under a green tick for as long as the script had existed, and the
 * 40 it dropped were the attack simulations. "Nothing failed" and "nothing ran"
 * look identical from the outside.
 *
 * So the skip is conditional on nobody having said it matters. Set
 * `REQUIRE_DB_TESTS=1` — CI does — and an unreachable database is a hard error
 * naming what it could not reach, rather than a suite that quietly evaporates.
 * `ci-requires-database.test.ts` is the standing check that CI still sets it.
 */

/** The suffix that marks a database as disposable. See `resolveTestUrl`. */
const TEST_DB_SUFFIX = '_test';

/**
 * Where the tests connect — and, more importantly, where they refuse to.
 *
 * `truncateAll` empties every application table, so pointing this at a
 * developer's dev database would delete their data on the next `npm test`. An
 * explicit `TEST_DATABASE_URL` is used as given; otherwise the URL is DERIVED
 * from `DATABASE_URL` by suffixing the database NAME, reusing credentials that
 * already work locally without ever reusing the database itself.
 *
 * Either way the name must end in `_test`. That rail is worth more than the
 * convenience: the cost of getting this wrong is somebody else's data, and a
 * suffix check is the one thing that cannot be talked past by a misconfigured
 * environment.
 */
function resolveTestUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) return `postgres://postgres:postgres@127.0.0.1:5432/netmonitoring${TEST_DB_SUFFIX}`;

  try {
    const url = new URL(configured);
    // pathname is `/name`; an empty one means the server's default database,
    // which is somebody else's too.
    const name = url.pathname.replace(/^\//, '') || 'netmonitoring';
    url.pathname = `/${name.endsWith(TEST_DB_SUFFIX) ? name : `${name}${TEST_DB_SUFFIX}`}`;
    return url.toString();
  } catch {
    return `postgres://postgres:postgres@127.0.0.1:5432/netmonitoring${TEST_DB_SUFFIX}`;
  }
}

const TEST_DATABASE_URL = resolveTestUrl();

/** The database name in a connection string, or null if it has none. */
function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

/** Set by CI. Turns "no database" from a skip into a failure. */
const REQUIRED = process.env.REQUIRE_DB_TESTS === '1';

/** How long to wait for a database to answer before calling it absent. */
const CONNECT_TIMEOUT_MS = 3_000;

export interface TestDatabase {
  /** Pass to `describe(name, { skip })`. `false` when the database is usable. */
  skip: false | string;
  pool: pg.Pool | null;
}

/**
 * Truncates every table the application owns, leaving the schema and the
 * migration ledger alone.
 *
 * Discovered from `information_schema` rather than listed here, because a list
 * goes stale the moment a migration adds a table — and the failure mode of a
 * stale list is a test polluted by a previous test's rows, which presents as a
 * flake rather than as an omission.
 *
 * `RESTART IDENTITY CASCADE` so sequences restart too: a test asserting on an id
 * it just inserted should not depend on how many tests ran before it.
 */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT quote_ident(tablename) AS name
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN ('schema_migrations', 'flyway_schema_history')`,
  );
  if (rows.length === 0) return;

  /*
   * Some of this schema refuses to be emptied, on purpose.
   *
   * `audit_events` carries a BEFORE TRUNCATE trigger, because an append-only
   * record that can be truncated is not append-only — the migration says so and
   * means it. A test harness is the one context where that has to be suspended,
   * and it is suspended for exactly the length of this statement.
   *
   * The triggers are DISCOVERED, not named. A hardcoded list is the same staleness
   * problem as a hardcoded table list one comment up: the next append-only table
   * would break every suite with an error about a trigger nobody had heard of. The
   * bit test is Postgres's own `TRIGGER_TYPE_TRUNCATE`.
   *
   * `session_replication_role = replica` would be one line instead of these
   * three queries, but it disables every trigger in the session including foreign
   * keys, and it needs superuser — so it would work in CI, work for a developer
   * running as `postgres`, and fail for anyone with a properly scoped test role.
   */
  const { rows: truncateBlockers } = await pool.query<{ table: string; trigger: string }>(
    `SELECT quote_ident(c.relname) AS table, quote_ident(t.tgname) AS trigger
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND (t.tgtype & 32) <> 0`,
  );

  const list = rows.map((row) => row.name).join(', ');
  for (const blocker of truncateBlockers) {
    await pool.query(`ALTER TABLE ${blocker.table} DISABLE TRIGGER ${blocker.trigger}`);
  }
  try {
    await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  } finally {
    // In a `finally`, because leaving a guarantee switched off after a failed
    // truncate would let a later suite "prove" the audit trail is append-only
    // against a table where nothing is enforcing it.
    for (const blocker of truncateBlockers) {
      await pool.query(`ALTER TABLE ${blocker.table} ENABLE TRIGGER ${blocker.trigger}`);
    }
  }
}

/**
 * Connects, migrates, and hands back either a usable pool or a reason to skip.
 *
 * Migrations run through the application's own `runMigrations`, not a schema
 * dump: a test database built a different way would be testing a schema nobody
 * deploys, and the migrations are themselves one of the things worth exercising.
 *
 * `DATABASE_URL` is set from the test URL before that import, because
 * `db/index.ts` builds its pool from `env.ts` at module load and `env.ts` reads
 * `process.env` once.
 */
export async function openTestDatabase(): Promise<TestDatabase> {
  process.env.JWT_SECRET ??= 'db-test-secret-not-used-for-signing';

  /*
   * The rail, checked before anything connects.
   *
   * `truncateAll` runs between tests. A misconfigured `TEST_DATABASE_URL` — a
   * copy-pasted production string, an `.env` that leaked in — would empty it.
   * This is deliberately not a warning: there is no useful degraded mode where
   * the tests run against a database whose name says it is not disposable.
   */
  const name = databaseName(TEST_DATABASE_URL);
  if (name === null || !name.endsWith(TEST_DB_SUFFIX)) {
    throw new Error(
      `Refusing to run database tests against "${name ?? '(no database named)'}": these truncate every ` +
        `table, so the database name must end in "${TEST_DB_SUFFIX}". Set TEST_DATABASE_URL to a disposable database.`,
    );
  }

  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const pool = new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // A pool emits errors on idle clients as well as on queries; without a
  // listener one of those is an unhandled 'error' event and takes the process
  // down with a stack that says nothing about which test was running.
  pool.on('error', () => {});

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    // `3D000` is "database does not exist", which is the ordinary state of a
    // fresh clone rather than a misconfiguration — and the name has already been
    // checked to end in `_test`, so creating it cannot land on anything of
    // anyone's. `ensure-db.mjs` provisions the dev database on the same
    // reasoning; asking a contributor to run a CREATE DATABASE by hand before
    // the suite will speak to them is a step that only exists to be forgotten.
    if ((error as { code?: string }).code === '3D000' && (await createDatabase(name))) {
      return finishOpening(pool);
    }
    await pool.end().catch(() => {});
    const why = `no Postgres at ${redact(TEST_DATABASE_URL)}: ${(error as Error).message}`;
    if (REQUIRED) {
      // REQUIRE_DB_TESTS is a promise that these ran. Breaking it loudly is the
      // entire point — see the docblock.
      throw new Error(
        `REQUIRE_DB_TESTS=1 but ${why}. Start Postgres, or unset REQUIRE_DB_TESTS to skip these suites.`,
      );
    }
    return { skip: `${why} (set REQUIRE_DB_TESTS=1 to make this a failure)`, pool: null };
  }

  return finishOpening(pool);
}

/**
 * Migrate, empty, hand back.
 *
 * Shared by the ordinary path and the create-then-retry one, so a freshly
 * created database is prepared exactly like a pre-existing one rather than by a
 * second copy of these three lines that can drift.
 */
async function finishOpening(pool: pg.Pool): Promise<TestDatabase> {
  const { runMigrations } = await import('../db/migrate.js');
  await runMigrations();
  await truncateAll(pool);
  return { skip: false, pool };
}

/**
 * Creates the test database through the server's maintenance database.
 *
 * Returns false rather than throwing when it cannot — the caller then reports
 * the ORIGINAL connection failure, which is the more useful of the two: "no
 * Postgres at ..." tells a contributor what to start, where "permission denied
 * to create database" would send them off fixing a role grant they may not need.
 */
async function createDatabase(name: string): Promise<boolean> {
  const maintenance = new URL(TEST_DATABASE_URL);
  maintenance.pathname = '/postgres';

  const admin = new pg.Pool({
    connectionString: maintenance.toString(),
    max: 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  admin.on('error', () => {});

  try {
    // CREATE DATABASE takes no parameters, so the name is quoted as an
    // identifier by the server. `name` is derived from a connection string
    // rather than from anything a request supplies, and has already had to end
    // in `_test`, but quoting it is what makes that reasoning unnecessary.
    const { rows } = await admin.query<{ quoted: string }>('SELECT quote_ident($1) AS quoted', [name]);
    await admin.query(`CREATE DATABASE ${rows[0]!.quoted}`);
    return true;
  } catch {
    return false;
  } finally {
    await admin.end().catch(() => {});
  }
}

/** A connection string with its password removed, for an error message. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password !== '') parsed.password = '***';
    return parsed.toString();
  } catch {
    // Not URL-shaped. Say nothing rather than risk printing a credential.
    return '<the configured database>';
  }
}
