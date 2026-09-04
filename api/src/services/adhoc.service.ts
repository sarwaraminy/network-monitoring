import { createHash } from 'node:crypto';
import pg from 'pg';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import { HttpError } from '../middleware/error-handler.js';

const log = componentLogger('adhoc');

/**
 * The Ad Hoc Query console: an administrator types SQL, gets a result grid.
 *
 * The whole design question is "what stops this being a superuser shell in a
 * browser tab", and the answer is deliberately not in this file. Enforcement is
 * the `nm_adhoc` role created in V10 — SELECT only, secrets excluded at the
 * column level — because app-side validation of SQL does not hold: a CTE can
 * carry DML, a comment or a string literal can hide a keyword, and `;` chains a
 * second statement onto the first. Postgres already gets all of that right.
 *
 * What IS in this file is everything the role cannot express:
 *
 *  - a **separate pool**, so a slow query cannot starve the pool that detection
 *    and alerting share. Two connections is not a limitation, it is the budget:
 *    an ad hoc console is one person asking one question.
 *  - a **statement timeout**, so a cartesian join stops instead of running until
 *    someone notices.
 *  - a **READ ONLY transaction**, which is the belt to the role's braces. A grant
 *    added carelessly by some future migration does not become a write path.
 *  - a **row cap**, applied with a cursor so the user's SQL is never rewritten.
 *  - a **boot-time self-test**, below, which is the part worth reading twice.
 */

/**
 * The console's role, named for the database it belongs to.
 *
 * DERIVED, never configured — that is the property `env.ts` argues for, and it
 * survives here: there is no setting that can point this at a superuser.
 *
 * Per DATABASE rather than one for the cluster, because roles are cluster-wide
 * while grants are not. V10 shared a single `nm_adhoc`, so its PASSWORD was
 * shared too — and the console sets that at boot. Whichever process started last
 * owned it, and every other one began failing with "password authentication
 * failed". On a developer machine that meant running the test suite, which
 * creates a database per suite and boots the console in each, logged the running
 * app out of its own query console. See V11.
 */
export function adhocRole(database: string): string {
  const full = `${ROLE_PREFIX}${database}`;
  if (Buffer.byteLength(full) <= MAX_IDENTIFIER_BYTES) return full;

  /*
   * Postgres truncates an over-long identifier SILENTLY at creation, so a plain
   * long name leaves the two sides naming different roles — and the error that
   * produces is close to unreadable: `connected as "nm_adhoc_netmonitoring_ad…",
   * expected "nm_adhoc_netmonitoring_ad…"`, two strings identical for as far as
   * anyone reads. `assertNotSuperuser` gets there first and blames V11 for not
   * having run, sending the operator to a migration that ran fine.
   *
   * Truncating alone would trade that for a worse bug: two long database names
   * cut to the same role, which is the shared-role collision V11 exists to
   * remove. So the over-long case is the prefix plus a hash of the WHOLE name,
   * and NOTHING is truncated — which is the second correction this needed. An
   * earlier version kept a readable slice of the name in front of the hash, and
   * that slice was taken in CHARACTERS while the budget is in BYTES: a database
   * name with any multibyte character came in under the character limit and over
   * the byte one, so Postgres truncated at CREATE ROLE while this kept the full
   * string, and startup failed claiming the role did not exist. A fixed-width
   * name cannot drift from the SQL that has to reproduce it.
   *
   * The readability that loses is bought back in V11, which sets a COMMENT on
   * the role naming the database it belongs to.
   *
   * `md5` because Postgres has it built in and this must be computable
   * identically on both sides. It is a naming device, not a security one.
   */
  return `${ROLE_PREFIX}${createHash('md5').update(database).digest('hex').slice(0, HASH_LENGTH)}`;
}

export interface AdhocColumn {
  name: string;
  /** Postgres type oid, so the UI can right-align numbers without guessing. */
  dataTypeId: number;
}

export interface AdhocResult {
  columns: AdhocColumn[];
  /**
   * POSITIONAL rows, lining up one-to-one with `columns`.
   *
   * Not objects keyed by column name, and the difference is a correctness one
   * rather than a preference. node-postgres builds object rows keyed on field
   * name, so two columns called `id` — `SELECT * FROM alerts JOIN known_devices`,
   * about as ordinary as ad hoc SQL gets — collapse into one property holding
   * whichever came last. The header row still shows both, so the grid renders
   * `id` twice, each showing the SECOND table's value, with the first table's
   * gone and nothing saying so. For a console whose entire value is that you can
   * trust what it prints, a wrong-but-plausible number is worse than an error.
   */
  rows: unknown[][];
  /** True when the cap stopped the read, so the UI can say so rather than imply completeness. */
  truncated: boolean;
  durationMs: number;
}

