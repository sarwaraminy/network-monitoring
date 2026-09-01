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
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // Only the primary button drags, and only from within the marked handle — a
    // mousedown on a title-bar button (e.g. Close) must reach that button, not
    // start a drag underneath it.
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!target.closest('[data-drag-handle]')) return;

    drag.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!drag.current) return;
      setOffset({
        x: drag.current.originX + (moveEvent.clientX - drag.current.startX),
        y: drag.current.originY + (moveEvent.clientY - drag.current.startY),
      });
    };
    const handleMouseUp = () => {
      drag.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <Paper
      {...props}
      onMouseDown={handleMouseDown}
      sx={[
        { transform: `translate(${offset.x}px, ${offset.y}px)` },
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    />
  );
}
