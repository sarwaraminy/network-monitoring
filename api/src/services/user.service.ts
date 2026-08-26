import bcrypt from 'bcryptjs';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { type NewUserRow, type UserRow, users } from '../db/schema.js';
import type { PublicUser } from '../types/dto.js';

const BCRYPT_ROUNDS = 10;

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
 * Creates the first account, atomically, only if the table is genuinely empty.
 *
 * The bootstrap path in auth.routes.ts checks `hasAnyUser()` and then inserts,
 * which is a read-then-write race: two concurrent anonymous requests on a fresh
 * install both see an empty table and both become ADMIN. The check is what
 * authorises the request, so losing that race is a privilege issue, not just a
 * duplicate row.
 *
 * `INSERT … SELECT … WHERE NOT EXISTS` makes the emptiness test part of the write
 * itself, so exactly one concurrent caller can ever succeed. Returns null for the
 * losers, which the route turns into the same 401 an ordinary unauthenticated
 * signup gets.
 */
export async function saveFirstUser(
  input: Omit<NewUserRow, 'password'> & { password: string },
): Promise<UserRow | null> {
  const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // Returns only the id: raw SQL yields the database's snake_case columns
  // (`lang_code`, `created_at`), which do not match `UserRow`. Re-reading through
  // the typed query keeps one mapping instead of two that can drift.
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO users (email, password, role, lang_code, firstname, lastname)
    SELECT ${input.email ?? null}, ${hashed}, ${input.role ?? 'ADMIN'},
           ${input.langCode ?? 'en'}, ${input.firstname ?? ''}, ${input.lastname ?? ''}
    WHERE NOT EXISTS (SELECT 1 FROM users)
    RETURNING id
  `);

  const rows = (inserted as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
  const id = rows[0]?.id;
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
