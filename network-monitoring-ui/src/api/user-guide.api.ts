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

export async function closeGuideSession(): Promise<void> {
  await api.delete('/api/user-guide/session');
}
