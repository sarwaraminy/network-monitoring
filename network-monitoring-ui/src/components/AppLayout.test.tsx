import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADMIN_USER } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import AppLayout from './AppLayout';

/**
 * The navigation panel: who is offered what, and how the panel behaves.
 *
 * `jsdom`'s `matchMedia` always answers false (see test/setup.ts), so
 * `useMediaQuery(down('md'))` is false and these render the DESKTOP mounting —
 * the permanent panel rather than the temporary drawer. That is the mounting
 * worth pinning: the drawer renders the same `SideNav` over the same filtered
 * groups, so the only thing untested here is which of the two is chosen.
 *
 * Role filtering itself is asserted in navItems.test.ts against plain data. What
 * is left for this file is what only exists once it is rendered.
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
    expect(await screen.findAllByRole('link', { name: /audit trail/i })).not.toHaveLength(0);
  });

  it('does not offer a plain user a page the server would refuse', async () => {
    asNonAdmin();
    renderApp(<AppLayout />, { authenticated: true });

    // Wait for a role-independent entry first: while the auth query is in flight
    // the admin entry is absent for everyone, so asserting straight away would pass
    // on the pending state rather than on the role.
    await screen.findAllByRole('link', { name: ALWAYS });

    expect(screen.queryAllByRole('link', { name: /audit trail/i })).toHaveLength(0);
  });

  it('still offers a plain user everything that is not admin-only', async () => {
    asNonAdmin();
    renderApp(<AppLayout />, { authenticated: true });

    for (const label of [/dashboard/i, /security alerts/i, /suppressions/i, /threat intel/i, /delivery/i]) {
      expect(await screen.findAllByRole('link', { name: label })).not.toHaveLength(0);
    }
  });

  it('mounts one navigation, not one per breakpoint', async () => {
    // The desktop panel and the mobile drawer are alternatives. Rendering both
    // and hiding one puts every link in the document twice, which reads as a
    // duplicate to a screen reader and gives the keyboard a panel to tab through
    // that nobody can see.
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findAllByRole('link', { name: ALWAYS });

    expect(screen.getAllByRole('navigation', { name: /main/i })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: ALWAYS })).toHaveLength(1);
  });

  it('files each entry under its own section heading', async () => {
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findAllByRole('link', { name: ALWAYS });

    // The section header is the button that expands it, so that button is what
    // identifies the section — asserting on the label alone would pass even if
    // the grouping rendered every link under the first heading.
    const security = screen.getByRole('button', { name: /^security$/i });
    const section = security.parentElement;
    expect(section).not.toBeNull();
    expect(within(section!).getByRole('link', { name: /suppressions/i })).toBeInTheDocument();
    expect(within(section!).queryByRole('link', { name: /dashboard/i })).toBeNull();
  });

  it('marks the current page, and only the current page', async () => {
    renderApp(<AppLayout />, { authenticated: true, route: '/alerts' });

    const current = await screen.findByRole('link', { name: ALWAYS });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /suppressions/i })).not.toHaveAttribute('aria-current');
  });
});

describe('AppLayout section disclosure', () => {
  it('starts with every section open', async () => {
    // Eight entries all fit at once, so the state needing no interaction to be
    // useful is the open one.
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    expect(screen.getByRole('button', { name: /^security$/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes a section from its header row', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.click(screen.getByRole('button', { name: /^security$/i }));

    expect(screen.getByRole('button', { name: /^security$/i })).toHaveAttribute('aria-expanded', 'false');
    // Its neighbours are untouched — closing one section is not closing the list.
    expect(screen.getByRole('button', { name: /^capture$/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the section holding the current page, whatever else is closed', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true, route: '/dashboard' });
    await screen.findByRole('link', { name: ALWAYS });

    await user.click(screen.getByRole('button', { name: /^security$/i }));
    expect(screen.getByRole('button', { name: /^security$/i })).toHaveAttribute('aria-expanded', 'false');

    // Navigating into the closed section must not leave the current page folded
    // away with nothing on screen saying where you are.
    await user.click(screen.getByRole('link', { name: ALWAYS }));

    expect(screen.getByRole('button', { name: /^security$/i })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('AppLayout panel search', () => {
  it('reduces the panel to matching entries', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.type(screen.getByRole('textbox', { name: /search navigation/i }), 'capture');

    expect(screen.getByRole('link', { name: /capture by ip/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^dashboard$/i })).toBeNull();
    // A section left with nothing in it goes too, rather than standing as an
    // empty heading.
    expect(screen.queryByRole('button', { name: /^overview$/i })).toBeNull();
  });

  it('says so when nothing matches, rather than showing an empty panel', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.type(screen.getByRole('textbox', { name: /search navigation/i }), 'zzzz');

    expect(screen.getByText(/no pages match/i)).toBeInTheDocument();
  });

  it('restores the full list, and the sections the user had closed, on clear', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.click(screen.getByRole('button', { name: /^capture$/i }));
    await user.type(screen.getByRole('textbox', { name: /search navigation/i }), 'capture');
    // A result the user cannot see is not a result: searching opens what matches.
    expect(screen.getByRole('button', { name: /^capture$/i })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: /clear search/i }));

    expect(screen.getByRole('link', { name: /^dashboard$/i })).toBeInTheDocument();
    // The hand-closed section comes back closed. Searching borrowed the state, it
    // did not overwrite it.
    expect(screen.getByRole('button', { name: /^capture$/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('AppLayout panel collapse', () => {
  it('starts expanded, with labels showing', async () => {
    renderApp(<AppLayout />, { authenticated: true });

    expect(await screen.findByText('Security Alerts')).toBeInTheDocument();
  });

  it('collapses to a rail of section icons', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.click(screen.getByRole('button', { name: /collapse navigation/i }));

    // The rail carries one control per SECTION, not per page — that is the
    // design's own trade, and the reason the toggle has to stay reachable.
    expect(screen.getByRole('button', { name: /^security$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ALWAYS })).toBeNull();
    expect(screen.getByRole('button', { name: /expand navigation/i })).toBeInTheDocument();
  });

  it('opens the panel AND the section when a rail icon is clicked', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    // Close Security first, so the click has both halves to do.
    await user.click(screen.getByRole('button', { name: /^security$/i }));
    await user.click(screen.getByRole('button', { name: /collapse navigation/i }));

    await user.click(screen.getByRole('button', { name: /^security$/i }));

    // Half of this went wrong in the source every time it was wired per screen:
    // the panel opened without the section, or the section without the panel.
    expect(screen.getByRole('button', { name: /collapse navigation/i })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: ALWAYS })).toBeInTheDocument();
  });

  it('remembers the collapsed state across a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.click(screen.getByRole('button', { name: /collapse navigation/i }));
    unmount();

    // A fresh mount is what a reload looks like from here: same storage, new tree.
    renderApp(<AppLayout />, { authenticated: true });

    expect(await screen.findByRole('button', { name: /expand navigation/i })).toBeInTheDocument();
    expect(screen.queryByText('Security Alerts')).toBeNull();
  });

  it('expands again from the same control', async () => {
    const user = userEvent.setup();
    renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('link', { name: ALWAYS });

    await user.click(screen.getByRole('button', { name: /collapse navigation/i }));
    await user.click(screen.getByRole('button', { name: /expand navigation/i }));

    expect(screen.getByText('Security Alerts')).toBeInTheDocument();
  });
});
