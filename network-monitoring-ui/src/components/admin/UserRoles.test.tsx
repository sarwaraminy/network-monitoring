import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import UserRoles from './UserRoles';

/**
 * Accounts and their roles, from the administrator's side.
 *
 * Role decides what every other guard in this application answers, and it was
 * settable only in the database until now. It is also the most dangerous tool in
 * the panel, because every way of getting it wrong is a lockout: demote the last
 * administrator and the page that would undo it sits behind the guard that just
 * closed.
 *
 * The server enforces the refusals — a list can be stale by the time somebody
 * clicks — so what these cases are about is the form not OFFERING the two moves
 * it knows will be refused, and saying why rather than presenting a dead
 * control.
 */

/** Replaces the account list for one test. */
const accounts = (rows: unknown[]) => server.use(http.get('/auth/users', () => HttpResponse.json(rows)));

const selectFor = (email: string) => screen.findByLabelText(`Role for ${email}`);

/*
 * MUI renders a `TextField select` as a `div role="combobox"` — not a native
 * `<select>` — so `disabled` becomes `aria-disabled` plus a `Mui-disabled`
 * class, and jest-dom's `toBeDisabled()`/`toBeEnabled()` see neither. They pass
 * on any div, in both directions, which is how these two assertions first looked
 * green in the wrong shape. `aria-disabled` is what the control actually says,
 * and it is also what a screen reader reads.
 */
const expectLocked = (element: HTMLElement) => expect(element).toHaveAttribute('aria-disabled', 'true');
const expectOpen = (element: HTMLElement) => expect(element).not.toHaveAttribute('aria-disabled');

describe('changing a role', () => {
  it('promotes an account and says what happened', async () => {
    const user = userEvent.setup();
    let sent: { id: string; role: string } | null = null;
    server.use(
      http.patch('/auth/users/:id/role', async ({ params, request }) => {
        const { role } = (await request.json()) as { role: string };
        sent = { id: String(params.id), role };
        return HttpResponse.json({ ...ACCOUNTS[2], role });
      }),
    );

    renderApp(<UserRoles />, { authenticated: true });

    await user.click(await selectFor('plain@example.com'));
    // The label is translated; the value posted below is still the identifier.
    await user.click(screen.getByRole('option', { name: 'Administrator' }));

    await waitFor(() => expect(sent).toEqual({ id: '3', role: 'ADMIN' }));
    // Confirmation naming the account, because the select snapping back to the
    // new value looks identical to a request that never left.
    expect(await screen.findByText(/plain@example.com is now ADMIN/i)).toBeInTheDocument();
  });

  it("will not offer to change the signed-in administrator's own role", async () => {
    /*
     * The server refuses this outright, even with another administrator present
     * where it would be recoverable: the session doing it loses the page it is
     * standing on the moment it succeeds. Disabled here so the refusal is not
     * something a reader discovers by being told no.
     */
    renderApp(<UserRoles />, { authenticated: true });

    // `/auth/me` returns ADMIN_USER, which is this row.
    const own = await selectFor('admin@example.com');
    expectLocked(own);
    expect(screen.getByText(/cannot change your own role/i)).toBeInTheDocument();

    // Another administrator's row is still editable, so this is about identity
    // rather than about the form being inert.
    expectOpen(await selectFor('second-admin@example.com'));
  });

  it('will not offer to demote the only administrator', async () => {
    /*
     * The unrecoverable case. With role settable nowhere else, this would put
     * every administrative function — including this tool — behind a psql session
     * on the server, which is the person the whole panel exists to avoid needing.
     */
    accounts([ACCOUNTS[0], ACCOUNTS[2]]);
    renderApp(<UserRoles />, { authenticated: true });

    const only = await selectFor('admin@example.com');
    expectLocked(only);
    // A plain user can still be promoted — which is exactly the remedy the
    // message names, so it has to remain available.
    expectOpen(await selectFor('plain@example.com'));
  });

  it('advises promoting a second administrator while there is only one', async () => {
    // Not about locking anyone out: with one administrator, a forgotten password
    // means editing the database by hand. Worth saying before that happens.
    accounts([ACCOUNTS[0], ACCOUNTS[2]]);
    renderApp(<UserRoles />, { authenticated: true });

    expect(await screen.findByText(/one administrator/i)).toBeInTheDocument();
  });

  it('says nothing about it once there are two', async () => {
    renderApp(<UserRoles />, { authenticated: true });

    await selectFor('plain@example.com');
    expect(screen.queryByText(/promoting a second/i)).not.toBeInTheDocument();
  });

  it("surfaces the server's own refusal, which names which one it was", async () => {
    /*
     * The form disables what it can predict, but its list can be stale: another
     * administrator may have been demoted between this render and the click. The
     * server's message distinguishes the three refusals and each has a different
     * remedy, so it is shown verbatim rather than replaced with "could not save".
     */
    const user = userEvent.setup();
    server.use(
      http.patch('/auth/users/:id/role', () =>
        HttpResponse.json(
          { message: 'This is the only administrator left; promote another account first.' },
          { status: 409 },
        ),
      ),
    );
    renderApp(<UserRoles />, { authenticated: true });

    await user.click(await selectFor('second-admin@example.com'));
    await user.click(screen.getByRole('option', { name: 'User' }));

    expect(await screen.findByText(/only administrator left/i)).toBeInTheDocument();
  });

  it('names each row control, so they are not sixteen identical selects', async () => {
    // Every select labelled "Role" would leave each one unaddressable — by a
    // screen reader and by a test alike. The same ambiguity the Delivery page's
    // "Clear" buttons still have.
    renderApp(<UserRoles />, { authenticated: true });

    await selectFor('plain@example.com');
    expect(screen.getAllByLabelText(/^Role for /)).toHaveLength(ACCOUNTS.length);
  });

  it('marks which row is the reader', async () => {
    // Otherwise the disabled control on that row reads as a bug rather than as
    // "this one is you".
    renderApp(<UserRoles />, { authenticated: true });

    expect(await screen.findByText('you')).toBeInTheDocument();
  });

  it('reports a failed read instead of an empty table', async () => {
    // An empty account list reads as "there are no accounts", which for this
    // screen is a claim nobody should make on a failed request.
    server.use(http.get('/auth/users', () => HttpResponse.json({ message: 'Nope' }, { status: 500 })));
    renderApp(<UserRoles />, { authenticated: true });

    expect(await screen.findByText(/nope/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers no way to create or delete an account', async () => {
    /*
     * Guarding the scope. Sign-up has its own policy deciding who may call it and
     * when, and an account referenced by suppression rules and audit rows is not
     * something to remove from a settings dialog — the trail would be left
     * pointing at an id nobody can resolve.
     */
    renderApp(<UserRoles />, { authenticated: true });

    await selectFor('plain@example.com');
    for (const name of [/delete/i, /remove/i, /add account/i, /new account/i, /invite/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
