import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import AppDialog from './AppDialog';

/**
 * What the dialog does when the viewport gets small.
 *
 * A separate file for the same reason as `AppLayout.responsive.test.tsx`:
 * `jsdom`'s `matchMedia` always answers false and never fires a change, so the
 * breakpoint cannot move under the component the way it does when somebody
 * rotates a phone. Mocking `useMediaQuery` makes the crossing performable;
 * keeping it here stops the mock reaching the seven tests next door that want the
 * real thing.
 *
 * The behaviour under test is one decision with two halves. Below `sm` the panel
 * goes full screen — a 600px dialog in a 380px viewport is a dialog with no
 * margins, and the administration tools were losing their right-hand column —
 * and dragging goes away with it, because there is nowhere to drag a panel that
 * already fills the screen and every gesture would just be a chance to shove it
 * off the edge.
 */
const viewport = vi.hoisted(() => ({ compact: false }));

vi.mock('@mui/material/useMediaQuery', () => ({
  __esModule: true,
  default: () => viewport.compact,
}));

beforeEach(() => {
  viewport.compact = false;
});

const open = (extra: Partial<React.ComponentProps<typeof AppDialog>> = {}) =>
  renderApp(
    <AppDialog open onClose={() => undefined} title="Query console settings" {...extra}>
      <p>Body</p>
    </AppDialog>,
  );

describe('AppDialog on a small viewport', () => {
  it('fills the screen instead of floating in a margin it does not have', async () => {
    viewport.compact = true;
    open();

    /*
     * MUI's own class, which is the only externally visible statement that
     * `fullScreen` took effect — the geometry is a stylesheet jsdom does not
     * apply. Read off the dialog element itself, because in MUI the paper IS the
     * element carrying `role="dialog"`; querying inside it finds nothing.
     */
    const paper = await screen.findByRole('dialog');
    expect(paper.className).toContain('MuiDialog-paperFullScreen');
  });

  it('stops offering a drag it cannot honour', async () => {
    /*
     * The handle has to go with the full-screen layout, not just the dragging.
     * A title bar showing a `move` cursor over a panel that cannot move is a
     * worse lie than no affordance at all — and MUI drops the paper's transform
     * when `fullScreen`, so the two features actively fight.
     */
    viewport.compact = true;
    open();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-drag-handle]')).toBeNull();
  });

  it('is draggable again at desktop width', async () => {
    // The other half, so the test above cannot pass because the handle was
    // dropped for everybody.
    open();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-drag-handle]')).not.toBeNull();
    expect(dialog.className).not.toContain('MuiDialog-paperFullScreen');
  });

  it('keeps its close button when full screen, which is the only way out', async () => {
    // Full screen hides the backdrop, so a click outside is not available and the
    // button is the whole exit. Losing it here would trap the reader.
    viewport.compact = true;
    open();

    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