/**
 * Thrown for anything the operator should see verbatim — including Postgres's
 * own errors.
 *
 * Extends `HttpError`, and that is not a detail. `errorHandler` maps only
 * `HttpError` onto a status and a visible body; anything else falls through to
 * the 500 path, which in PRODUCTION replaces the message with "Internal server
 * error". Extending plain `Error` therefore switched off this whole feature's
 * error design exactly where it matters and nowhere a developer would see it:
 * `env.isProduction` is false in dev, so the real message passed through and
 * everything looked right. An operator with a typo got a 500 and no clue.
 */
export class AdhocError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = 'AdhocError';
  }
}

let pool: pg.Pool | null = null;

/** True once `startAdhoc` has proved the sandbox holds. */
export function adhocReady(): boolean {
  return pool !== null;
}

/**
 * Derives the console's connection from the application's own.
 *
 * The role name is fixed and only the credentials move, which is the point: an
 * `ADHOC_DATABASE_URL` that an operator could set would be an
 * `ADHOC_DATABASE_URL` an operator could point at `postgres`, silently turning
 * every control here off while the feature still appeared to work. There is no
 * spelling of the configuration that reaches a superuser.
 */
/** Postgres's `NAMEDATALEN - 1`. An identifier longer than this is truncated. */
const MAX_IDENTIFIER_BYTES = 63;
const ROLE_PREFIX = 'nm_adhoc_';
/** Hex characters of md5 kept. 9 + 16 = 25 bytes, comfortably inside the limit. */
const HASH_LENGTH = 16;

