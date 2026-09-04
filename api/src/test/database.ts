import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

/*
 * `api/.env` before anything reads `process.env`.
 *
 * This is where the repository actually keeps `DATABASE_URL`, with a generated
 * password — so without this the derivation below had nothing to derive from,
 * the hardcoded `postgres:postgres` fallback could not stand in for it, and on a
 * developer machine set up exactly as CONTRIBUTING describes every suite here
 * skipped. Green, and nothing had run: the precise failure this file's own
 * docblock is about.
 *
 * `env.ts` does the same thing, and is not reused for it: it also constructs the
 * pool, and importing it here would build a connection to the application's own
 * database before the `_test` rail below has had a chance to refuse anything.
 */
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
dotenv.config();

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
 * And the runner gives no hint either. A skipped `describe` never registers its
 * tests, so the summary reports `skipped 0` and simply counts lower — 543 rather
 * than 555 here, a difference nobody has a second source for. That is the same
 * shape as the glob bug exactly: a number that looks fine unless you already knew
 * what it should be.
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
 * `truncateAll` empties every application table, so this must never be a
 * database anyone wants. Two paths, and they are deliberately different:
 *
 *  - **`TEST_DATABASE_URL` is honoured EXACTLY as given.** An explicit setting is
 *    somebody saying "this database", and quietly connecting somewhere else is
 *    both surprising and a real failure: the previous version rewrote it into a
 *    per-suite name that the workflow had not provisioned, so CI went looking for
 *    a database nobody had created. Isolation between suites is then the
 *    operator's problem, which is the honest trade for "use exactly this".
 *  - **Otherwise the name is DERIVED** from `DATABASE_URL` — reusing credentials
 *    that already work locally without ever reusing the database — with a
 *    per-suite `_<id>_test` name so parallel files cannot truncate each other.
 *    That derivation is why CI supplies `DATABASE_URL` rather than
 *    `TEST_DATABASE_URL`; see the workflow.
 *
 * The name must end in `_test` either way, and where that check has teeth is the
 * explicit path: a pasted production URL is refused there rather than truncated.
 * On the derived path the suffix is added by construction, so the check cannot
 * fail — what protects that path instead is that the configured database is
 * never itself touched, only a new sibling beside it. Worth being plain about
 * the limit: a production `DATABASE_URL` still results in a stray empty database
 * created on that server, and no name check can tell prod from dev.
 *
 * Per-suite isolation is not tidiness. `node:test` runs test FILES in parallel,
 * and each suite truncates every table between its own tests — so sharing one
 * database means one file wiping another's fixtures mid-run, surfacing as a
 * retention assertion failing on a row count that was right when it was written.
 * Two files migrating the same empty database at once is available too, since
 * `migrate.ts` takes no lock.
 */
function resolveTestUrl(id: string): { url: string; derived: boolean } {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return { url: explicit, derived: false };

  // `_<id>_test`, so each suite gets its own and every name still carries the
  // suffix the rail insists on.
  const own = (name: string) =>
    `${name.replace(new RegExp(`${TEST_DB_SUFFIX}$`), '')}_${id}${TEST_DB_SUFFIX}`;
  const fallback = {
    url: `postgres://postgres:postgres@127.0.0.1:5432/${own('netmonitoring')}`,
    derived: true,
  };

  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    // pathname is `/name`; an empty one means the server's default database,
    // which is somebody else's too.
    url.pathname = `/${own(url.pathname.replace(/^\//, '') || 'netmonitoring')}`;
    return { url: url.toString(), derived: true };
  } catch {
    return fallback;
  }
}

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
/**
 * Rows the migrations put there, captured once before any test runs.
 *
 * `TRUNCATE` removes them and `runMigrations` will not put them back — V7 stays
 * recorded as applied, so its `delivery_settings` row is gone for the rest of the
 * process. A suite touching delivery settings then exercises the "no row to
 * update" branch, which cannot occur in production where the migration
 * guarantees the row. A test passing against that is asserting the wrong
 * behaviour; one failing against it is chasing a state that does not exist.
 *
 * Captured rather than listed, so a future migration that seeds a row is
 * restored without anyone remembering to come here — the same reason the table
 * list itself is discovered.
 */
const seededRows = new Map<pg.Pool, Map<string, Record<string, unknown>[]>>();

async function captureSeed(pool: pg.Pool, tables: string[]): Promise<void> {
  const captured = new Map<string, Record<string, unknown>[]>();
  for (const table of tables) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    if (rows.length > 0) captured.set(table, rows);
  }
  seededRows.set(pool, captured);
}

