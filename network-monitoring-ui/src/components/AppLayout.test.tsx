import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADMIN_USER } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import AppLayout from './AppLayout';

/**
 * The navigation, and who is offered what.
 *
 * `NAV_ITEMS` had no notion of a role until the audit trail needed one: every entry
 * was shown to every account. That was harmless while every page was reachable by
 * everybody, and stopped being harmless the moment one was not — an ADMIN-only page
 * advertised in the sidebar is a link that answers 403, which reads as a broken
 * product rather than as a permission. The same argument as the per-row delete on
 * the alerts table, one layer out.
 *
 * The server is still what enforces it. This only stops offering the link.
 */

function asNonAdmin() {
  server.use(http.get('/auth/me', () => HttpResponse.json({ ...ADMIN_USER, role: 'USER' })));
}

/** Anything role-independent, so a test can tell "not admin" from "not loaded yet". */
const ALWAYS = /security alerts/i;

describe('AppLayout navigation', () => {
  it('offers an administrator the admin-only entries', async () => {
    renderApp(<AppLayout />, { authenticated: true });

    // Asserted from the admin side first, so the absence test below cannot pass
    // because the entry was renamed or dropped for everybody.
    expect(await screen.findAllByRole('link', { name: /activity/i })).not.toHaveLength(0);
  });

  it('does not offer a plain user a page the server would refuse', async () => {
    asNonAdmin();
    renderApp(<AppLayout />, { authenticated: true });

    // Wait for a role-independent entry first: while the auth query is in flight
    // the admin entry is absent for everyone, so asserting straight away would pass
    // on the pending state rather than on the role.
    await screen.findAllByRole('link', { name: ALWAYS });

    expect(screen.queryAllByRole('link', { name: /activity/i })).toHaveLength(0);
  });

  it('still offers a plain user everything that is not admin-only', async () => {
    // The other half: filtering by role must not quietly remove the rest of the
    // navigation from a non-admin.
    asNonAdmin();
    renderApp(<AppLayout />, { authenticated: true });

    for (const label of [/dashboard/i, /security alerts/i, /suppressions/i, /threat intel/i, /delivery/i]) {
      expect(await screen.findAllByRole('link', { name: label })).not.toHaveLength(0);
    }
  });
});
