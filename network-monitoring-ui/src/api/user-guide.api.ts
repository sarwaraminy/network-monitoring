import { api } from './client';

/**
 * The user guide's session, which is a cookie rather than the usual token.
 *
 * The guide is pages a browser navigates to, so the request that fetches its
 * stylesheet or a screenshot carries no `Authorization` header — nothing of ours
 * is running to add one. The API therefore gates it on an HttpOnly cookie scoped
 * to `/user-guide`, and these two calls are how it comes and goes.
 *
 * Both are best-effort by design. Failing to mint the cookie means the help link
 * bounces to the sign-in page, which is a poor experience; failing to *use* the
 * application because documentation could not be unlocked would be a worse one.
 */
export async function openGuideSession(): Promise<void> {
  await api.post('/api/user-guide/session');
}

/**
 * Clears the cookie. Takes the token explicitly, and that is not a convenience.
 *
 * Sign-out calls this and then clears the stored access token in the same tick.
 * Axios request interceptors are asynchronous unless declared otherwise, so the
 * interceptor that attaches `Authorization` runs a microtask later — by which time
 * the stored token is already null. The request went out with no header at all, the
 * server answered 401, and the cookie survived the sign-out that was meant to end
 * it: on a shared machine, a working credential left in the browser.
 *
 * Passing the token in the config puts the header on the request before any of that
 * can happen, and the interceptor leaves it alone because it only sets the header
 * when it has a token of its own.
 */
export async function closeGuideSession(token: string | null): Promise<void> {
  await api.delete('/api/user-guide/session', {
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
}
