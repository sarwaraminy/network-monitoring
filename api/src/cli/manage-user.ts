/**
 * User administration from the command line.
 *
 * Exists because the seeded accounts in V2__Insert_initial_data.sql carry bcrypt
 * hashes whose plaintext nobody has, so a fresh install has no usable login. It is
 * also the way to recover from a forgotten password without touching SQL by hand.
 *
 *   npm run user -w api -- list
 *   npm run user -w api -- create --email you@example.com --password 'secret' --role ADMIN
 *   npm run user -w api -- set-password --email you@example.com --password 'new secret'
 *   npm run user -w api -- delete --email old@example.com
 *
 * Passwords are hashed with bcrypt before they are stored, exactly as the signup
 * endpoint does.
 */

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { closeDb, db } from '../db/index.js';
import { users } from '../db/schema.js';

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

interface Args {
  command: string;
  email?: string;
  password?: string;
  role?: string;
  firstname?: string;
  lastname?: string;
  langCode?: string;
  generate?: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const args: Args = { command };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--generate') {
      args.generate = true;
      continue;
    }
    if (!token?.startsWith('--')) continue;

    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) continue;
    i += 1;

    switch (key) {
      case 'email':
        args.email = value;
        break;
      case 'password':
        args.password = value;
        break;
      case 'role':
        args.role = value.toUpperCase();
        break;
      case 'firstname':
        args.firstname = value;
        break;
      case 'lastname':
        args.lastname = value;
        break;
      case 'lang':
      case 'langCode':
        args.langCode = value;
        break;
      default:
        break;
    }
  }

  return args;
}

/** A readable but strong password, for `--generate`. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

function require_(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing --${flag}`);
  }
  return value;
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

async function list(): Promise<void> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      firstname: users.firstname,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.id);

  if (rows.length === 0) {
    process.stdout.write(
      'No users. Create one with:\n  npm run user -w api -- create --email you@example.com --generate --role ADMIN\n',
    );
    return;
  }

  process.stdout.write(`${rows.length} user(s):\n`);
  for (const row of rows) {
    process.stdout.write(
      `  #${row.id}  ${(row.email ?? '(no email)').padEnd(32)} ${row.role.padEnd(6)} ${row.firstname}\n`,
    );
  }
}

async function create(args: Args): Promise<void> {
  const email = require_(args.email, 'email');
  const password = args.generate ? generatePassword() : require_(args.password, 'password');
  checkPassword(password);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    throw new Error(`${email} already exists. Use set-password to change its password.`);
  }

  const role = args.role === 'ADMIN' ? 'ADMIN' : 'USER';
  await db.insert(users).values({
    email,
    password: await bcrypt.hash(password, BCRYPT_ROUNDS),
    role,
    langCode: args.langCode ?? 'en',
    firstname: args.firstname ?? email.split('@')[0] ?? 'user',
    lastname: args.lastname ?? '',
  });

  process.stdout.write(`Created ${email} (${role}).\n`);
  if (args.generate) process.stdout.write(`Password: ${password}\n`);
}

async function setPassword(args: Args): Promise<void> {
  const email = require_(args.email, 'email');
  const password = args.generate ? generatePassword() : require_(args.password, 'password');
  checkPassword(password);

  const updated = await db
    .update(users)
    .set({ password: await bcrypt.hash(password, BCRYPT_ROUNDS) })
    .where(eq(users.email, email))
    .returning({ id: users.id });

  if (updated.length === 0) throw new Error(`No user with email ${email}`);

  process.stdout.write(`Password updated for ${email}.\n`);
  if (args.generate) process.stdout.write(`Password: ${password}\n`);
}

async function remove(args: Args): Promise<void> {
  const email = require_(args.email, 'email');
  const deleted = await db.delete(users).where(eq(users.email, email)).returning({ id: users.id });
  if (deleted.length === 0) throw new Error(`No user with email ${email}`);
  process.stdout.write(`Deleted ${email}.\n`);
}

function help(): void {
  process.stdout.write(`Manage Network Monitoring users.

  list
      Show every account.

  create --email <email> (--password <pw> | --generate) [--role USER|ADMIN]
         [--firstname <name>] [--lastname <name>] [--lang en]
      Create an account. --generate prints a strong random password.

  set-password --email <email> (--password <pw> | --generate)
      Replace an account's password. Use this to recover access.

  delete --email <email>
      Remove an account.

Examples:
  npm run user -w api -- list
  npm run user -w api -- create --email me@example.com --generate --role ADMIN
  npm run user -w api -- set-password --email admin@example.com --password 'a good password'
`);
}

const args = parseArgs(process.argv.slice(2));

try {
  switch (args.command) {
    case 'list':
      await list();
      break;
    case 'create':
      await create(args);
      break;
    case 'set-password':
    case 'password':
      await setPassword(args);
      break;
    case 'delete':
      await remove(args);
      break;
    default:
      help();
      break;
  }
  await closeDb();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await closeDb().catch(() => undefined);
  process.exit(1);
}
