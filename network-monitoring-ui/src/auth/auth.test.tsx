import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { getToken } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { renderApp, renderRoutes } from '../test/render';
import { server } from '../test/server';
import LoginPage from './LoginPage';
import PrivateRoute from './PrivateRoute';
import SignUpPage from './SignUpPage';

/**
 * Authentication.
 *
 * These guard the behaviour that used to be wrong: the old build decided you were
 * signed in by AES-decrypting a localStorage string and comparing it against
 * `Love<email>…<password>…`, and it kept your plaintext password in
 * sessionStorage. The rule now is simply "the server accepted our token".
 */

describe('LoginPage', () => {
  it('signs in and stores the token', async () => {
    const user = userEvent.setup();
    renderApp(<LoginPage />);

    await user.type(screen.getByLabelText(/email address/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'correct-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(getToken()).toBe('test-token'));
  });

  it('shows the server message on bad credentials and stores nothing', async () => {
    const user = userEvent.setup();
    renderApp(<LoginPage />);

    await user.type(screen.getByLabelText(/email address/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });

  it('surfaces the rate-limit message rather than a generic failure', async () => {
    server.use(
      http.post('/auth/login', () =>
        HttpResponse.json(
          { message: 'Too many failed attempts. Wait a minute and try again.' },
          { status: 429 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderApp(<LoginPage />);
    await user.type(screen.getByLabelText(/email address/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/too many failed attempts/i)).toBeInTheDocument();
  });

  it('keeps the submit button disabled until both fields are filled', async () => {
    const user = userEvent.setup();
    renderApp(<LoginPage />);

    const submit = screen.getByRole('button', { name: /sign in/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/email address/i), 'admin@example.com');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^password/i), 'correct-password');
    expect(submit).toBeEnabled();
  });

  it('never writes the password to storage', async () => {
    const user = userEvent.setup();
    renderApp(<LoginPage />);

    await user.type(screen.getByLabelText(/email address/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'correct-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(getToken()).toBe('test-token'));

    const everything = JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    });
    expect(everything).not.toContain('correct-password');
  });
});

/**
 * PrivateRoute contains a `<Navigate>`, so it has to be mounted in a real route
 * tree with somewhere to redirect to. Rendered bare, it navigates, re-renders and
 * navigates again forever.
 */
function guardedTree() {
  return (
    <>
      <Route element={<PrivateRoute />}>
        <Route path="/alerts" element={<div>protected content</div>} />
      </Route>
      <Route path="/login" element={<div>login screen</div>} />
    </>
  );
}

describe('the user-guide session', () => {
  /**
   * A component that signs out on demand, so the test drives `logout()` itself
   * rather than the endpoint it calls. That distinction is the whole point here:
   * `DELETE /api/user-guide/session` was already covered, and worked — it was the
   * path that reaches it which did not.
   */
  function SignOutHarness() {
    const { logout, isAuthenticated } = useAuth();
    return (
      <button type="button" onClick={logout}>
        {isAuthenticated ? 'Sign out' : 'Signed out'}
      </button>
    );
  }

  it('clears the cookie with an authenticated request when signing out', async () => {
    /*
     * The bug: `logout()` fired the DELETE and then cleared the stored token in the
     * same tick. Axios request interceptors are asynchronous unless declared
     * otherwise, so the interceptor that attaches `Authorization` ran a microtask
     * later and found no token — the request went out bare, the server answered
     * 401, and the guide cookie outlived the sign-out by up to twelve hours. On a
     * shared machine that is a working credential left behind in the browser.
     */
    const headers: (string | null)[] = [];
    server.use(
      http.delete('/api/user-guide/session', ({ request }) => {
        headers.push(request.headers.get('authorization'));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderApp(<SignOutHarness />, { authenticated: true });
    await screen.findByRole('button', { name: /^sign out$/i });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(headers).toHaveLength(1));
    // The header, not merely the request: an unauthenticated DELETE is refused and
    // leaves the cookie in place, which looks identical from here without this.
    expect(headers[0]).toBe('Bearer test-token');
  });

  it('signs out locally even if the cookie cannot be cleared', async () => {
    // Documentation must never be the reason a sign-out fails to sign you out.
    server.use(http.delete('/api/user-guide/session', () => new HttpResponse(null, { status: 500 })));

    const user = userEvent.setup();
    renderApp(<SignOutHarness />, { authenticated: true });
    await screen.findByRole('button', { name: /^sign out$/i });

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(getToken()).toBeNull());
  });

  it('re-mints when a tab that slept becomes visible, and not on every alt-tab', async () => {
    /*
     * Two halves of one rule.
     *
     * The cookie is deliberately shorter-lived than the session, so a tab nobody
     * reloads eventually holds a valid session and an expired cookie — and
     * clicking help then lands on the sign-in page. A timer covers a tab that
     * stays visible; the visibility listener covers the one that does not,
     * because a machine that slept through the whole interval never fired it.
     *
     * But `visibilitychange` fires on every alt-tab and window switch, so
     * unthrottled it sent a mint per focus where the intent needs one per
     * interval — cheap, and indistinguishable in the logs from a session that
     * genuinely needed renewing. The clock is moved rather than faked so React
     * Query and MSW keep their real timers.
     */
    let minted = 0;
    server.use(
      http.post('/api/user-guide/session', () => {
        minted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp(<SignOutHarness />, { authenticated: true });
    // One from the mount, once the stored token has been validated.
    await waitFor(() => expect(minted).toBe(1));

    // An immediate return to the tab has nothing to renew.
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(minted).toBe(1));

    // Five hours later — a laptop that slept through the four-hour interval.
    vi.setSystemTime(Date.now() + 5 * 60 * 60 * 1000);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(minted).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LoginPage when already signed in', () => {
  it('sends a signed-in visitor on rather than showing a sign-in form', async () => {
    /*
     * Not a URL-typing edge case. The user-guide gate answers a missing or expired
     * cookie with a redirect to `/login`, and that cookie is deliberately
     * shorter-lived than the session — so this is the page a signed-in user reaches
     * by clicking help after a long day. Showing them a sign-in form reads as
     * having been signed out when they have not been.
     */
    renderRoutes(
      <>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Dashboard</p>} />
      </>,
      { authenticated: true, route: '/login' },
    );

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('still shows the form while the stored token is being checked', async () => {
    // `isAuthenticated` is false until /auth/me answers. Redirecting on that would
    // bounce a genuine visitor off the page they need.
    renderApp(<LoginPage />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});

describe('PrivateRoute', () => {
  it('redirects to /login when there is no token', async () => {
    renderRoutes(guardedTree(), { route: '/alerts' });

    expect(await screen.findByText(/login screen/i)).toBeInTheDocument();
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('shows a spinner while the stored token is being validated', () => {
    renderRoutes(guardedTree(), { route: '/alerts', authenticated: true });
    // Without this the guard would bounce to /login on every reload.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/login screen/i)).not.toBeInTheDocument();
  });

  it('renders the guarded page once the token checks out', async () => {
    renderRoutes(guardedTree(), { route: '/alerts', authenticated: true });
    expect(await screen.findByText(/protected content/i)).toBeInTheDocument();
  });

  it('drops a rejected token and redirects to /login', async () => {
    server.use(
      http.get('/auth/me', () => HttpResponse.json({ message: 'Invalid or expired token' }, { status: 401 })),
    );

    renderRoutes(guardedTree(), { route: '/alerts', authenticated: true });

    expect(await screen.findByText(/login screen/i)).toBeInTheDocument();
    await waitFor(() => expect(getToken()).toBeNull());
  });
});

/**
 * Account creation.
 *
 * Guards a verified privilege-escalation hole. This page used to render an open
 * registration form — including a Role dropdown offering Administrator — against
 * an endpoint that required no authentication and honoured that role. Loading it
 * was enough to take over the installation.
 *
 * The API is the real enforcement point and has its own regression suite in
 * `api/src/services/signup-policy.test.ts`. What is checked here is that the UI
 * stops advertising a capability the server will refuse, and never offers the role
 * field to someone whose choice would be ignored.
 */
describe('SignUpPage', () => {
  const signupMode = (mode: 'first-admin' | 'open' | 'admin-only') =>
    server.use(
      http.get('/auth/signup-allowed', () => HttpResponse.json({ allowed: mode !== 'admin-only', mode })),
    );

  it('offers no form at all when accounts are admin-only', async () => {
    signupMode('admin-only');
    renderApp(<SignUpPage />);

    expect(await screen.findByText(/account creation is restricted/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
    // And it says how to proceed rather than leaving a dead end.
    expect(screen.getByText(/npm run user -- create/i)).toBeInTheDocument();
  });

  it('presents first-time setup on an empty installation', async () => {
    signupMode('first-admin');
    renderApp(<SignUpPage />);

    expect(await screen.findByText(/create the first administrator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create administrator/i })).toBeInTheDocument();
  });

  it('hides the role field from an unauthenticated visitor', async () => {
    // The heart of the fix: the field existed, defaulted to a dropdown containing
    // Administrator, and the server honoured it.
    signupMode('first-admin');
    renderApp(<SignUpPage />);

    await screen.findByText(/create the first administrator/i);
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
  });

  it('hides the role field under open registration too', async () => {
    // The server forces USER here, so offering the choice would misrepresent it.
    signupMode('open');
    renderApp(<SignUpPage />);

    await screen.findByRole('button', { name: /sign up/i });
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
  });

  it('shows the role field to a signed-in administrator, whose choice is honoured', async () => {
    signupMode('admin-only');
    renderApp(<SignUpPage />, { authenticated: true });

    // Waits for AuthProvider to resolve /auth/me as the ADMIN fixture.
    expect(await screen.findByLabelText(/role/i)).toBeInTheDocument();
    expect(screen.getByText(/you are an administrator/i)).toBeInTheDocument();
  });
});
