import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlertsPage from '../pages/AlertsPage';
import SuppressionsPage from '../pages/SuppressionsPage';
import { renderApp } from '../test/render';
import LanguageToggle from './LanguageToggle';
import { SeverityChip } from './SeverityChip';

/**
 * Switching language has to replace what is on screen, not add to it.
 *
 * Reported from the running application: going from Dari to German left Dari
 * words visible. Every guard was green — the catalogues are complete, parity
 * holds, and `t` is in the dependency list of the memos that read it — so this is
 * a failure no static check can see. It has to be driven.
 *
 * Dari to German specifically, because that pair changes direction as well as
 * vocabulary, and a stale render is easiest to mistake for a layout quirk when
 * the layout is also flipping.
 */
describe('switching language', () => {
  it('replaces the previous language rather than leaving it on screen', async () => {
    const user = userEvent.setup();

    renderApp(
      <>
        <LanguageToggle />
        <SeverityChip severity="critical" />
      </>,
    );

    // English first, so the starting point is not the language under test.
    expect(await screen.findByText('Critical')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'دری' }));
    await waitFor(() => expect(screen.getByText('بحرانی')).toBeInTheDocument());
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deutsch' }));
    await waitFor(() => expect(screen.getByText('Kritisch')).toBeInTheDocument());

    // The assertion the report is about: the previous language must be gone, not
    // merely joined by the new one.
    expect(screen.queryByText('بحرانی')).not.toBeInTheDocument();
  });

  it('re-translates a data grid, not just the components around it', async () => {
    /*
     * The grid holds most of the visible words — column headings, the pager, the
     * column menu — and is the part a plain component test does not exercise:
     * material-react-table keeps its own options and chrome, so a locale change
     * has to reach through it rather than merely re-render above it.
     */
    const user = userEvent.setup();

    renderApp(
      <>
        <LanguageToggle />
        <AlertsPage />
      </>,
      { authenticated: true },
    );

    expect(
      await screen.findByRole('columnheader', { name: /Severity/i }, { timeout: 10_000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'دری' }));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /شدت/ })).toBeInTheDocument(), {
      timeout: 10_000,
    });

    await user.click(screen.getByRole('button', { name: 'Deutsch' }));
    await waitFor(
      () => expect(screen.getByRole('columnheader', { name: /Schweregrad/ })).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.queryByRole('columnheader', { name: /شدت/ })).not.toBeInTheDocument();
  });

  it('re-translates a banner that was already on screen', async () => {
    /*
     * The mechanism that matches the report most closely, and the one neither
     * case above covers: a message put into component state as an
     * already-rendered string keeps the language it was rendered in, so
     * switching afterwards leaves the old words sitting there while everything
     * around them changes.
     *
     * Driven through a real page rather than a stand-in component, because the
     * pattern was in sixteen call sites and a stand-in would go on passing after
     * any one of them regressed. Suppressions is the shortest route to a banner
     * that survives on screen: delete a rule, and the confirmation stays until
     * it is dismissed.
     */
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderApp(
      <>
        <LanguageToggle />
        <SuppressionsPage />
      </>,
      { authenticated: true },
    );

    await user.click(await screen.findByRole('button', { name: /Delete rule 1/i }));
    expect(await screen.findByText('Rule deleted.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deutsch' }));

    // Still on screen, so it has to be in the language the reader just chose
    // rather than the one it happened to be raised in.
    await waitFor(() => expect(screen.getByText('Regel gelöscht.')).toBeInTheDocument());
    expect(screen.queryByText('Rule deleted.')).not.toBeInTheDocument();
  });
});