function adhocConnectionString(role: string, password: string): string {
  const url = new URL(env.databaseUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

/**
 * Brings the console up, or refuses to.
 *
 * Three things happen, and the third is the one that matters. The role is given
 * the configured password (V10 creates it NOLOGIN and passwordless, because a
 * password does not belong in a committed migration); a pool is opened as that
 * role; and then the sandbox is TESTED rather than assumed.
 *
 * The self-test exists because every control in this file and in V10 is invisible
 * when it fails. A migration that did not run, a grant an operator "fixed", a
 * role that was recreated by hand as a superuser — each leaves a console that
 * works perfectly and is wide open, and nothing about the screen looks different.
 * So the console proves it is sandboxed at boot: not a superuser, cannot write.
 * If either check does not come back the way it must, the feature stays off and
 * says why. Failing closed is the only safe direction here, and a feature that
 * quietly did not start is a smaller problem than one that quietly did.
 */
export async function startAdhoc(owner: pg.Pool): Promise<boolean> {
  if (!env.adhoc.enabled) return false;

  const password = env.adhoc.password;
  if (!password) {
    log.warn('ADHOC_ENABLED is set but ADHOC_DB_PASSWORD is empty; the query console stays off');
    return false;
  }

  // Declared out here so the catch can name it, resolved INSIDE the try. Every
  // other failure in this function is downgraded to "stays off" — that is the
  // whole reason it returns a boolean — and a query sitting above the try broke
  // that posture: a transient connection blip at this exact moment propagated
  // out of `startAdhoc`, past an `index.ts` that does not guard the call, into
  // `main()`'s catch and `process.exit(1)`. The entire API taken down over an
  // optional feature that is off by default.
  let role = '';
  /*
   * Whether the LOGIN was actually granted, which `role !== ''` does NOT say.
   *
   * `role` is assigned before `assertNotSuperuser` runs, so every failure after
   * the lookup and before the ALTER reached the revert with a non-empty role —
   * and both outcomes were wrong in the superuser case this exists for. Either
   * the role does not exist and the revert fails too, reporting "do it by hand"
   * about a role that was never there; or it exists, is a superuser, and the
   * code correctly declines to provision it and then strips LOGIN from it
   * anyway. Refusing to touch somebody else's role was the entire point.
   */
  let granted = false;

  try {
    // Asked of the connection rather than parsed out of the URL, so the role
    // always matches the database the migrations actually ran against.
    const { rows: current } = await owner.query<{ name: string }>('SELECT current_database() AS name');
    role = adhocRole(current[0]!.name);

    /*
     * The superuser check comes FIRST, before this role is given a way to log in.
     *
     * Granting LOGIN and a password and then proving the sandbox is inverted in
     * exactly the case the proof exists for: if someone has recreated `nm_adhoc`
     * as a superuser, the old order handed that superuser a working login and a
     * password from the environment, and then logged that the console "stays
     * off". A startup that was meant to refuse had instead provisioned
     * credentials. This one is answerable through the owner's connection without
     * the role being able to log in at all.
     */
    await assertNotSuperuser(owner, role);

    // As the owner, because the role cannot set its own password before it can
    // log in. `format(%L)` rather than interpolation: the password comes from
    // the environment, but a password containing a quote should change nothing.
    const { rows } = await owner.query<{ statement: string }>(
      `SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS statement`,
      [role, password],
    );

    /*
     * Run with statement logging off for the duration, because the password is
     * in the statement TEXT.
     *
     * `ALTER ROLE` has no parameterised form — the value has to be part of the
     * statement — so under `log_statement = 'ddl'` or `'all'`, both ordinary on
     * a server anyone is watching, the password would be written to the Postgres
     * log verbatim. `log_min_error_statement` catches it on failure too, and its
     * default is low enough to do so. Quoting it correctly, which `%L` does, is
     * a different problem from keeping it out of the log.
     *
     * `SET LOCAL` so it lasts exactly this transaction. Best effort: the setting
     * is superuser-only, and an owner without that privilege should still get a
     * working console rather than a hard failure — hence the swallow, and hence
     * the note in `env.ts` telling an operator this password reaches the server
     * log if their role cannot suppress it.
     */
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL log_statement = 'none'`).catch(() => {});
      await client.query(`SET LOCAL log_min_error_statement = 'panic'`).catch(() => {});
      await client.query(rows[0]!.statement);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    granted = true;

    const candidate = new pg.Pool({
      connectionString: adhocConnectionString(role, password),
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    candidate.on('error', (error) => log.error({ err: error }, 'Idle ad hoc client error'));

    try {
      await proveSandbox(candidate, role);
    } catch (error) {
      // The candidate is a LOCAL: nothing else holds it, and `stopAdhoc` reads
      // the module-level `pool`, which is never assigned on this path. Without
      // this its connections stay open until the 30s idle timeout — against a
      // role that has just failed its safety check, and in the test suite it is
      // what keeps the process from exiting.
      await candidate.end().catch(() => {});
      throw error;
    }
    pool = candidate;
    log.info({ role }, 'Ad hoc query console enabled');
    return true;
  } catch (error) {
    log.error({ err: error }, 'Ad hoc query console failed its safety checks and stays off');
    pool = null;
    /*
     * Take the login away again. Anything that fails after the ALTER above
     * leaves a role that can authenticate with a password from the environment
     * and a console that is switched off — credentials nobody is watching. Best
     * effort, and logged if it fails, because there is nothing further this
     * process can do about it.
     */
    // `role` is empty only if the lookup above was what failed, in which case
    // nothing was granted and there is nothing to take back.
    if (granted) await revokeLogin(owner, role);
    return false;
  }
}

/**
 * Refuses a superuser `nm_adhoc`, asked through the OWNER's connection.
 *
 * Separate from `proveSandbox` because it has to run before the role can log in
 * — see `startAdhoc`. A superuser bypasses every grant in V10 with no error to
 * notice, so this is the one check that must never be reached late.
 */
async function assertNotSuperuser(owner: pg.Pool, role: string): Promise<void> {
  const { rows } = await owner.query<{ superuser: boolean }>(
    'SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = $1',
    [role],
  );
  if (rows.length === 0) throw new Error(`role ${role} does not exist; has V11 run on this database?`);
  if (rows[0]!.superuser) {
    throw new Error(`"${role}" is a superuser; every restriction on the console is void`);
  }
}

/**
 * Refuses to enable the console unless the database agrees it is caged.
 *
 * Both checks are about the same worry from two sides: "is this connection
 * actually the limited role we think it is". A superuser bypasses every grant in
 * V10 without any error to notice, and a role that can write is one an operator
 * has re-granted since.
 */
async function proveSandbox(candidate: pg.Pool, role: string): Promise<void> {
  const { rows } = await candidate.query<{ superuser: boolean; who: string }>(
    'SELECT rolsuper AS superuser, current_user AS who FROM pg_roles WHERE rolname = current_user',
  );
  const identity = rows[0];
  if (!identity) throw new Error('could not read the ad hoc role from pg_roles');
  if (identity.who !== role) {
    throw new Error(`connected as "${identity.who}", expected "${role}"`);
  }
  if (identity.superuser) {
    throw new Error(`"${role}" is a superuser; every restriction on the console is void`);
  }

  /*
   * Two real attempts, because `rolsuper` being false does not by itself prove
   * the grants are what V10 wrote.
   *
   * The second one is the important addition. Checking only that writes are
   * refused leaves the COLUMN-level revokes unverified, and those are the grants
   * most likely to be undone by accident — an operator debugging a permissions
   * problem runs `GRANT SELECT ON ALL TABLES IN SCHEMA public TO nm_adhoc`, the
   * role is still not a superuser and still cannot write, both old probes pass,
   * and the console starts with every secret column in the database readable
   * from a browser session. This file's own docblock already reasons about
   * someone having "re-granted since"; this is that case.
   */
  await mustBeRefused(
    candidate,
    `INSERT INTO alerts (kind, severity, title, description, dedup_key, first_seen, last_seen)
     VALUES ('adhoc_probe', 'low', 'probe', 'probe', 'adhoc-probe', now(), now())`,
    'the ad hoc role was able to INSERT; it is not read-only',
  );
  await mustBeRefused(
    candidate,
    'SELECT password FROM users LIMIT 1',
    'the ad hoc role can read users.password; the column grants from V10 are not in force',
  );
}

/** Runs `sql` inside a rolled-back transaction and insists Postgres refuses it. */
async function mustBeRefused(candidate: pg.Pool, sql: string, complaint: string): Promise<void> {
  const client = await candidate.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    throw new Error(complaint);
  } catch (error) {
    // `42501` is insufficient_privilege — the answer these probes want. Anything
    // else is a real failure and is rethrown, including the complaint above.
    if ((error as { code?: string }).code !== '42501') throw error;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/**
 * Closes this process's console. Deliberately does NOT revoke the login.
 *
 * The last round's fix put a NOLOGIN here, and that was wrong for the reason
 * that only shows up with more than one instance: the role is per DATABASE, not
 * per process, and `ALTER ROLE … NOLOGIN` takes effect immediately for everyone.
 * Two API instances against one database — a rolling deploy, or an HA pair — and
 * the one shutting down would disable the other's console mid-flight. Worse, the
 * survivor cannot tell: its pool object is intact, so `adhocReady()` still says
 * yes and the page keeps offering a console whose every query fails to
 * authenticate.
 *
 * Nothing this process knows can distinguish "the last instance" from "one of
 * several", so it does not guess. The login is revoked where that IS knowable:
 * at boot when the feature is switched off, and on the failure path, which is
 * this process undoing something it just did.
 *
 * That leaves the test suite, whose need to leave the cluster as it found it is
 * real — it boots the console with a password committed in the repository. It
 * calls `revokeAdhocLogin` directly in its teardown, which is the honest place
 * for cleanup that is a test's concern rather than a shutdown's.
 */
export async function stopAdhoc(): Promise<void> {
  const closing = pool;
  pool = null;
  await closing?.end().catch(() => {});
}

/**
 * Takes the console role's login away. For teardown that owns the whole cluster.
 *
 * Exported for the test suite — see `stopAdhoc` for why a production shutdown
 * must not do this. Resolves the role from the connection, so a caller does not
 * have to reproduce the naming rule.
 */
export async function revokeAdhocLogin(owner: pg.Pool): Promise<void> {
  const { rows } = await owner.query<{ name: string }>('SELECT current_database() AS name');
  await revokeLogin(owner, adhocRole(rows[0]!.name));
}

/** `ALTER ROLE … NOLOGIN`, the one statement both teardown paths need. */
async function revokeLogin(owner: pg.Pool, role: string): Promise<void> {
  await owner
    .query('SELECT format($$ALTER ROLE %I NOLOGIN$$, $1::text) AS statement', [role])
    .then((result) => owner.query(result.rows[0]!.statement))
    .catch((error) => log.error({ err: error }, `Could not revoke LOGIN from ${role}; do it by hand`));
}

/**
 * Everything that can be refused before the query is recorded or run.
 *
 * Exported so the route can call it BEFORE writing to the audit trail. Auditing
 * first meant `env.adhoc.maxLength` was not what bounded the recorded text — the
 * 1 MB JSON body limit was, so a caller could put fifty times the accepted
 * length into `audit_events` on a request that was always going to be rejected.
 * It also wrote an `adhoc.query` row for every POST while the console was
 * switched off, so an installation that never enabled the feature still
 * accumulated entries for it.
 *
 * Returns the trimmed query, so the caller records what would actually run.
 */
export function assertRunnable(sql: unknown): string {
  if (!pool) throw new AdhocError('The query console is not enabled on this server.', 503);
  if (typeof sql !== 'string') throw new AdhocError('Send the query as a `sql` string.');

  const trimmed = sql.trim();
  if (trimmed === '') throw new AdhocError('Enter a query to run.');
  if (trimmed.length > env.adhoc.maxLength) {
    throw new AdhocError(`Queries are limited to ${env.adhoc.maxLength} characters.`);
  }
  return trimmed;
}

/**
 * Runs one statement and returns at most `env.adhoc.maxRows` rows.
 *
 * The cap is applied with a CURSOR rather than by wrapping the query in
 * `SELECT * FROM (...) LIMIT n`. Wrapping changes the user's SQL — it breaks
 * anything already ending in its own LIMIT or ORDER BY inside a UNION, and it
 * turns a syntax error in their query into a confusing error about ours. A
 * cursor caps the READ instead, leaving the statement exactly as typed.
 *
 * A `;`-chained second statement is REFUSED, and how is worth writing down
 * because two plausible mechanisms do not work. `values: []` does not push
 * node-postgres onto the extended protocol (which carries one statement) — it
 * still sends the string whole. And the cursor does not make it a syntax error,
 * which an earlier version of this comment claimed: `DECLARE c CURSOR FOR
 * SELECT 1; SELECT 2` parses as a DECLARE followed by a SELECT and runs both.
 * Both were found by the test below rather than by reading, which is the
 * argument for the test.
 *
 * What does work is that the driver reports it: more than one statement comes
 * back as an ARRAY of results rather than one. So the chained statement is
 * detected after the fact and the whole transaction is rolled back.
 *
 * Detection rather than prevention is proportionate HERE and nowhere else: the
 * second statement runs as a role that can only SELECT non-secret columns inside
 * a read-only transaction, so there is no damage to prevent. The reason to
 * refuse is honesty — a console that ran two statements and showed one result
 * would be lying about what it did.
 */
export async function runAdhocQuery(sql: string): Promise<AdhocResult> {
  const trimmed = assertRunnable(sql);
  // `assertRunnable` has already refused a null pool; re-reading it here is what
  // narrows the type, and it also closes the window where `stopAdhoc` runs
  // between the check and the connect.
  const running = pool;
  if (!running) throw new AdhocError('The query console is not enabled on this server.', 503);

  const started = Date.now();
  const client = await running.connect();
  try {
    // READ ONLY on the transaction, not just on the role: two independent things
    // have to be wrong before a write reaches this database.
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${env.adhoc.timeoutMs}`);
    // Nothing here should ever wait on another transaction's lock; if it does,
    // the answer is "no" rather than a console that hangs holding a connection.
    await client.query('SET LOCAL lock_timeout = 1000');

    const declared = await client.query(`DECLARE adhoc_result NO SCROLL CURSOR FOR ${trimmed}`);
    if (Array.isArray(declared)) {
      throw new AdhocError('Run one statement at a time — the query contains more than one.');
    }
    // One more than the cap, so "there were more" is knowable without counting
    // the whole result — which is the thing the cap exists to avoid doing.
    // `rowMode: 'array'` for the reason in `AdhocResult.rows`: positional rows
    // cannot collide on a repeated column name.
    const result = await client.query({
      text: `FETCH ${env.adhoc.maxRows + 1} FROM adhoc_result`,
      rowMode: 'array',
    });

    const truncated = result.rows.length > env.adhoc.maxRows;
    return {
      columns: result.fields.map((field) => ({ name: field.name, dataTypeId: field.dataTypeID })),
      rows: truncated ? result.rows.slice(0, env.adhoc.maxRows) : result.rows,
      truncated,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    // Ours already says exactly what happened; only driver errors need translating.
    throw error instanceof AdhocError ? error : translate(error);
  } finally {
    // Always ROLLBACK: the transaction is read-only, so there is nothing to
    // commit, and rolling back releases the cursor and any locks in one step.
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/**
 * Turns a driver error into something an operator can act on.
 *
 * Postgres's own messages are kept, because they are better than anything this
 * layer could write: "permission denied for table users" tells an administrator
 * exactly what happened and why, and hiding it behind "query failed" would leave
 * them guessing at a restriction that is deliberate and documented.
 *
 * The two codes given extra help are the ones whose message alone reads as a
 * malfunction rather than as a rule being applied.
 */
function translate(error: unknown): AdhocError {
  const { code, message } = error as { code?: string; message?: string };

  if (code === '57014') {
    return new AdhocError(
      `The query ran longer than ${env.adhoc.timeoutMs} ms and was stopped. Narrow it, or add a LIMIT.`,
    );
  }
  if (code === '42501') {
    return new AdhocError(
      `${message ?? 'Permission denied.'} — the query console is read-only and cannot read columns holding secrets.`,
    );
  }
  return new AdhocError(message ?? 'The query could not be run.');
}
