import axios, { type AxiosError } from 'axios';
import { renderError } from '../i18n/generated/catalog/errors';
import { DEFAULT_LOCALE, type Locale } from '../i18n/generated/locales';
import { parseMessageParams } from '../i18n/generated/message';

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

/**
 * The language errors are described in.
 *
 * Module state, set by `LocaleProvider`, for the same reason the access token
 * above is module state: `describeError` is called from about forty places,
 * most of them inside `catch` blocks in event handlers, and threading a locale
 * through every one of them would be forty edits to say the same thing.
 *
 * The cost is honest and small: an error already on screen when the language is
 * switched keeps the wording it was rendered with, until whatever produced it
 * runs again. Errors are read and dismissed, not kept.
 */
let errorLocale: Locale = DEFAULT_LOCALE;

export function setErrorLocale(locale: Locale): void {
  errorLocale = locale;
}

/**
 * Turns an error into a sentence for a person.
 *
 * Prefers the server's `code`, which is a catalogue key and translates; falls
 * back to its `message`, which is always present and always English. That order
 * matters — a response carries both, deliberately, so that scripts and CI have a
 * stable string to match while a person reads their own language. See
 * api/src/i18n/catalog/errors.en.ts.
 */
export function describeError(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; code?: string; params?: Record<string, unknown> }
      | string
      | undefined;
    if (typeof data === 'string' && data.trim() !== '') return data;
    if (data && typeof data === 'object') {
      if (data.code) return renderError(data.code, parseMessageParams(data.params), errorLocale);
      if (data.message) return data.message;
    }
    if (error.code === 'ERR_NETWORK') {
      return renderError('error.network_unreachable', {}, errorLocale);
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
