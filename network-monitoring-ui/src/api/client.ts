import axios, { type AxiosError } from 'axios';

const TOKEN_STORAGE_KEY = 'nmt.token';

/**
 * The token lives in one place instead of being read from localStorage at every
 * call site, and the interceptor attaches it so no component has to.
 */
let accessToken: string | null = localStorage.getItem(TOKEN_STORAGE_KEY);

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string | null): void {
  accessToken = token;
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_SERVER ?? '',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/** Notified when the server rejects our token, so AuthContext can sign the user out. */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      setToken(null);
      for (const listener of unauthorizedListeners) listener();
    }
    return Promise.reject(error);
  },
);

/** Pulls the server's `{ message }` out of an error, with sensible fallbacks. */
export function describeError(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | string | undefined;
    if (typeof data === 'string' && data.trim() !== '') return data;
    if (data && typeof data === 'object' && data.message) return data.message;
    if (error.code === 'ERR_NETWORK') return 'Cannot reach the API server. Is it running?';
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
