import bcrypt from 'bcryptjs';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type NewUserRow, type UserRow, users } from '../db/schema.js';
import type { PublicUser } from '../types/dto.js';
import type { AuditWriter } from './audit.service.js';

const BCRYPT_ROUNDS = 10;

/** Advisory-lock key serialising first-account creation. See `saveFirstUser`. */
const BOOTSTRAP_LOCK_KEY = 4_021_776_301;

/** Replaces cyber.wissen.service.UserService. */

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    langCode: user.langCode,
    firstname: user.firstname,
    lastname: user.lastname,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function existsByEmail(email: string): Promise<boolean> {
  const rows = await db.select({ one: sql<number>`1` }).from(users).where(eq(users.email, email)).limit(1);
  return rows.length > 0;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAllUsers(): Promise<UserRow[]> {
  return db.select().from(users).orderBy(users.id);
}

/**
 * Whether any account exists at all.
 *
 * Used by the one narrow case where account creation is allowed without a token:
 * a brand-new installation has nobody who could authorise it. Counting rather
 * than listing so the check stays cheap and never loads password hashes.
 */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ total: count() }).from(users).limit(1);
  return (row?.total ?? 0) > 0;
}

/**
 * Creates the first account, only if the table is genuinely empty.
 *
 * The bootstrap path in auth.routes.ts checks `hasAnyUser()` and then inserts,
 * which is a read-then-write race: two concurrent anonymous requests on a fresh
 * install both see an empty table and both become ADMIN. The check is what
 * authorises the request, so losing that race is a privilege issue, not just a
 * duplicate row.
 *
 * `INSERT … SELECT … WHERE NOT EXISTS` alone does **not** close it. Under READ
 * COMMITTED — Postgres's default — each statement takes its own snapshot and
 * cannot see another transaction's uncommitted row, so two overlapping requests
 * with different emails can both find the table empty and both insert. An
 * earlier version of this function claimed otherwise; the claim was wrong.
 *
 * A transaction-scoped advisory lock serialises the whole check-and-insert, so
 * the second caller waits and then genuinely observes the first account. The
 * `WHERE NOT EXISTS` stays as a second line of defence. Returns null for the
 * loser, which the route turns into the same 401 an ordinary unauthenticated
 * signup gets.
 */
