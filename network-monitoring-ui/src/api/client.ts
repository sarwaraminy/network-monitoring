import axios, { type AxiosError } from 'axios';
import { knowsError, renderError } from '../i18n/generated/catalog/errors';
import { DEFAULT_LOCALE, type Locale } from '../i18n/generated/locales';
import { parseMessageParams } from '../i18n/generated/message';
import { translate } from '../i18n/ui';

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
 *
 * The code is used only when this bundle actually knows it. A key it does not
 * have would otherwise be rendered as itself, so the reader gets
 * `error.session_expired` while the English sentence explaining it sits unused on
 * the next line of the same response. That is the skew this two-field design
 * invites rather than an edge case: the server ships a new code, a browser holds
 * a bundle from before it, and during a rolling deploy both versions are live.
 * Falling through to `message` costs a translation and keeps the meaning.
 */
export function describeError(error: unknown, fallback?: string): string {
  // Rendered here rather than as a parameter default: `describeError` is not a
  // component, so it reads the locale the client is already tracking for the
  // error catalogue rather than taking a hook it cannot have.
  const generic = fallback ?? translate(errorLocale, 'common.something_wrong');
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; code?: string; params?: Record<string, unknown> }
      | string
      | undefined;
    if (typeof data === 'string' && data.trim() !== '') return data;
    if (data && typeof data === 'object') {
      if (data.code && knowsError(data.code)) {
        return renderError(data.code, parseMessageParams(data.params), errorLocale);
      }
      if (data.message) return data.message;
      // A code this bundle does not know, and no message beside it. The key is a
      // poor thing to show, and it is still better than "Something went wrong"
      // — it is the one string that identifies what happened.
      if (data.code) return data.code;
    }
    if (error.code === 'ERR_NETWORK') {
      return renderError('error.network_unreachable', {}, errorLocale);
    }
    return error.message || generic;
  }
  if (error instanceof Error && error.message) return error.message;
  return generic;
}
