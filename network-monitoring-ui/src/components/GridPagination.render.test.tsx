import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';
import DataGrid from './DataGrid';

/**
 * The footer reaches a real grid, and its controls drive it.
 *
 * `describePageRange` is pinned next door as a pure function; a correct sentence
 * nobody renders is the failure this covers — `renderBottomToolbar` is one
 * option key away from being replaced by a caller's `tableOptions` spread.
 *
 * Two tests, not five, and the grouping is deliberate rather than lazy.
 * Mounting Material React Table is by far the most expensive thing this suite
 * does: five mounts of this grid cost about nine seconds, and adding them took
 * the whole run close enough to the 15s per-test timeout that unrelated files
 * started failing under parallel load. Each mount here therefore earns its place
 * — one for what the footer says at rest, one for what it says after the page
 * moves, with everything assertable from a single render asserted there.
 */

const rows = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `row ${index + 1}` }));
const columns = [
  { accessorKey: 'id', header: 'Id' },
  { accessorKey: 'name', header: 'Name' },
];

describe('the grid footer', () => {
  it('shows the range, the size control, and announces itself', async () => {
    renderApp(<DataGrid columns={columns} data={rows} />);

    // The range, in the source system's wording.
    expect(await screen.findByText('1–25 of 30')).toBeInTheDocument();
    // Rows per page, on the left.
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument();
    /*
     * And a live region, because this app sets `positionToolbarAlertBanner:
     * 'none'` — MRT's banner is what would otherwise tell a screen reader that
     * what the grid shows has changed.
     */
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('moves the range when the page changes', async () => {
    const user = userEvent.setup();
    renderApp(<DataGrid columns={columns} data={rows} />);
    await screen.findByText('1–25 of 30');

    await user.click(screen.getByRole('button', { name: /go to page 2/i }));

    // The last page holds 5 of the 25 it could — the range must not overrun.
    expect(await screen.findByText('26–30 of 30')).toBeInTheDocument();
  });
});
