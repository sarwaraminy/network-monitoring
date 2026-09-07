import { createHash } from 'node:crypto';
import pg from 'pg';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import { HttpError } from '../middleware/error-handler.js';
import { currentAdhocSettings } from './adhoc-settings.service.js';

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
export function adhocRole(database: string, mode: AdhocMode = 'read'): string {
  const prefix = mode === 'write' ? WRITE_ROLE_PREFIX : ROLE_PREFIX;
  const full = `${prefix}${database}`;
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
  return `${prefix}${createHash('md5').update(database).digest('hex').slice(0, HASH_LENGTH)}`;
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
  /**
   * Postgres's own command tag — `SELECT`, `DELETE`, `UPDATE`, `EXPLAIN`.
   *
   * Taken from the driver rather than parsed from the SQL, so it says what
   * actually ran. That matters most for the audit entry: "what did this query
   * turn out to be" is not a question the query text alone answers reliably.
   */
  command: string;
  /**
   * Rows the statement changed, for the commands that change rows.
   *
   * `undefined` for a SELECT, where the row count is the result itself. A DELETE
   * returns no rows, so without this the console would answer a destructive
   * statement with a blank grid and no confirmation of what it did.
   */
  rowsAffected?: number;
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
/** Which role the live pool authenticated as. Cleared with it. */
let activeMode: AdhocMode = 'read';

/**
 * Why the console is off, for an administrator who is looking at a page that
 * tells them it is.
 *
 * The reasons were only ever in the server log. "Off" is three different
 * situations — nobody asked for it, somebody asked without a password, or the
 * sandbox proof failed — and they need three different actions, so a UI that
 * says only "not enabled" sends an operator to read logs to find out which one
 * they are in. Recorded here as `startAdhoc` decides, and reported by
 * `adhocStatus`.
 */
export type AdhocOffReason =
  /** `ADHOC_ENABLED` is not set. The default, and not a fault. */
  | 'disabled'
  /** Asked for, but `ADHOC_DB_PASSWORD` is empty, so there is no credential to install. */
  | 'no-password'
  /** Asked for and provisioned, but the database would not confirm the role is sandboxed. */
  | 'sandbox-failed';

let offReason: AdhocOffReason | null = 'disabled';
let offDetail: string | null = null;
/** The role the live pool authenticated as, for the status page. */
let activeRole: string | null = null;
/**
 * Whether `ALTER ROLE … PASSWORD` could be kept out of the Postgres log.
 *
 * A caveat rather than a failure — the console works either way — and the one
 * thing about this feature an operator cannot discover for themselves, so the
 * status reports it instead of leaving it in a boot log nobody re-reads.
 */
let loggingSuppressed = true;

export interface AdhocStatus {
  enabled: boolean;
  /** Which role the live pool holds, and therefore what it may do. Null when off. */
  role: string | null;
  mode: AdhocMode | null;
  /** Absent when the console is running. */
  reason?: AdhocOffReason;
  /**
   * The failure's own message, for `sandbox-failed` only.
   *
   * The configured password is stripped out before this leaves the process. A
   * Postgres error is not expected to quote the statement it came from, but the
   * one statement this code builds contains a credential, and "not expected to"
   * is not a property worth relying on for something shown in a browser.
   */
  detail?: string;
  /** True when the password could not be kept out of the Postgres log. See above. */
  passwordMayBeLogged: boolean;
}

/** True once `startAdhoc` has proved the sandbox holds. */
export function adhocReady(): boolean {
  return pool !== null;
}

/** Everything an administrator needs to know about why the console is or is not up. */
export function adhocStatus(): AdhocStatus {
  return {
    enabled: pool !== null,
    role: pool === null ? null : activeRole,
    mode: pool === null ? null : activeMode,
    ...(offReason ? { reason: offReason } : {}),
    ...(offDetail ? { detail: offDetail } : {}),
    passwordMayBeLogged: pool !== null && !loggingSuppressed,
  };
}

/**
 * Removes the configured password from anything on its way to a browser.
 *
 * Both spellings, not just the one in force. `ALTER ROLE … PASSWORD` has no
 * parameterised form, so the value is in the statement text and can come back in
 * a Postgres error — and since V15 the password can come either from the
 * environment or from the settings row. A save that changes it leaves the other
 * value still capable of appearing in a message that was already in flight, and
 * scrubbing only the resolved one would let the replaced credential through.
 */
function withoutPassword(text: string): string {
  let out = text;
  for (const password of new Set([currentAdhocSettings().dbPassword, env.adhoc.password])) {
    if (password === '') continue;
    out = out.split(password).join('<ADHOC_DB_PASSWORD>');
  }
  return out;
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
const ROLE_PREFIX = 'nm_adhoc_';
/** V12's role. A separate identity, so a read-only install cannot write. */
const WRITE_ROLE_PREFIX = 'nm_adhocrw_';

/**
 * Which of the two roles the console runs as.
 *
 * The mode is a database identity, not an application check. `ADHOC_WRITE_ENABLED`
 * chooses which role to authenticate as; what that role may then do is decided
 * entirely by V11's and V12's grants. So turning the flag off does not merely
 * stop the app issuing writes — it connects as a role that cannot perform them.
 */
export type AdhocMode = 'read' | 'write';

/** Postgres's `NAMEDATALEN - 1`. An identifier longer than this is truncated. */
const MAX_IDENTIFIER_BYTES = 63;
/** Hex characters of md5 kept. 9 + 16 = 25 bytes, comfortably inside the limit. */
const HASH_LENGTH = 16;

export function adhocConnectionString(role: string, password: string): string {
  const url = new URL(env.databaseUrl);
  /*
   * Pre-encoded, both of them.
   *
   * `url.password = value` percent-encodes SOME characters and leaves an
   * existing `%` alone, while `pg-connection-string` runs `decodeURIComponent`
   * on the way back out — so a password containing `%` plus two hex digits comes
   * back as a different string. Measured: `p%41ss#w rd` round-trips to
   * `pAss#w rd`. The `#` and the space survive; the `%41` does not.
   *
   * The consequence is nastier than the bug: `ALTER ROLE … PASSWORD` sets one
   * string and the pool then authenticates with another, so the console fails
   * its own sandbox proof and logs "failed its safety checks and stays off" —
   * pointing the operator at the proof rather than at a password the two halves
   * of this file disagree about. Generated passwords are exactly where stray
   * `%`-plus-hex sequences come from.
   *
   * `env.ts`'s own `databaseUrl()` encodes for this reason; this now matches it.
   * Exported so the round-trip can be asserted rather than reasoned about, since
   * this is the third round for it.
   */
  url.username = encodeURIComponent(role);
  url.password = encodeURIComponent(password);
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
  /*
   * Both "off" paths revoke BOTH roles, and that is the point rather than
   * tidiness.
   *
   * `stopAdhoc`'s docblock says the login does not outlive the console. It only
   * ran on shutdown of a process that had the console ON — so the operator
   * action that matters, setting `ADHOC_ENABLED=false` and restarting, took this
   * path and revoked nothing. The role kept LOGIN and the configured password
   * indefinitely after the feature was switched off, with PUBLIC holding CONNECT
   * by default. The file documented a guarantee it did not provide.
   *
   * And then it went on documenting it for HALF the roles: `revokeAdhocLogin`
   * resolved one name with the `mode: 'read'` default, so this paragraph was an
   * accurate description of `nm_adhoc_<db>` and a false one of
   * `nm_adhocrw_<db>` — which kept its login and its password through every
   * off-path, while a write→read switch revoked nothing either. No operator
   * action revoked the write login, so a credential granted `INSERT`/`UPDATE`/
   * `DELETE` on the operational tables outlived the ADMIN role that authorised
   * it. Both are revoked here now, and `startAdhoc` also strips the mode it is
   * not using so a switch leaves nothing behind.
   *
   * Best effort: this runs at boot, the roles may not exist yet on a fresh
   * install, and a console that is off is off either way.
   */
  offDetail = null;
  activeRole = null;
  loggingSuppressed = true;

  if (!currentAdhocSettings().enabled) {
    offReason = 'disabled';
    await revokeAdhocLogin(owner).catch(() => {});
    return false;
  }

  // Resolved, not read from the environment: since V15 an administrator can set
  // this in the interface, and the environment still wins where it is set.
  const password = currentAdhocSettings().dbPassword;
  if (!password) {
    offReason = 'no-password';
    log.warn('The query console is enabled but has no password to install on its role; it stays off');
    await revokeAdhocLogin(owner).catch(() => {});
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
  let mode: AdhocMode = 'read';
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
    mode = currentAdhocSettings().writeEnabled ? 'write' : 'read';
    role = adhocRole(current[0]!.name, mode);

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
    /*
     * Whether the suppression is even possible, asked BEFORE trying it.
     *
     * `log_statement` and `log_min_error_statement` are SUSET — superuser only.
     * A `.catch()` around the failed `SET LOCAL` swallows the JS rejection but
     * not the Postgres one: the transaction is already aborted, so the very
     * `ALTER ROLE` this block exists to protect fails with 25P02. The console
     * then could not start AT ALL on an install whose owner is a scoped role —
     * the configuration `env.ts` documents as supported — and it reported it as
     * a failed safety check, pointing the operator at the sandbox proof rather
     * than at a permission on a logging setting.
     *
     * So it degrades instead: suppress where we can, and where we cannot, say
     * which trade-off the operator is getting rather than silently taking it.
     */
    const { rows: privilege } = await owner.query<{ superuser: string }>(
      `SELECT current_setting('is_superuser') AS superuser`,
    );
    const canSuppressLogging = privilege[0]?.superuser === 'on';
    loggingSuppressed = canSuppressLogging;
    if (!canSuppressLogging) {
      log.warn(
        { role },
        'Cannot suppress statement logging (the database owner is not a superuser); ' +
          'ADHOC_DB_PASSWORD may be written to the Postgres log in cleartext',
      );
    }

    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      if (canSuppressLogging) {
        await client.query(`SET LOCAL log_statement = 'none'`);
        await client.query(`SET LOCAL log_min_error_statement = 'panic'`);
      }
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
      await proveSandbox(candidate, role, mode);
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
    activeMode = mode;

    /*
     * The OTHER mode's role loses its login, so a mode switch leaves nothing
     * behind.
     *
     * Without this, a write→read switch revoked nothing at all: the console came
     * back as `nm_adhoc_<db>` while `nm_adhocrw_<db>` kept `LOGIN` and the
     * password from when write mode was last on. Rotating `dbPassword` in read
     * mode then left the write role authenticating with the PREVIOUS password
     * indefinitely — only re-entering write mode ever updated it.
     *
     * After the ALTER and the sandbox proof, deliberately: this must not be able
     * to strip the login from the role the console is about to use, and by here
     * the active one is provisioned and verified. Best effort and non-fatal — a
     * running console is not worth refusing over a role that may not exist.
     */
    const idle = adhocRole(current[0]!.name, mode === 'write' ? 'read' : 'write');
    await revokeLogin(owner, idle).catch(() => {});

    if (mode === 'write') {
      // WARN, not info. An operator scanning a boot log should not have to
      // notice a missing word to learn that a browser session can now DELETE.
      log.warn({ role }, 'Ad hoc query console enabled in READ-WRITE mode');
    } else {
      log.info({ role }, 'Ad hoc query console enabled');
    }
    offReason = null;
    activeRole = role;
    return true;
  } catch (error) {
    log.error({ err: error }, 'Ad hoc query console failed its safety checks and stays off');
    offReason = 'sandbox-failed';
    offDetail = withoutPassword(error instanceof Error ? error.message : String(error));
    pool = null;
    activeRole = null;
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
async function proveSandbox(candidate: pg.Pool, role: string, mode: AdhocMode): Promise<void> {
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
   *
   * Both probes name every NOT NULL column, `sensor_id` included, and that is
   * load-bearing rather than tidy: a probe the database rejects for a missing
   * column never reaches the grant it is meant to test, so it stops proving
   * anything about the sandbox while still looking like a check.
   *
   * What it does NOT do is pass silently, and the distinction is worth stating
   * because this file is a security boundary and somebody will read this comment
   * deciding whether a future refactor is safe. `mustBeRefused` swallows `42501`
   * and rethrows everything else, so a `23502` from an unnamed NOT NULL column
   * fails `proveSandbox`, and `startAdhoc` refuses to bring the console up. The
   * code check is what makes that loud; the column list is what keeps the probe
   * reaching the grant at all. Keep both, and expect a schema change here to
   * surface as a console that will not start.
   */
  if (mode === 'read') {
    await mustBeRefused(
      candidate,
      `INSERT INTO alerts
         (sensor_id, kind, severity, title, description, dedup_key, first_seen, last_seen)
       VALUES ('adhoc-probe', 'adhoc_probe', 'low', 'probe', 'probe', 'adhoc-probe', now(), now())`,
      'the ad hoc role was able to INSERT; it is not read-only',
    );
  } else {
    /*
     * The mirror image: write mode has to prove it CAN write, or an install that
     * asked for it gets a console that silently refuses every DELETE with a
     * permission error and no explanation. Rolled back — proving the grant is
     * not a reason to leave a row behind.
     *
     * And `audit_events` must still refuse, in this mode especially. A console
     * that can rewrite the trail is one whose own use cannot be investigated,
     * which is the property V9 exists for and the one write mode must not cost.
     */
    await mustSucceed(
      candidate,
      `INSERT INTO alerts
         (sensor_id, kind, severity, title, description, dedup_key, first_seen, last_seen)
       VALUES ('adhoc-probe', 'adhoc_probe', 'low', 'probe', 'probe', 'adhoc-probe', now(), now())`,
      'write mode is enabled but the role cannot INSERT; has V12 run on this database?',
    );
    await mustBeRefused(
      candidate,
      `DELETE FROM audit_events WHERE id = -1`,
      'the ad hoc write role can delete from the audit trail',
    );
  }
  await mustBeRefused(
    candidate,
    'SELECT password FROM users LIMIT 1',
    'the ad hoc role can read users.password; the column grants from V10 are not in force',
  );
}

/** Runs `sql` inside a rolled-back transaction and insists Postgres ALLOWS it. */
async function mustSucceed(candidate: pg.Pool, sql: string, complaint: string): Promise<void> {
  const client = await candidate.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
  } catch (error) {
    throw new Error(`${complaint} (${(error as Error).message})`);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
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
  activeMode = 'read';
  activeRole = null;
  await closing?.end().catch(() => {});
}

/**
 * Takes the login away from BOTH console roles.
 *
 * Both, and that is the fix for a real hole rather than tidiness. This called
 * `adhocRole(name)`, which takes the `mode: 'read'` default — so every path that
 * switched the console off stripped `LOGIN` from `nm_adhoc_<db>` and left
 * `nm_adhocrw_<db>` authenticating with its installed password, holding
 * `SELECT, INSERT, UPDATE, DELETE` on the operational tables from V12. Combined
 * with a write→read switch revoking nothing, **no operator action revoked the
 * write login at all**: the credential outlived the authorisation to use it,
 * including the administrator's own demotion.
 *
 * `PASSWORD NULL` alongside `NOLOGIN` because disabling a login leaves the
 * credential in `pg_authid` to be re-enabled; destroying it means a later
 * `ALTER ROLE … LOGIN` by any means does not restore a working password that an
 * ex-administrator still knows.
 *
 * Exported for the test suite — see `stopAdhoc` for why a production shutdown
 * must not do this. Resolves the roles from the connection, so a caller does not
 * have to reproduce the naming rule.
 */
export async function revokeAdhocLogin(owner: pg.Pool): Promise<void> {
  const { rows } = await owner.query<{ name: string }>('SELECT current_database() AS name');

  // Both modes, the way V15's own DO block loops the two prefixes.
  for (const mode of ['read', 'write'] as const) {
    await revokeLogin(owner, adhocRole(rows[0]!.name, mode));
  }
}

/** `ALTER ROLE … NOLOGIN PASSWORD NULL`, the one statement every teardown path needs. */
async function revokeLogin(owner: pg.Pool, role: string): Promise<void> {
  /*
   * A role that does not exist is not a problem to report.
   *
   * "Not there" is the NORMAL state on exactly the installs the migrations went
   * out of their way to support: an owner without CREATEROLE, where V10 to V12
   * skipped the create, and `DB_AUTO_MIGRATE=false`, where they have not run.
   * Logging `Could not revoke LOGIN … do it by hand` at ERROR on every boot —
   * about a feature they have switched off, instructing them to undo something
   * that was never done — is noise that teaches operators to ignore the log.
   *
   * The docblock on the caller already promised this was best effort. This is
   * the code catching up with it.
   */
  const { rows } = await owner
    .query<{ exists: boolean }>('SELECT true AS exists FROM pg_roles WHERE rolname = $1', [role])
    .catch(() => ({ rows: [] as { exists: boolean }[] }));
  if (rows.length === 0) {
    log.debug({ role }, 'No ad hoc console role to revoke');
    return;
  }

  await owner
    // `PASSWORD NULL` as well as `NOLOGIN`: disabling the login leaves the
    // credential stored, so anything that later re-grants LOGIN — a hand-run
    // ALTER, a restore, a future version of this code — would restore a working
    // password that whoever configured it still knows.
    .query('SELECT format($$ALTER ROLE %I NOLOGIN PASSWORD NULL$$, $1::text) AS statement', [role])
    .then((result) => owner.query(result.rows[0]!.statement))
    .catch((error) => log.error({ err: error }, `Could not revoke LOGIN from ${role}; do it by hand`));
}

/**
 * Everything that can be refused before the query is recorded or run.
 *
 * Exported so the route can call it BEFORE writing to the audit trail. Auditing
 * first meant the configured length limit was not what bounded the recorded text — the
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
  const { maxQueryLength } = currentAdhocSettings();
  if (trimmed.length > maxQueryLength) {
    throw new AdhocError(`Queries are limited to ${maxQueryLength} characters.`);
  }
  return trimmed;
}

/**
 * Runs one statement and returns at most the configured row cap.
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
  /*
   * Read once for the whole query rather than per use.
   *
   * The timeout, the row cap and the fetch size have to describe the same query:
   * a save landing between two of those reads would set a timeout from the old
   * settings and a cap from the new one, and the message about truncation would
   * then name a number that was never applied.
   *
   * `settings` is therefore THREADED to everything downstream that needs it —
   * `declareAndFetch` takes `maxRows` and `translate` takes `timeoutMs` — rather
   * than each of them calling `currentAdhocSettings()` again. That is the whole
   * point of taking a snapshot, and it was reported three times before the code
   * caught up with this comment: the snapshot was taken here and both of those
   * call sites re-read, so a save landing between the DECLARE and the FETCH
   * produced exactly the split described above. A lowered cap reported a
   * truncated result as complete; a raised one sliced 1001 rows to 10.
   *
   * If you add a downstream reader of these values, take it from `settings`.
   */
  const settings = currentAdhocSettings();
  const trimmed = assertRunnable(sql);
  // `assertRunnable` has already refused a null pool; re-reading it here is what
  // narrows the type, and it also closes the window where `stopAdhoc` runs
  // between the check and the connect.
  const running = pool;
  if (!running) throw new AdhocError('The query console is not enabled on this server.', 503);

  const writing = activeMode === 'write';
  const started = Date.now();
  let client: pg.PoolClient | undefined;
  try {
    /*
     * INSIDE the try, and this is the second time it has had to move here.
     *
     * A pool acquisition can fail — `max: 2` and a ten-second statement timeout
     * make "two long queries in flight" an ordinary state, so a third request
     * waits out `connectionTimeoutMillis` and rejects. Outside the try that
     * escapes as a raw pg `Error`, which `errorHandler` cannot map, so production
     * answers 500 with "Internal server error" — the exact generic-500 problem
     * `AdhocError extends HttpError` exists to end. `translate` below turns it
     * into something the operator can act on.
     */
    client = await running.connect();
    // READ ONLY on the transaction, not just on the role: two independent things
    // have to be wrong before a write reaches this database.
    /*
     * READ ONLY only in read mode.
     *
     * It is the belt to the role's braces there — a grant added carelessly by
     * some future migration does not become a write path. In write mode the
     * braces are deliberately looser, so the belt would only stop the thing the
     * operator asked for; what still holds is that the role itself cannot touch
     * `audit_events`, the secret columns, or anything outside the operational
     * tables. See V12.
     */
    await client.query(writing ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${settings.timeoutMs}`);
    // Nothing here should ever wait on another transaction's lock; if it does,
    // the answer is "no" rather than a console that hangs holding a connection.
    await client.query('SET LOCAL lock_timeout = 1000');

    /*
     * `EXPLAIN` and `SHOW` run UNWRAPPED, because a cursor cannot hold them.
     *
     * `DECLARE … CURSOR FOR` takes a query, so `EXPLAIN SELECT …` came back as
     * `syntax error at or near "EXPLAIN"` — and since this console passes
     * Postgres's message through verbatim, the operator read a syntax error
     * about SQL that has none, with nothing pointing at the wrapper we added.
     *
     * They lose only the cursor, not the cage: the same transaction, the same
     * statement timeout, the same role. The row cap is applied by hand
     * afterwards, which is fine because an EXPLAIN plan is tens of rows and
     * `SHOW` is one — the reason the cursor exists does not apply to either.
     */
    const result = UNWRAPPABLE.test(trimmed)
      ? await client.query({ text: trimmed, rowMode: 'array' })
      : await declareAndFetch(client, trimmed, writing, settings.maxRows);

    /*
     * The unwrapped branch's half of the same check.
     *
     * It only lived inside the cursor helper before, which left `EXPLAIN
     * SELECT 1; SELECT 2` unchecked: it came back as an ARRAY of results,
     * `result.rows` was undefined, and the operator got `Cannot read properties
     * of undefined` as the 400 body — the right refusal with an unreadable
     * reason. The two paths surface a chain in different places, so each checks
     * where it can see it.
     */
    if (Array.isArray(result)) {
      throw new AdhocError('Run one statement at a time — the query contains more than one.');
    }

    // Write mode has to COMMIT or the operator's DELETE is undone the moment
    // the `finally` below runs, which would be the worst possible outcome: a
    // console reporting "12 rows" and changing nothing.
    if (writing) await client.query('COMMIT');

    const truncated = result.rows.length > settings.maxRows;
    return {
      columns: result.fields.map((field) => ({ name: field.name, dataTypeId: field.dataTypeID })),
      rows: truncated ? result.rows.slice(0, settings.maxRows) : result.rows,
      truncated,
      durationMs: Date.now() - started,
      // `FETCH` is our cursor, not the operator's statement. Reporting it would
      // put a word they never typed into the audit trail and onto the page.
      command: result.command === 'FETCH' ? 'SELECT' : (result.command ?? 'SELECT'),
      // Only where it means something. `pg` reports 0 for a SELECT that returned
      // rows through a cursor, and reporting that would read as "deleted 0".
      rowsAffected: CHANGES_ROWS.has(result.command) ? (result.rowCount ?? 0) : undefined,
    };
  } catch (error) {
    // Ours already says exactly what happened; only driver errors need translating.
    throw error instanceof AdhocError ? error : translate(error, settings.timeoutMs);
  } finally {
    // Always ROLLBACK: the transaction is read-only, so there is nothing to
    // commit, and rolling back releases the cursor and any locks in one step.
    // Guarded, because the acquisition itself is now inside the try and may be
    // the thing that failed.
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }
}

/**
 * Statements the cursor cannot wrap, which this console still allows.
 *
 * Deliberately a short, explicit list rather than "anything that is not a
 * SELECT". Nothing here decides what is SAFE — the role does that, and it can
 * only read — so this is about which statements the FETCH wrapper can hold, and
 * a narrow list is easier to reason about than a broad exclusion.
 */
const UNWRAPPABLE = /^\s*(?:explain|show)\s/i;

/** Commands whose interesting number is rows CHANGED rather than rows returned. */
const CHANGES_ROWS = new Set(['INSERT', 'UPDATE', 'DELETE']);

/**
 * The cursor path: declare, fetch one more than the cap, and report the excess.
 *
 * In WRITE mode a statement may be one a cursor cannot hold — `DELETE FROM …`
 * is not a query — and the `DECLARE` then fails with a syntax error about SQL
 * that is perfectly valid. Rather than guess from the leading keyword, which
 * gets CTEs wrong in both directions, it tries the cursor behind a SAVEPOINT and
 * falls back to running the statement directly when Postgres says it is not a
 * query. A genuine syntax error takes the same fallback and surfaces on the
 * direct attempt, which is the better message anyway: it is about the operator's
 * SQL rather than about our wrapper.
 *
 * The savepoint is what makes the retry possible at all — a failed statement
 * aborts the transaction, so without it the fallback would meet 25P02.
 */
async function declareAndFetch(
  client: pg.PoolClient,
  sql: string,
  writing: boolean,
  /*
   * The caller's snapshot, threaded rather than re-read.
   *
   * Third time this line has been reported, and the previous two rounds rewrote
   * the comment at the snapshot instead of the code here — which is the whole
   * reason it kept coming back. The snapshot existed and nothing downstream
   * used it.
   */
  maxRows: number,
) {
  if (writing) {
    await client.query('SAVEPOINT adhoc_try_cursor');
    try {
      return await declareAndFetchStrict(client, sql, maxRows);
    } catch (error) {
      if ((error as { code?: string }).code !== '42601') throw error;
      await client.query('ROLLBACK TO SAVEPOINT adhoc_try_cursor');
      return client.query({ text: sql, rowMode: 'array' });
    }
  }
  return declareAndFetchStrict(client, sql, maxRows);
}

async function declareAndFetchStrict(client: pg.PoolClient, sql: string, maxRows: number) {
  /*
   * Checked on the DECLARE, because that is where the chain shows up here.
   *
   * The caller checks its own result too, and both are needed rather than one
   * being redundant: on THIS path the array comes back from the DECLARE — the
   * driver sent `DECLARE … FOR SELECT 1; SELECT 2` as two statements — while the
   * value the caller sees is the later FETCH, which is a single result and looks
   * perfectly ordinary. Moving the check up to the caller alone therefore let
   * chained statements through here, which the suite caught.
   */
  const declared = await client.query(`DECLARE adhoc_result NO SCROLL CURSOR FOR ${sql}`);
  if (Array.isArray(declared)) {
    throw new AdhocError('Run one statement at a time — the query contains more than one.');
  }
  // One more than the cap, so "there were more" is knowable without counting the
  // whole result — which is the thing the cap exists to avoid doing.
  // `rowMode: 'array'` for the reason in `AdhocResult.rows`: positional rows
  // cannot collide on a repeated column name.
  return client.query({
    text: `FETCH ${maxRows + 1} FROM adhoc_result`,
    rowMode: 'array',
  });
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
function translate(error: unknown, timeoutMs: number): AdhocError {
  const { code, message } = error as { code?: string; message?: string };

  if (code === '57014') {
    // The snapshot's timeout, not the current one: this message names the number
    // that was set on THIS statement, and a save landing mid-query would
    // otherwise have it report a limit the query was never run under.
    return new AdhocError(
      `The query ran longer than ${timeoutMs} ms and was stopped. Narrow it, or add a LIMIT.`,
    );
  }
  // Not a Postgres code at all: `pg` rejects a pool acquisition with a plain
  // Error. Worth naming, because "timeout exceeded when trying to connect" reads
  // as the database being down when it means the console is busy.
  if (message?.includes('timeout exceeded when trying to connect')) {
    return new AdhocError(
      'The query console is busy — it runs a small number of queries at a time. Try again in a moment.',
      503,
    );
  }
  if (code === '42501') {
    /*
     * The suffix depends on the mode, because the read-only sentence is simply
     * false in write mode and sends the operator looking for the wrong thing.
     * What is true in both is that the console cannot reach the secrets or the
     * audit trail — which is usually the actual reason they are seeing this.
     */
    const why =
      activeMode === 'write'
        ? 'the query console writes only the operational tables, and cannot touch the audit trail, the accounts or the columns holding secrets'
        : 'the query console is read-only and cannot read columns holding secrets';
    return new AdhocError(`${message ?? 'Permission denied.'} — ${why}.`);
  }
  return new AdhocError(message ?? 'The query could not be run.');
}
