import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { type ComponentType, type ReactElement, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import AppDialog from '../AppDialog';
import QueryConsoleSettings from './QueryConsoleSettings';
import QueryConsoleStatus from './QueryConsoleStatus';

/**
 * Administration settings: a gear in the header opening a panel of admin tools.
 *
 * The shape follows the sibling `professional` project's `AdminSettingsMenu` — a
 * list of groups, each a list of items, each opening in a modal over whatever
 * page the reader is on. Deliberately that shape rather than a page: these are
 * occasional server-operator tasks, and giving each one a route and a navigation
 * entry would put administration in the same list as the things people use all
 * day. Adding the next tool is an entry in `ADMIN_GROUPS` and nothing else.
 *
 * **It hides a control; it is not a security boundary.** Every endpoint behind
 * these tools is ADMIN-gated on the server, which is what makes failing closed
 * here free: the worst case is an administrator who has to reload, not an
 * unauthorised reader who gets in.
 */

interface AdminTool {
  id: string;
  icon: ReactElement;
  label: string;
  description: string;
  /** Dialog heading when it opens. */
  title: string;
  /**
   * The screen this row opens, carried on the entry itself so adding a tool is
   * genuinely one array edit rather than an entry here and an `if` somewhere else.
   */
  Component: ComponentType;
}

interface AdminGroup {
  heading: string;
  items: AdminTool[];
}

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    heading: 'Database',
    items: [
      {
        id: 'query-console',
        icon: <StorageOutlinedIcon fontSize="small" />,
        label: 'Query console',
        description: 'Whether the ad hoc SQL console can start, and why not.',
        title: 'Query console',
        Component: QueryConsoleStatus,
      },
      {
        id: 'query-console-settings',
        icon: <TuneOutlinedIcon fontSize="small" />,
        label: 'Query console settings',
        description: 'Switch it on or off, and set its limits, without a restart.',
        title: 'Query console settings',
        Component: QueryConsoleSettings,
      },
    ],
  },
];

export default function AdminSettingsMenu() {
  const { user } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<AdminTool | null>(null);

  // See the docblock: the gate hides the gear, the server refuses the requests.
  if (user?.role !== 'ADMIN') return null;

  return (
    <>
      <Tooltip title="Administration settings">
        <IconButton
          color="inherit"
          aria-label="Administration settings"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <SettingsOutlinedIcon />
        </IconButton>
      </Tooltip>

      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360 } } }}
      >
        {ADMIN_GROUPS.map((group) => (
          <List
            key={group.heading}
            dense
            subheader={
              <Typography
                variant="overline"
                sx={{ px: 2, pt: 1.5, display: 'block', color: 'text.secondary' }}
              >
                {group.heading}
              </Typography>
            }
          >
            {group.items.map((item) => (
              <ListItemButton
                key={item.id}
                onClick={() => {
                  setOpen(item);
                  setAnchor(null);
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} secondary={item.description} />
              </ListItemButton>
            ))}
          </List>
        ))}
      </Popover>

      {/*
        Mounted only while open, and unmounted on close, so a tool's own query
        runs when somebody asks for it rather than on every page load — and a
        second visit re-reads rather than showing what was true last time.

        `AppDialog` rather than a bare one so this panel drags like every other:
        an administrator reading why the console will not start usually wants to
        see the page underneath while they do it.
      */}
      {open && (
        <AppDialog open onClose={() => setOpen(null)} title={open.title} subtitle={open.description}>
          <open.Component />
        </AppDialog>
      )}
    </>
  );
}
