import type { AuthenticatedUser, LoginResponse, SignupPayload } from '../types';
import { api } from './client';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function signup(payload: SignupPayload): Promise<void> {
  await api.post('/auth/signup', payload);
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
