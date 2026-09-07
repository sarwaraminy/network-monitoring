import Paper, { type PaperProps } from '@mui/material/Paper';
import { useRef, useState } from 'react';

/**
 * A Dialog's Paper, draggable by any descendant marked `data-drag-handle`.
 *
 * Position is tracked as an offset from the dialog's normal centered position and
 * applied with `transform`, so it never fights the centering MUI already does. The
 * offset lives in this component's own state rather than anywhere higher up: MUI
 * unmounts the Paper when the dialog closes (no `keepMounted`), so it resets to
 * centered on every reopen rather than wandering further off-screen each time.
 */
export default function DraggableDialogPaper(props: Readonly<PaperProps>) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const paperRef = useRef<HTMLDivElement>(null);
  /**
   * The offset currently painted, mirrored out of state.
   *
   * The clamp below reads the paper's rectangle, which already includes whatever
   * offset is on screen — so turning that rectangle back into an offset needs the
   * value that produced it, and `offset` from the closure can be a render behind
   * during a fast drag.
   */
  const applied = useRef({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // Only the primary button drags, and only from within the marked handle — a
    // mousedown on a title-bar button (e.g. Close) must reach that button, not
    // start a drag underneath it. The Close button is a DESCENDANT of the marked
    // handle (the title bar), so `closest('[data-drag-handle]')` alone finds it
    // too, from a mousedown anywhere on the button or its icon — excluding any
    // interactive element explicitly is what actually keeps it clickable.
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select')) return;
    if (!target.closest('[data-drag-handle]')) return;

    drag.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };

    /**
     * Ends the drag and unsubscribes. Declared before both handlers because each
     * needs to call it — a `mouseup` is the normal ending, and a move with no
     * button held is the one that catches the abnormal one.
     */
    const release = () => {
      drag.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', release);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!drag.current) return;

      /*
       * The fallback release, and it is not theoretical.
       *
       * `mouseup` only reaches `document` when the button is released over the
       * viewport. Drag the title bar quickly to the edge of the screen and let go
       * outside the window and no `mouseup` ever arrives — so without this the
       * dialog keeps following the cursor the moment it re-enters, with no button
       * held, until some unrelated click happens to end it. `buttons` is a bitmask
       * of what is currently held, so zero means the gesture is over whatever we
       * missed.
       */
      if (moveEvent.buttons === 0) {
        release();
        return;
      }

      const wanted = {
        x: drag.current.originX + (moveEvent.clientX - drag.current.startX),
        y: drag.current.originY + (moveEvent.clientY - drag.current.startY),
      };

      /*
       * Kept inside the viewport, because the alternative is losing the dialog.
       *
       * Without this a dialog can be dragged until it is entirely off screen, and
       * it takes its own close button with it — the only ways back are Escape, a
       * click on the backdrop, or a reload, none of which is obvious to somebody
       * who has just watched a panel disappear. The bounds are computed from the
       * painted rectangle, so they hold whatever the dialog's size is.
       */
      const rect = paperRef.current?.getBoundingClientRect();
      const next = rect
        ? {
            x: Math.min(
              Math.max(wanted.x, applied.current.x - rect.left),
              applied.current.x + (window.innerWidth - rect.right),
            ),
            y: Math.min(
              Math.max(wanted.y, applied.current.y - rect.top),
              applied.current.y + (window.innerHeight - rect.bottom),
            ),
          }
        : wanted;

      applied.current = next;
      setOffset(next);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', release);
  };

  return (
    <Paper
      {...props}
      ref={paperRef}
      onMouseDown={handleMouseDown}
      sx={[
        { transform: `translate(${offset.x}px, ${offset.y}px)` },
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    />
  );
}
