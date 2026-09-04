import pg from 'pg';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';

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

/** The role V10 creates. A constant, and not configurable — see `startAdhoc`. */
const ADHOC_ROLE = 'nm_adhoc';

export interface AdhocColumn {
  name: string;
  /** Postgres type oid, so the UI can right-align numbers without guessing. */
  dataTypeId: number;
}

export interface AdhocResult {
  columns: AdhocColumn[];
  rows: Record<string, unknown>[];
  /** True when the cap stopped the read, so the UI can say so rather than imply completeness. */
  truncated: boolean;
  durationMs: number;
}

/** Thrown for anything the operator should see verbatim — including Postgres's own errors. */
export class AdhocError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
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
function adhocConnectionString(password: string): string {
  const url = new URL(env.databaseUrl);
  url.username = ADHOC_ROLE;
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

  try {
    // As the owner, because the role cannot set its own password before it can
    // log in. `quote_literal` rather than interpolation: the password comes from
    // the environment, but a password containing a quote should change nothing.
    const { rows } = await owner.query<{ statement: string }>(
      `SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS statement`,
      [ADHOC_ROLE, password],
    );
    await owner.query(rows[0]!.statement);

    const candidate = new pg.Pool({
      connectionString: adhocConnectionString(password),
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    candidate.on('error', (error) => log.error({ err: error }, 'Idle ad hoc client error'));

    await proveSandbox(candidate);
    pool = candidate;
    log.info({ role: ADHOC_ROLE }, 'Ad hoc query console enabled');
    return true;
  } catch (error) {
    log.error({ err: error }, 'Ad hoc query console failed its safety checks and stays off');
    pool = null;
    return false;
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
async function proveSandbox(candidate: pg.Pool): Promise<void> {
  const { rows } = await candidate.query<{ superuser: boolean; who: string }>(
    'SELECT rolsuper AS superuser, current_user AS who FROM pg_roles WHERE rolname = current_user',
  );
  const identity = rows[0];
  if (!identity) throw new Error('could not read the ad hoc role from pg_roles');
  if (identity.who !== ADHOC_ROLE) {
    throw new Error(`connected as "${identity.who}", expected "${ADHOC_ROLE}"`);
  }
  if (identity.superuser) {
    throw new Error(`"${ADHOC_ROLE}" is a superuser; every restriction on the console is void`);
  }

  // And a real attempt, because `rolsuper` being false does not by itself prove
  // the grants are what V10 wrote. Rolled back either way; the expected outcome
  // is the error.
  const client = await candidate.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO alerts (kind, severity, title, description, dedup_key, first_seen, last_seen)
                        VALUES ('adhoc_probe', 'low', 'probe', 'probe', 'adhoc-probe', now(), now())`);
    throw new Error('the ad hoc role was able to INSERT; it is not read-only');
  } catch (error) {
    // `42501` is insufficient_privilege — the answer this probe wants.
    if ((error as { code?: string }).code !== '42501') throw error;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

export async function stopAdhoc(): Promise<void> {
  const closing = pool;
  pool = null;
  await closing?.end().catch(() => {});
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
  if (!pool) {
    throw new AdhocError('The query console is not enabled on this server.', 503);
  }

  const trimmed = sql.trim();
  if (trimmed === '') throw new AdhocError('Enter a query to run.');
  if (trimmed.length > env.adhoc.maxLength) {
    throw new AdhocError(`Queries are limited to ${env.adhoc.maxLength} characters.`);
  }

  const started = Date.now();
  const client = await pool.connect();
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
    const result = await client.query(`FETCH ${env.adhoc.maxRows + 1} FROM adhoc_result`);

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
