import type { AuthenticatedUser, LoginResponse, SignupPayload } from '../types';
import { api } from './client';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function signup(payload: SignupPayload): Promise<void> {
  await api.post('/auth/signup', payload);
}

/**
 * How this installation handles account creation.
 *
 * - `first-admin` — the users table is empty, so anyone may create the first
 *   administrator. This window closes as soon as one account exists.
 * - `open` — public registration is deliberately enabled. Self-registered
 *   accounts are always USER; the server ignores a requested role.
 * - `admin-only` — the normal state. An administrator creates accounts.
 *
 * Asked before the form is drawn, so the page never presents fields the server
 * will reject. Signup used to be unauthenticated and honoured a requested role of
 * ADMIN, which meant anyone who could load this page could take over the install.
 */
export async function fetchSignupMode(): Promise<{
  allowed: boolean;
  mode: 'first-admin' | 'open' | 'admin-only';
}> {
  const { data } = await api.get<{ allowed: boolean; mode: 'first-admin' | 'open' | 'admin-only' }>(
    '/auth/signup-allowed',
  );
  return data;
}

/** Validates a stored token on reload and returns the current account. */
export async function fetchCurrentUser(): Promise<AuthenticatedUser> {
  const { data } = await api.get<{
    id: number;
    email: string | null;
    firstname: string;
    lastname: string | null;
    role: string;
  }>('/auth/me');

  return {
    id: data.id,
    email: data.email,
    firstName: data.firstname,
    lastName: data.lastname,
    role: data.role,
  };
}
