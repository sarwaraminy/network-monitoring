import CloseIcon from '@mui/icons-material/Close';
import Dialog, { type DialogProps } from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import DraggableDialogPaper from './DraggableDialogPaper';

/**
 * The application's one dialog shell: a draggable panel with a title bar.
 *
 * Every dialog here used to wire its own chrome, which meant they disagreed. The
 * delivery editor was draggable and nothing else was; the IP lookup and the
 * administration tools were fixed to the middle of the screen, so a reader could
 * not move a panel aside to see the row it was about. Draggability is the kind of
 * affordance that is only useful when it is everywhere — one that moves and one
 * that does not is worse than neither, because the reader cannot tell which is
 * which without trying.
 *
 * So this owns it. `DraggableDialogPaper` does the dragging, this supplies the
 * title bar it drags by, and callers supply content. The bar carries
 * `data-drag-handle`; the close button inside it stays clickable because the
 * paper excludes interactive elements from starting a drag.
 *
 * `draggable={false}` is for the small centred confirmations that should not
 * move — a two-line "are you sure" that has wandered into a corner is a worse
 * dialog, not a more flexible one.
 */

export interface AppDialogProps extends Omit<DialogProps, 'title' | 'onClose' | 'PaperComponent'> {
  open: boolean;
  title: ReactNode;
  /** A second line under the title — the record this is about, usually. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Footer content. Omitted entirely when absent, rather than an empty bar. */
  actions?: ReactNode;
  /** Default true. See the docblock for when to turn it off. */
  draggable?: boolean;
  /** Hides the title bar's close button, for a dialog dismissed only by its actions. */
  hideClose?: boolean;
}

export default function AppDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  actions,
  draggable = true,
  hideClose = false,
  fullWidth = true,
  maxWidth = 'sm',
  ...rest
}: Readonly<AppDialogProps>) {
  return (
    <Dialog
      {...rest}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      maxWidth={maxWidth}
      {...(draggable ? { PaperComponent: DraggableDialogPaper } : {})}
    >
      <DialogTitle
        component="div"
        // The handle is the whole bar rather than the text, so there is somewhere
        // to grab on a dialog whose title is two words.
        {...(draggable ? { 'data-drag-handle': true } : {})}
        sx={{ pb: subtitle ? 1 : 2, cursor: draggable ? 'move' : 'default' }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h2">
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {subtitle}
              </Typography>
            )}
          </Stack>

          {!hideClose && (
            <IconButton size="small" onClick={onClose} aria-label="Close" edge="end">
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </DialogTitle>

      <Divider />

      <DialogContent>{children}</DialogContent>

      {actions && (
        <>
          <Divider />
          <DialogActions>{actions}</DialogActions>
        </>
      )}
    </Dialog>
  );
}
