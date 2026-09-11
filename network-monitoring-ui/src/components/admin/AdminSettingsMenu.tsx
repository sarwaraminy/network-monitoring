import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
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
import { type UiMessageKey, useT } from '../../i18n/ui';
import AppDialog from '../AppDialog';
import DeliverySettingsForm from '../DeliverySettingsForm';
import QueryConsoleSettings from './QueryConsoleSettings';
import QueryConsoleStatus from './QueryConsoleStatus';
import SensorDecommission from './SensorDecommission';
import UserRoles from './UserRoles';

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
  /**
   * Catalogue keys, not sentences. `ADMIN_GROUPS` is module-level and exported,
   * so it is built once at import, before a locale exists — the same reason the
   * field tables in QueryConsoleSettings and DeliverySettingsForm hold keys.
   *
   * This list is the dialog itself, so leaving it in English left the menu that
   * opens four translated panels reading entirely in English.
   */
  labelKey: UiMessageKey;
  descriptionKey: UiMessageKey;
  /** Dialog heading when it opens. */
  titleKey: UiMessageKey;
  /**
   * The screen this row opens, carried on the entry itself so adding a tool is
   * genuinely one array edit rather than an entry here and an `if` somewhere else.
   */
  Component: ComponentType;
}

interface AdminGroup {
  headingKey: UiMessageKey;
  items: AdminTool[];
}

/**
 * `DeliverySettingsForm` in its embedded form.
 *
 * Unembedded it wraps itself in a titled card, which inside a dialog that
 * already has a title is a card in a card. A named wrapper rather than widening
 * `AdminTool` to carry props: one tool needing one flag is not a reason to give
 * every future entry a props bag to get wrong.
 */
function EmbeddedDeliverySettings() {
  return <DeliverySettingsForm embedded />;
}

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    headingKey: 'admin.group.database',
    items: [
      {
        id: 'query-console',
        icon: <StorageOutlinedIcon fontSize="small" />,
        labelKey: 'admin.tool.console',
        descriptionKey: 'admin.tool.console_desc',
        titleKey: 'admin.tool.console',
        Component: QueryConsoleStatus,
      },
      {
        id: 'query-console-settings',
        icon: <TuneOutlinedIcon fontSize="small" />,
        labelKey: 'admin.tool.console_settings',
        descriptionKey: 'admin.tool.console_settings_desc',
        titleKey: 'admin.tool.console_settings',
        Component: QueryConsoleSettings,
      },
    ],
  },
  {
    headingKey: 'admin.group.notifications',
    items: [
      {
        id: 'delivery-settings',
        icon: <SendOutlinedIcon fontSize="small" />,
        labelKey: 'admin.tool.delivery',
        descriptionKey: 'admin.tool.delivery_desc',
        titleKey: 'admin.tool.delivery',
        /*
         * The same component the Delivery page embeds, not a copy. Two forms
         * over one three-layer resolution would eventually disagree about which
         * fields are pinned, and the one nobody was looking at would be the
         * wrong one.
         */
        Component: EmbeddedDeliverySettings,
      },
    ],
  },
  {
    headingKey: 'admin.group.sensors',
    items: [
      {
        id: 'sensor-decommission',
        icon: <DeleteSweepOutlinedIcon fontSize="small" />,
        labelKey: 'admin.tool.decommission',
        descriptionKey: 'admin.tool.decommission_desc',
        titleKey: 'admin.tool.decommission',
        Component: SensorDecommission,
      },
    ],
  },
  {
    headingKey: 'admin.group.accounts',
    items: [
      {
        id: 'user-roles',
        icon: <GroupOutlinedIcon fontSize="small" />,
        labelKey: 'admin.tool.users',
        descriptionKey: 'admin.tool.users_desc',
        titleKey: 'admin.tool.users',
        Component: UserRoles,
      },
    ],
  },
];

export default function AdminSettingsMenu() {
  const t = useT();
  const { user } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<AdminTool | null>(null);

  // See the docblock: the gate hides the gear, the server refuses the requests.
  if (user?.role !== 'ADMIN') return null;

  return (
    <>
      <Tooltip title={t('admin.settings')}>
        <IconButton
          color="inherit"
          aria-label={t('admin.settings')}
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
            key={group.headingKey}
            dense
            subheader={
              <Typography
                variant="overline"
                sx={{ px: 2, pt: 1.5, display: 'block', color: 'text.secondary' }}
              >
                {t(group.headingKey)}
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
                <ListItemText primary={t(item.labelKey)} secondary={t(item.descriptionKey)} />
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
        <AppDialog
          open
          onClose={() => setOpen(null)}
          title={t(open.titleKey)}
          subtitle={t(open.descriptionKey)}
          /*
           * `md` (900px) rather than the shell's `sm` default. These tools are
           * forms and tables, not confirmations: the delivery settings run to
           * dozens of fields with helper text under each, and the accounts table
           * has three columns plus a select — at 600px the helper text wrapped to
           * three lines and the role column had no room left. Below `sm` the
           * shell takes over and goes full screen, so this is the desktop figure
           * only.
           */
          maxWidth="md"
        >
          <open.Component />
        </AppDialog>
      )}
    </>
  );
}
