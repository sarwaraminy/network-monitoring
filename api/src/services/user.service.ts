import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
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
