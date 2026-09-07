import { api } from './client';

/**
 * Accounts and their roles. ADMIN-only on the server.
 *
 * Role decides what every other guard in this application answers, and until now
 * it was settable only in the database — so "give this person admin" was a job
 * for whoever had a `psql` session, which is the same gap the query console's
 * settings had, in the place where it matters more.
 *
 * Nothing here can create or delete an account. Sign-up is its own flow with its
 * own policy (`signup-policy.ts` decides who may call it and when), and deletion
 * is not offered at all: an account referenced by suppression rules and audit
 * rows is not a thing to remove from a settings panel.
 */

export type Role = 'ADMIN' | 'USER';

/** What `toPublicUser` returns — no password hash, which the Java version leaked. */
export interface AccountSummary {
  id: number;
  email: string | null;
  role: string;
  langCode: string;
  firstname: string;
  lastname: string | null;
  createdAt: string;
}

export async function fetchAccounts(): Promise<AccountSummary[]> {
  const { data } = await api.get<AccountSummary[]>('/auth/users');
  return data;
}

/**
 * Changes one account's role.
 *
 * Three refusals to expect, each a 409 or 404 with a message worth showing
 * verbatim: the last administrator cannot be demoted, nobody may demote
 * themselves, and an unknown account is a 404 rather than a silent success.
 */
export async function setAccountRole(id: number, role: Role): Promise<AccountSummary> {
  const { data } = await api.patch<AccountSummary>(`/auth/users/${id}/role`, { role });
  return data;
}
