import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADHOC_OFF, ADHOC_RUNNING, ADMIN_USER } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import AdminSettingsMenu from './AdminSettingsMenu';
import QueryConsoleStatus from './QueryConsoleStatus';

/**
 * Administration settings, and the first tool in it.
 *
 * The tool exists because the message it replaces was a dead end: it named
 * `ADHOC_ENABLED` and `ADHOC_DB_PASSWORD` whether or not they were already set,
 * and mentioned the sandbox check without saying whether that was what had
 * happened. Three situations, one sentence, and the only way to tell them apart
 * was to read the server log.
 *
 * What is deliberately absent is a switch. The console is environment-only on
 * purpose, and a control here would move the decision to have a SQL prompt on
 * the production database from somebody with server access to anybody holding an
 * admin session.
 */

function asNonAdmin() {
  server.use(http.get('/auth/me', () => HttpResponse.json({ ...ADMIN_USER, role: 'USER' })));
}

type StatusBody = typeof ADHOC_OFF | typeof ADHOC_RUNNING | Record<string, unknown>;

const status = (body: StatusBody) => server.use(http.get('/api/adhoc', () => HttpResponse.json(body)));

describe('AdminSettingsMenu', () => {
  it('offers an administrator the settings gear', async () => {
    renderApp(<AdminSettingsMenu />, { authenticated: true });

    // Asserted from the admin side first, so the absence test below cannot pass
    // because the control was renamed or dropped for everybody.
    expect(await screen.findByRole('button', { name: /administration settings/i })).toBeInTheDocument();
  });

  it('shows nothing at all to a plain user', async () => {
    asNonAdmin();
    renderApp(
      <>
        <p>Signed in</p>
        <AdminSettingsMenu />
      </>,
      { authenticated: true },
    );

    // Waits for something role-independent first: while the auth query is in
    // flight the gear is absent for everybody, so asserting immediately would
    // pass on the pending state rather than on the role.
    await screen.findByText('Signed in');

    expect(screen.queryByRole('button', { name: /administration settings/i })).not.toBeInTheDocument();
  });

  it('lists its tools under a heading, and opens one', async () => {
    const user = userEvent.setup();
    renderApp(<AdminSettingsMenu />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /administration settings/i }));

    expect(screen.getByText('Database')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /query console/i }));

    // The tool's own content, not just its title: opening a row that renders
    // nothing would look identical from the panel's side.
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/has not been switched on/i)).toBeInTheDocument();
  });
});

describe('QueryConsoleStatus', () => {
  it('says which of the three situations the server is in', async () => {
    // The whole point. "Not enabled" was one sentence for three states, and the
    // remedy differs: set two variables, set one, or fix the database.
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/has not been switched on/i)).toBeInTheDocument();
    expect(screen.getByText(/ADHOC_ENABLED=true/)).toBeInTheDocument();
  });

  it('does not tell somebody to set a variable that is already set', async () => {
    /*
     * `no-password` means `ADHOC_ENABLED` is set. Repeating it in the remedy is
     * how the old message wasted an administrator's time: they check, find it
     * set, and conclude the page is wrong about everything else too.
     */
    status({ ...ADHOC_OFF, reason: 'no-password' });
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/no password to install/i)).toBeInTheDocument();
    expect(screen.getByText(/ADHOC_DB_PASSWORD=/)).toBeInTheDocument();
    expect(screen.queryByText(/ADHOC_ENABLED=true/)).not.toBeInTheDocument();
  });

  it('passes on what the database actually said when the sandbox check failed', async () => {
    // The case an administrator can act on without touching the environment, and
    // the one the old message could not distinguish at all.
    status({ ...ADHOC_OFF, reason: 'sandbox-failed', detail: 'role "nm_adhoc_nmt" does not exist' });
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/would not confirm/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist/)).toBeInTheDocument();
  });

  it('re-checks without a restart, and shows the new answer', async () => {
    status({ ...ADHOC_OFF, reason: 'sandbox-failed', detail: 'role "nm_adhoc_nmt" does not exist' });
    server.use(http.post('/api/adhoc/recheck', () => HttpResponse.json(ADHOC_RUNNING)));

    const user = userEvent.setup();
    renderApp(<QueryConsoleStatus />, { authenticated: true });
    await screen.findByText(/would not confirm/i);

    await user.click(screen.getByRole('button', { name: /check again/i }));

    expect(await screen.findByText(/the console is running/i)).toBeInTheDocument();
  });

  it('names the role it runs as, and that it can only read', async () => {
    // The mode is a database identity rather than an application check, so
    // reporting it is reporting what the console can actually do.
    status(ADHOC_RUNNING);
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/the console is running/i)).toBeInTheDocument();
    expect(screen.getByText('nm_adhoc_netminitoring')).toBeInTheDocument();
    expect(screen.getByText(/read only/i)).toBeInTheDocument();
  });

  it('warns when the console can write', async () => {
    status({ ...ADHOC_RUNNING, role: 'nm_adhocrw_nmt', mode: 'write' });
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/read and write/i)).toBeInTheDocument();
    expect(screen.getByText(/ADHOC_WRITE_ENABLED is set/i)).toBeInTheDocument();
  });

  it('warns when the password may have reached the Postgres log', async () => {
    /*
     * The one thing about this feature an operator cannot discover for
     * themselves: `ALTER ROLE … PASSWORD` puts the value in the statement text,
     * and suppressing statement logging is superuser-only. It was in a boot log
     * nobody re-reads.
     */
    status({ ...ADHOC_RUNNING, passwordMayBeLogged: true });
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/may be in the postgres log/i)).toBeInTheDocument();
  });

  it('does not offer a switch', async () => {
    /*
     * Guarding the design decision, not the code. The console is environment-only
     * because switching it on is an installation's choice rather than a click in
     * a browser session, and the obvious "improvement" to this panel is the one
     * thing it must not grow. "Check again" re-runs the startup check; it cannot
     * enable anything.
     */
    renderApp(<QueryConsoleStatus />, { authenticated: true });
    await screen.findByText(/has not been switched on/i);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    for (const name of [/enable/i, /turn on/i, /switch on/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('reports a failed status request as a failure, not as "off"', async () => {
    // Conflating them gives the wrong instruction: the remedies tell somebody to
    // set variables that may already be set.
    server.use(http.get('/api/adhoc', () => HttpResponse.json({ message: 'Nope' }, { status: 500 })));
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/nope/i)).toBeInTheDocument();
    expect(screen.queryByText(/has not been switched on/i)).not.toBeInTheDocument();
  });
});

describe('the query console page when the console is off', () => {
  it('explains it with the same component the administration panel uses', async () => {
    // One copy of the explanation. Two would eventually say different things,
    // and this is the text an operator acts on.
    const { default: AdhocPage } = await import('../../pages/AdhocPage');
    renderApp(<AdhocPage />, { authenticated: true });

    expect(await screen.findByText(/has not been switched on/i)).toBeInTheDocument();
  });
});

describe('waiting', () => {
  it('says it is asking rather than showing an empty panel', async () => {
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    await waitFor(() => expect(screen.getByText(/asking the server/i)).toBeInTheDocument());
  });
});
