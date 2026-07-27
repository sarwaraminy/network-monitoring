import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { getToken } from '../api/client';
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