/** Re-inserts what `captureSeed` saw, leaving the database as migrations left it. */
async function restoreSeed(pool: pg.Pool): Promise<void> {
  for (const [table, rows] of seededRows.get(pool) ?? []) {
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      await pool.query(
        `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')})
         VALUES (${placeholders})`,
        columns.map((column) => row[column]),
      );
    }
  }
}

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
  try {
    // INSIDE the try, not before it. Outside, a second `ALTER TABLE` that threw
    // left the first trigger disabled and skipped the `finally` entirely — the
    // connection went back to the pool with the audit trail's append-only
    // guarantee switched off for every later test in the process. That is
    // precisely what the comment below says must not happen, and the guard did
    // not cover the window in which the triggers are taken down.
    for (const blocker of truncateBlockers) {
      await pool.query(`ALTER TABLE ${blocker.table} DISABLE TRIGGER ${blocker.trigger}`);
    }
    await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    await restoreSeed(pool);
  } finally {
    // In a `finally`, because leaving a guarantee switched off after a failed
    // truncate would let a later suite "prove" the audit trail is append-only
    // against a table where nothing is enforcing it. Re-enabling a trigger that
    // was never disabled is a no-op, so this is safe however far the loop above
    // got.
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
export interface OpenOptions {
  /**
   * Names this suite's own database, e.g. `retention` -> `..._retention_test`.
   *
   * Required rather than defaulted, because a default would silently put two
   * suites back in one database — the failure this exists to prevent, returning
   * as a flake nobody attributes to the harness.
   */
  id: string;
  /**
   * A session `TimeZone` for every connection, including the application's own.
   *
   * The reason this exists rather than being a `SET` a test could issue: the
   * timezone bug this repository shipped was `date_trunc('day', ts)` resolving
   * in the SESSION's zone, so it is invisible on a server set to UTC — which is
   * every CI runner and most developer machines. A test that cannot choose the
   * session zone cannot reproduce it, and would pass against the bug.
   *
   * Passed through the connection string as a libpq `options` parameter so it
   * applies to pooled connections the application opens for itself, not only to
   * ones the test holds.
   */
  sessionTimeZone?: string;
}

export async function openTestDatabase(options: OpenOptions): Promise<TestDatabase> {
  process.env.JWT_SECRET ??= 'db-test-secret-not-used-for-signing';
  const { url: TEST_DATABASE_URL, derived } = resolveTestUrl(options.id);

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

  const url = options.sessionTimeZone
    ? withSessionTimeZone(TEST_DATABASE_URL, options.sessionTimeZone)
    : TEST_DATABASE_URL;
  process.env.DATABASE_URL = url;

  /*
   * A derived database is dropped and recreated, not reused.
   *
   * It persists between runs, so whatever the last run left behind is still
   * there — and `captureSeed` below would then capture THAT as the state
   * migrations produce, re-inserting a previous run's rows after every truncate.
   * That is not hypothetical: it collided on `users_pkey` the first time, because
   * `RESTART IDENTITY` sets the sequence back to 1 while the restored row still
   * held id 1.
   *
   * Only when the name was derived. An explicit `TEST_DATABASE_URL` is somebody
   * else's provisioning decision, and dropping a database we were pointed at
   * rather than one we invented is not ours to make.
   */
  if (derived) await recreateDatabase(TEST_DATABASE_URL, name);

  const pool = new pg.Pool({
    connectionString: url,
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
    let createFailure: string | undefined;
    if ((error as { code?: string }).code === '3D000') {
      const created = await createDatabase(TEST_DATABASE_URL, name);
      if (created.ok) return finishOpening(pool);
      createFailure = created.why;
    }
    await pool.end().catch(() => {});
    const why =
      `no Postgres at ${redact(TEST_DATABASE_URL)}: ${(error as Error).message}` +
      (createFailure ? ` (and creating it failed: ${createFailure})` : '');
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

  // Before the first truncate, so what migrations seeded is what gets restored
  // after every one of them.
  const { rows } = await pool.query<{ name: string }>(
    `SELECT quote_ident(tablename) AS name
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN ('schema_migrations', 'flyway_schema_history')`,
  );
  await captureSeed(
    pool,
    rows.map((row) => row.name),
  );

  await truncateAll(pool);
  return { skip: false, pool };
}

/**
 * Creates the test database through the server's maintenance database.
 *
 * Returns false when it cannot, and SAYS WHY. The previous version swallowed the
 * error on the reasoning that the original connection failure was the more useful
 * of the two — which is wrong for the case that actually happens: a role without
 * CREATEDB got "no Postgres at ...: database does not exist. Start Postgres", a
 * diagnosis pointing at the wrong problem entirely. The real error is appended to
 * the caller's message instead of replacing it, so both are available.
 */
async function recreateDatabase(url: string, name: string): Promise<void> {
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = new pg.Pool({
    connectionString: maintenance.toString(),
    max: 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  admin.on('error', () => {});
  try {
    const { rows } = await admin.query<{ quoted: string }>('SELECT quote_ident($1) AS quoted', [name]);
    // FORCE so a connection left open by a crashed previous run does not block
    // the drop; without it the failure is "database is being accessed by other
    // users", which reads as a permissions problem.
    await admin.query(`DROP DATABASE IF EXISTS ${rows[0]!.quoted} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${rows[0]!.quoted}`);
  } catch {
    // Best effort. If this fails the connection below fails too, with an error
    // that describes the actual problem rather than this one.
  } finally {
    await admin.end().catch(() => {});
  }
}

async function createDatabase(url: string, name: string): Promise<{ ok: boolean; why?: string }> {
  const maintenance = new URL(url);
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
    return { ok: true };
  } catch (error) {
    return { ok: false, why: (error as Error).message };
  } finally {
    await admin.end().catch(() => {});
  }
}

/** Adds `-c timezone=<zone>` to a connection string's startup options. */
function withSessionTimeZone(url: string, zone: string): string {
  const parsed = new URL(url);
  const existing = parsed.searchParams.get('options');
  parsed.searchParams.set('options', `${existing ? `${existing} ` : ''}-c timezone=${zone}`);
  return parsed.toString();
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
