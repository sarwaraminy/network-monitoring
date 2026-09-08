import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n/ui';
import { ADHOC_OFF, ADHOC_RUNNING, ADMIN_USER } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import AdminSettingsMenu, { ADMIN_GROUPS } from './AdminSettingsMenu';
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
 * Two tools now: this panel diagnoses, and `QueryConsoleSettings` edits. The
 * split is deliberate — the diagnostics have to be readable when the console is
 * off and nothing can be changed, and they are the same component the console
 * page itself shows.
 *
 * What no amount of editing can supply is `ADHOC_DB_PASSWORD`. It stays in the
 * environment, so the decision to *have* a SQL prompt on the production database
 * remains with whoever installed the server; what an administrator gained is
 * switching a provisioned console on and off without a restart.
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
    // By its label rather than its accessible name: the row's name includes its
    // description, and the panel now holds a second row whose label starts the
    // same way, so a substring match on the name matches both.
    await user.click(screen.getByText('Query console'));

    // The tool's own content, not just its title: opening a row that renders
    // nothing would look identical from the panel's side.
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/has not been switched on/i)).toBeInTheDocument();
  });

  it('opens the settings tool, in a dialog that can be dragged', async () => {
    /*
     * The second tool, reached the way an administrator reaches it. A component
     * that only its own test file renders is a component nobody can get to, and
     * this one is the whole point of the panel — the diagnostics say what is
     * wrong, the settings are where it gets fixed.
     *
     * The drag handle is asserted here rather than in `AppDialog`'s own tests
     * because it is what makes the tool usable at all: the settings sit over the
     * page whose numbers an operator is trying to reconcile with them.
     */
    const user = userEvent.setup();
    renderApp(<AdminSettingsMenu />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /administration settings/i }));
    await user.click(screen.getByText('Query console settings'));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('switch', { name: 'Query console' })).toBeInTheDocument();
    expect(dialog.querySelector('[data-drag-handle]')).not.toBeNull();
  });

  it('groups its tools, and every group has something in it', async () => {
    /*
     * A heading over nothing reads as a section that failed to load — the same
     * failure `navItems` guards against on the sidebar. Asserted over the real
     * `ADMIN_GROUPS` rather than a constructed one, because this list is edited
     * by hand every time a tool is added and an empty group is exactly what a
     * half-finished edit leaves behind.
     */
    const user = userEvent.setup();
    renderApp(<AdminSettingsMenu />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /administration settings/i }));

    for (const group of ADMIN_GROUPS) {
      // Rendered through the catalogue, so the assertion goes through it too —
      // asserting the key would pass against a menu showing raw keys.
      expect(screen.getByText(translate('en', group.headingKey))).toBeInTheDocument();
      expect(group.items.length).toBeGreaterThan(0);
      // Each item's label is on screen, so a group cannot pass by its heading
      // alone.
      for (const item of group.items) {
        expect(screen.getByText(translate('en', item.labelKey))).toBeInTheDocument();
      }
    }
  });

  it('opens the delivery settings without leaving the page', async () => {
    /*
     * The settings moved here from the Delivery page, which is why the page's
     * navigation entry became admin-only. The same component either way — two
     * forms over one three-layer resolution would eventually disagree about which
     * fields are pinned, and the one nobody was looking at would be wrong.
     */
    const user = userEvent.setup();
    renderApp(<AdminSettingsMenu />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /administration settings/i }));
    await user.click(screen.getByText('Delivery settings'));

    const dialog = await screen.findByRole('dialog');
    // A field only the delivery form has, so this cannot pass on the dialog
    // chrome alone.
    expect(await within(dialog).findByLabelText(/minimum severity/i)).toBeInTheDocument();
  });

  it('opens the accounts tool', async () => {
    const user = userEvent.setup();
    renderApp(<AdminSettingsMenu />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /administration settings/i }));
    await user.click(screen.getByText('Users and roles'));

    const dialog = await screen.findByRole('dialog');
    // Plural: there is one control per account, which is the point of the tool.
    expect(await within(dialog).findAllByLabelText(/^Role for /)).not.toHaveLength(0);
  });
});

describe('QueryConsoleStatus', () => {
  it('says which of the three situations the server is in', async () => {
    // The whole point. "Not enabled" was one sentence for three states, and the
    // remedy differs: switch it on, give it a password, or fix the database.
    renderApp(<QueryConsoleStatus />, { authenticated: true });

    expect(await screen.findByText(/has not been switched on/i)).toBeInTheDocument();
    // Points at the settings panel, not at a file. This used to print
    // `ADHOC_ENABLED=true` under "In the API environment", which since V15 sends
    // an administrator without server access to a dead end one row above the
    // panel that would have done it.
    expect(screen.getByText(/Query console settings/i)).toBeInTheDocument();
    // Says a restart is NOT needed, rather than asking for one. A bare
    // /restart/i assertion was self-defeating, since the remedy's own text is
    // "No restart needed".
    expect(screen.getByText(/no restart needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/restart it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/API environment/i)).not.toBeInTheDocument();
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
    // Where to set one, rather than which variable to go and edit.
    expect(screen.getByText(/Query console settings/i)).toBeInTheDocument();
    // And still not repeating the thing that is already done — the original
    // point of this test.
    expect(screen.queryByText(/switch it on/i)).not.toBeInTheDocument();
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
    // "Write mode is on", not the variable name: since V15 the setting can come
    // from the stored row, so naming ADHOC_WRITE_ENABLED pointed an operator at
    // a line that may not exist.
    expect(screen.getByText(/write mode is on/i)).toBeInTheDocument();
    expect(screen.queryByText(/ADHOC_WRITE_ENABLED/)).not.toBeInTheDocument();
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

  it('diagnoses without offering to change anything', async () => {
    /*
     * The split between the two tools, asserted from this side. This component is
     * also the explanation the console page itself renders when the console is
     * off, and that page must stay readable without offering to change anything:
     * a switch there would be a second copy of the one in the settings tool, and
     * two copies eventually disagree about what is in force. "Check again"
     * re-runs the startup check against the environment as it stands; it grants
     * nothing, which is why it is not a control.
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
