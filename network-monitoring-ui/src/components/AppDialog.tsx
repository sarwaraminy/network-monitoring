import CloseIcon from '@mui/icons-material/Close';
import Dialog, { type DialogProps } from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { ReactNode } from 'react';
import { useT } from '../i18n/ui';
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
 *
 * **Below `sm` it goes full screen and stops being draggable.** A 600px panel
 * inside a 380px viewport is a panel with no margins, and the administration
 * tools are the worst case: a settings form and an account table, both of which
 * were losing their right-hand column on a phone. Dragging goes with it, because
 * there is nowhere to drag a panel that already fills the screen, and every
 * gesture would just be a chance to shove it off the edge — MUI also drops the
 * paper's own transform when `fullScreen`, so the two features actively fight.
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
  const t = useT();
  const theme = useTheme();
  /*
   * `noSsr` because this decides which of two layouts renders rather than a
   * detail within one. Without it the first paint is the default answer and the
   * second is the real one, so a dialog opened on a phone appears as a centred
   * panel and then jumps to full screen.
   */
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const movable = draggable && !compact;

  return (
    <Dialog
      {...rest}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      maxWidth={maxWidth}
      fullScreen={compact}
      {...(movable ? { PaperComponent: DraggableDialogPaper } : {})}
      sx={{
        // Taller than MUI's default `calc(100% - 64px)`, since these panels are
        // forms and tables rather than confirmations: the height was the binding
        // constraint long before the width was. Left alone when full screen,
        // where the paper is already the viewport.
        ...(compact ? {} : { '& .MuiDialog-paper': { maxHeight: 'calc(100% - 32px)' } }),
        ...rest.sx,
      }}
    >
      <DialogTitle
        component="div"
        // The handle is the whole bar rather than the text, so there is somewhere
        // to grab on a dialog whose title is two words. Absent when full screen:
        // a `move` cursor over a bar that does not move is a worse lie than no
        // affordance at all.
        {...(movable ? { 'data-drag-handle': true } : {})}
        sx={{ pb: subtitle ? 1 : 2, cursor: movable ? 'move' : 'default' }}
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
            <IconButton size="small" onClick={onClose} aria-label={t('common.close')} edge="end">
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
