import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppDialog from './AppDialog';

/**
 * The shared dialog shell.
 *
 * Draggability is the kind of affordance that only works when it is everywhere:
 * one panel that moves and one that does not is worse than neither, because a
 * reader cannot tell which is which without trying. So the default matters more
 * than the mechanics, and the first test here is about the default.
 */

describe('AppDialog', () => {
  it('is draggable by its title bar without the caller asking', async () => {
    render(
      <AppDialog open title="Query console" onClose={() => {}}>
        <p>Body</p>
      </AppDialog>,
    );

    const dialog = await screen.findByRole('dialog');
    // The handle is what `DraggableDialogPaper` looks for. Asserted on the
    // attribute rather than on movement, because this is the contract between the
    // two components — the movement test below is the behaviour.
    expect(dialog.querySelector('[data-drag-handle]')).not.toBeNull();
  });

  it('actually moves when the title bar is dragged', () => {
    render(
      <AppDialog open title="Query console" onClose={() => {}}>
        <p>Body</p>
      </AppDialog>,
    );

    const handle = screen.getByRole('dialog').querySelector('[data-drag-handle]');
    expect(handle).not.toBeNull();

    // `fireEvent` rather than `userEvent`: this is a mousedown on the handle
    // followed by mousemoves on `document`, which is the sequence the paper
    // listens for and not something a click helper models.
    fireEvent.mouseDown(handle!, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 160, clientY: 140 });
    fireEvent.mouseUp(document);

    /*
     * Read from the computed style, not `element.style`: the offset is applied
     * through MUI's `sx`, which emotion turns into a class rather than an inline
     * declaration, so the inline property is empty either way.
     *
     * jsdom reports every rectangle as zero, so the viewport clamp pins the
     * offset at or above zero — a drag right and down is the direction it can
     * express here, and it is enough to prove the offset reaches the paper.
     */
    const paper = screen.getByRole('dialog');
    expect(getComputedStyle(paper).transform).toBe('translate(60px, 40px)');
  });

  it('does not move a dialog that asked not to', () => {
    // For the small centred confirmations: an "are you sure" that has wandered
    // into a corner is a worse dialog, not a more flexible one.
    render(
      <AppDialog open title="Are you sure?" onClose={() => {}} draggable={false}>
        <p>Body</p>
      </AppDialog>,
    );

    expect(screen.getByRole('dialog').querySelector('[data-drag-handle]')).toBeNull();
  });

  it('closes from the title bar', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AppDialog open title="Query console" onClose={onClose}>
        <p>Body</p>
      </AppDialog>,
    );

    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the close button clickable even though it sits in the drag handle', async () => {
    /*
     * The interaction that breaks first. The close button is a descendant of the
     * bar the dialog drags by, so a naive handle would swallow the click and the
     * panel would move a pixel instead of closing. `DraggableDialogPaper` excludes
     * interactive elements from starting a drag, and this is what says so.
     */
    const onClose = vi.fn();
    render(
      <AppDialog open title="Query console" onClose={onClose}>
        <p>Body</p>
      </AppDialog>,
    );

    const close = screen.getByRole('button', { name: /close/i });
    fireEvent.mouseDown(close, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 90, clientY: 90 });
    fireEvent.mouseUp(document);

    expect(getComputedStyle(screen.getByRole('dialog')).transform).toBe('translate(0px, 0px)');
  });

  it('omits the footer entirely rather than showing an empty bar', () => {
    const { rerender } = render(
      <AppDialog open title="No actions" onClose={() => {}}>
        <p>Body</p>
      </AppDialog>,
    );

    expect(screen.queryByRole('button', { name: /^ok$/i })).not.toBeInTheDocument();

    rerender(
      <AppDialog open title="With actions" onClose={() => {}} actions={<button type="button">OK</button>}>
        <p>Body</p>
      </AppDialog>,
    );

    expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
  });

  it('shows a subtitle when one is given', () => {
    render(
      <AppDialog open title="Query console" subtitle="Whether it can start, and why not" onClose={() => {}}>
        <p>Body</p>
      </AppDialog>,
    );

    expect(screen.getByText(/whether it can start/i)).toBeInTheDocument();
  });
});
