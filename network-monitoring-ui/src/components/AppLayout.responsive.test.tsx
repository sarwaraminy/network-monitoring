import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import AppLayout from './AppLayout';

/**
 * What happens when the window crosses the `md` breakpoint.
 *
 * A separate file because of the mock below. `jsdom`'s `matchMedia` always
 * answers false and never fires a change event, so the breakpoint cannot move
 * under the component the way it does when someone rotates a tablet — and
 * `AppLayout` swaps its whole navigation on that one boolean. Mocking
 * `useMediaQuery` makes the crossing something a test can perform; keeping it in
 * its own file stops the mock leaking into the twenty tests next door that want
 * the real thing.
 */
const viewport = vi.hoisted(() => ({ compact: false }));

vi.mock('@mui/material/useMediaQuery', () => ({
  __esModule: true,
  default: () => viewport.compact,
}));

/** The panel and the drawer both render this landmark; neither renders it closed. */
const NAV = { name: /main/i } as const;

beforeEach(() => {
  viewport.compact = false;
});

describe('AppLayout across the md breakpoint', () => {
  it('does not re-open the drawer after a round trip through desktop width', async () => {
    const user = userEvent.setup();
    viewport.compact = true;

    const { rerender } = renderApp(<AppLayout />, { authenticated: true });
    await user.click(await screen.findByRole('button', { name: /open navigation/i }));
    expect(screen.getByRole('navigation', NAV)).toBeInTheDocument();

    // Widen past md. The drawer unmounts; the desktop panel takes over.
    viewport.compact = false;
    rerender(<AppLayout />);
    expect(screen.getByRole('button', { name: /collapse navigation/i })).toBeInTheDocument();

    // Narrow again. `drawerOpen` outlived the breakpoint that gave it meaning,
    // and while the drawer was mounted at every width that was harmless — it sat
    // behind the desktop layout. Mounted conditionally, the stale `true` is
    // applied fresh, and the sheet appears over the page with nobody having
    // touched the button.
    viewport.compact = true;
    rerender(<AppLayout />);

    expect(screen.queryByRole('navigation', NAV)).toBeNull();
    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument();
  });

  it('still opens the drawer on demand after the round trip', async () => {
    // The other half: closing it on the way back must not leave the button inert.
    const user = userEvent.setup();
    viewport.compact = true;

    const { rerender } = renderApp(<AppLayout />, { authenticated: true });
    await screen.findByRole('button', { name: /open navigation/i });

    viewport.compact = false;
    rerender(<AppLayout />);
    viewport.compact = true;
    rerender(<AppLayout />);

    await user.click(screen.getByRole('button', { name: /open navigation/i }));

    expect(screen.getByRole('navigation', NAV)).toBeInTheDocument();
  });

  it('offers no collapse control in the drawer', async () => {
    // The drawer is already an overlay: the width a rail would save is width
    // nothing else is using, and the scrim is how it closes.
    const user = userEvent.setup();
    viewport.compact = true;

    renderApp(<AppLayout />, { authenticated: true });
    await user.click(await screen.findByRole('button', { name: /open navigation/i }));

    expect(screen.queryByRole('button', { name: /collapse navigation/i })).toBeNull();
  });
});