export async function saveFirstUser(
  input: Omit<NewUserRow, 'password'> & { password: string },
): Promise<UserRow | null> {
  // Hashing before the transaction, so the lock is held for the insert alone
  // rather than for the ~100ms bcrypt takes.
  const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const id = await db.transaction(async (tx) => {
    // Any constant works as the key; it only has to be the same one for every
    // bootstrap attempt. Transaction-scoped, so it is released on commit or
    // rollback without needing an unlock call.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

    // Returns only the id: raw SQL yields the database's snake_case columns
    // (`lang_code`, `created_at`), which do not match `UserRow`. Re-reading
    // through the typed query keeps one mapping instead of two that can drift.
    const inserted = await tx.execute<{ id: number }>(sql`
      INSERT INTO users (email, password, role, lang_code, firstname, lastname)
      SELECT ${input.email ?? null}, ${hashed}, ${input.role ?? 'ADMIN'},
             ${input.langCode ?? 'en'}, ${input.firstname ?? ''}, ${input.lastname ?? ''}
      WHERE NOT EXISTS (SELECT 1 FROM users)
      RETURNING id
    `);

    const rows = (inserted as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
    return rows[0]?.id;
  });

  // No row means another request created the first account first, so this caller
  // is no longer bootstrapping and must be refused.
  return id === undefined ? null : await getUserById(id);
}

export async function saveUser(input: Omit<NewUserRow, 'password'> & { password: string }): Promise<UserRow> {
  if (input.email && (await existsByEmail(input.email))) {
    throw new EmailAlreadyExistsError(input.email);
  }

  const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const [created] = await db
    .insert(users)
    .values({ ...input, password: hashed })
    .returning();

  if (!created) throw new Error('Insert into users returned no row');
  return created;
}

export async function deleteUser(id: number): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

/** Raised when a role change would leave the installation with no administrator. */
export class LastAdministratorError extends Error {
  constructor() {
    super('This is the only administrator left; promote another account first.');
    this.name = 'LastAdministratorError';
  }
}

export type Role = 'ADMIN' | 'USER';

/**
 * Changes one account's role, refusing to remove the last administrator.
 *
 * The refusal is the point. Role is otherwise only settable in the database, so
 * demoting the last admin locks every administrative function — this page
 * included — behind a `psql` session on the server. That is recoverable, but only
 * by the person this feature exists to avoid needing.
 *
 * Done in a transaction with the rows locked, not as a count-then-update. Two
 * administrators demoting each other at the same moment would each read two
 * admins, each pass the check, and both writes would land: an installation with
 * no administrator, reached without either of them doing anything wrong.
 * `FOR UPDATE` on the admin rows makes the second one wait and then see one.
 *
 * `audit` is invoked inside the transaction so the record and the change commit
 * together, matching the rest of this trail: an act that happened without a row,
 * or a row for an act that rolled back, are both worse than a failure.
 */
export async function setUserRole(
  id: number,
  role: Role,
  audit: (writer: AuditWriter, target: UserRow, from: Role) => Promise<void>,
): Promise<UserRow> {
  return db.transaction(async (tx) => {
    /*
     * Every ADMIN row, locked, before anything is read about the target.
     *
     * Ordering matters: taking the lock first means a concurrent demotion is
     * already waiting by the time this one counts, so the count it eventually
     * reads reflects the other transaction's outcome rather than its own start.
     * The target is included in this set when it is an admin, which is the case
     * the count is about.
     *
     * `upper(role)`, not `eq(users.role, 'ADMIN')`, and the difference is a bug
     * this had: `role` is a plain `varchar` with no constraint on its case, and
     * every other reader in the system normalises — `requireRole` lowercases
     * both sides, `auth.routes.ts` upper-cases, and the target's own role is
     * upper-cased five lines below. A row storing `Admin` was therefore an
     * administrator everywhere except in the count that decides whether one is
     * left, so with two administrators and one of them mixed-case, demoting
     * either counted one row and refused with a message that was not true. It
     * failed closed, which is the right direction to be wrong, but it also
     * excluded that row from the lock — and the comment above claims it is in
     * this set.
     */
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`upper(${users.role}) = 'ADMIN'`)
      .for('update');

    const [target] = await tx.select().from(users).where(eq(users.id, id)).limit(1).for('update');
    if (!target) throw new UserNotFoundError(id);

    const from = (target.role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER') as Role;
    // Nothing to do, and nothing to record: a no-op write would put a row in an
    // append-only trail for a change that did not happen.
    if (from === role) return target;

    if (from === 'ADMIN' && admins.length <= 1) throw new LastAdministratorError();

    const [updated] = await tx.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!updated) throw new Error('Update of users returned no row');

    // `AuditWriter` is `Pick<db, 'insert'>` — deliberately the narrowest thing
    // that works, so this parameter cannot be used to reach unrelated database
    // access, and a transaction satisfies it directly.
    await audit(tx, updated, from);
    return updated;
  });
}

export class UserNotFoundError extends Error {
  constructor(id: number) {
    super(`No account with id ${id}`);
    this.name = 'UserNotFoundError';
  }
}

export async function authenticateUser(email: string, password: string): Promise<UserRow | null> {
  const user = await getUserByEmail(email);
  if (!user) {
    // Hash anyway so a missing account and a wrong password take similar time.
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    return null;
  }

  // Hashes seeded by the Java app use the $2a$ prefix, which bcryptjs reads fine.
  const matches = await bcrypt.compare(password, user.password);
  return matches ? user : null;
}

export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`Email already exists: ${email}`);
    this.name = 'EmailAlreadyExistsError';
  }
}
