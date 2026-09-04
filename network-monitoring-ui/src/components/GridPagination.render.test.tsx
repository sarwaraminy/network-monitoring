import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';
import DataGrid from './DataGrid';

/**
 * The footer reaches a real grid, and its controls drive it.
 *
 * `describePageRange` is pinned next door; a correct sentence nobody renders is
 * the failure this covers. `renderBottomToolbar` is one option key away from
 * being replaced by a caller's `tableOptions` spread.
 */

const rows = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `row ${index + 1}` }));
const columns = [
  { accessorKey: 'id', header: 'Id' },
  { accessorKey: 'name', header: 'Name' },
];

describe('the grid footer', () => {
  it('shows the range beside the page controls', async () => {
    renderApp(<DataGrid columns={columns} data={rows} />);

    expect(await screen.findByText('1–25 of 40')).toBeInTheDocument();
  });

  it('offers rows per page on the left', async () => {
    renderApp(<DataGrid columns={columns} data={rows} />);

    expect(await screen.findByLabelText('Rows per page')).toBeInTheDocument();
  });

  it('moves the range when the page changes', async () => {
    const user = userEvent.setup();
    renderApp(<DataGrid columns={columns} data={rows} />);
    await screen.findByText('1–25 of 40');

    await user.click(screen.getByRole('button', { name: /go to page 2/i }));

    // The last page holds 15 of the 25 it could — the range must not overrun.
    expect(await screen.findByText('26–40 of 40')).toBeInTheDocument();
  });

  it('announces the range politely, since the alert banner is switched off', async () => {
    renderApp(<DataGrid columns={columns} data={rows} />);

    expect(await screen.findByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
