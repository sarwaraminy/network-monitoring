import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import ShieldMoonOutlinedIcon from '@mui/icons-material/ShieldMoonOutlined';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { type ReactElement, useState } from 'react';
import { NavLink, Outlet, Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CARD_METRICS, HEADER, NAV } from '../theme';
import ColorSchemeToggle from './ColorSchemeToggle';

interface NavItem {
  label: string;
  to: string;
  icon: ReactElement;
}

/** Replaces the Bootstrap navbar in dashboard/NavigationBar.js. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: <SpaceDashboardOutlinedIcon /> },
  { label: 'Security Alerts', to: '/alerts', icon: <WarningAmberOutlinedIcon /> },
  { label: 'Threat Intel', to: '/threat-intel', icon: <GppMaybeOutlinedIcon /> },
  { label: 'Delivery', to: '/delivery', icon: <SendOutlinedIcon /> },
  { label: 'Capture by Interface', to: '/capture-packets', icon: <SettingsEthernetIcon /> },
  { label: 'Capture by IP', to: '/capture-packets-ip', icon: <FilterAltOutlinedIcon /> },
];

export default function AppLayout() {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    setMenuAnchor(null);
    logout();
    navigate('/login', { replace: true });
  };

  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .map((part) => part![0]!.toUpperCase())
    .join('')
    .slice(0, 2);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky">
        <Toolbar
          // Stretched, not centred. A centred row gives its children content
          // height and leaves the slack above and below, so the nav Stack could
          // never bottom-align its tabs to the bar's edge — which is what left
          // the active tab floating as a pill in the middle of the sweep.
          // Everything that should stay centred says so for itself below.
          sx={{ gap: 1, alignItems: 'stretch' }}
        >
          {isCompact && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              sx={{ alignSelf: 'center' }}
            >
              <MenuIcon />
            </IconButton>
          )}

          <Stack
            component={RouterLink}
            to="/"
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              alignSelf: 'center',
              color: 'inherit',
              textDecoration: 'none',
              mr: 2,
            }}
          >
            {/* The one piece of colour in the bar, now that it is neutral. */}
            <ShieldMoonOutlinedIcon sx={{ color: 'inherit' }} />
            <Typography
              variant="subtitle1"
              noWrap
              sx={{
                fontWeight: 700,
                letterSpacing: '-0.01em',
              }}
            >
              Network Monitoring
            </Typography>
          </Stack>

          {!isCompact && (
            <Stack
              direction="row"
              spacing={0.5}
              /*
               * `stretch`, and the inset lives HERE rather than on the tabs.
               *
               * `flex-end` only moves a content-height box to the bottom of
               * whatever the Stack happens to be, so the tab stayed a pill
               * floating in the sweep. `stretch` makes the tabs fill the strip
               * outright, so their bottom edge is the bar's bottom edge.
               *
               * The top inset is then this margin on the strip, not a margin on
               * each Button — a margin there had no visible effect, and the strip
               * is the right place for it anyway: one value insets all the tabs
               * together, so they cannot drift off a shared baseline. Raise it
               * for a shallower tab; the bottom stays pinned and the bar's height
               * never changes, because nothing is being padded down to the edge.
               */
              sx={{ flexGrow: 1, alignItems: 'stretch', marginTop: '6px' }}
            >
              {NAV_ITEMS.map((item) => (
                <Button
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  startIcon={item.icon}
                  color="inherit"
                  sx={(theme) => ({
                    // The source spec's own values: a compact tab with a small
                    // top margin, sitting on the bottom edge of the strip. The
                    // inset is at the top only, which is what makes the active
                    // one read as rising out of the bar rather than floating in
                    // the middle of it.
                    paddingInline: '14px',
                    paddingBlock: 0,
                    // No margin here — the strip above carries the inset.
                    minHeight: 'unset',
                    minWidth: 'unset',
                    // White on the sweep in both schemes, until it is the current
                    // page. Inactive tabs are not dimmed — on a saturated bar a
                    // dimmed label reads as disabled rather than as unselected.
                    color: HEADER.light.tabInk,
                    borderRadius: 0,
                    borderTopLeftRadius: 6,
                    borderTopRightRadius: 6,
                    // An inactive tab lightens the sweep under it; the active
                    // one is already on its own surface and keeps it.
                    '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.1)' },

                    // The active tab rises out of the sweep onto its own surface,
                    // and that is the whole signal in both schemes. No underline:
                    // the tab runs to the bar's bottom edge, so a rule there is a
                    // second marker drawn under a surface that already reads as
                    // the current page.
                    //
                    // The ink is a darkened azure rather than the brand azure —
                    // base azure on this pale tab measures 3.28:1, under the
                    // 4.5:1 floor for 14px text.
                    '&.active': {
                      bgcolor: HEADER.light.activeTabBg,
                      color: HEADER.light.activeTabInk,
                      '&:hover': { bgcolor: HEADER.light.activeTabBg },
                    },

                    // Dark lifts too, onto the page canvas. Both schemes now
                    // carry the state as a surface and neither underlines, so the
                    // reserved bottom border is gone with them — nothing paints
                    // it, and an always-transparent 3px rule was only costing the
                    // tab height.
                    ...theme.applyStyles('dark', {
                      color: HEADER.dark.tabInk,
                      '&.active': {
                        bgcolor: HEADER.dark.activeTabBg,
                        color: HEADER.dark.activeTabInk,
                        '&:hover': { bgcolor: HEADER.dark.activeTabBg },
                      },
                    }),
                  })}
                >
                  {item.label}
                </Button>
              ))}
            </Stack>
          )}

          <Box sx={{ flexGrow: isCompact ? 1 : 0 }} />

          <Tooltip title={user?.email ?? 'Account'}>
            <IconButton
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              sx={{ p: 0.5, alignSelf: 'center' }}
            >
              <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: '0.85rem' }}>
                {initials || '?'}
              </Avatar>
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={menuAnchor}
            open={menuAnchor !== null}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2" noWrap>
                {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Signed in'}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{
                  color: 'text.secondary',
                }}
              >
                {user?.email} · {user?.role}
              </Typography>
            </Box>
            {/*
              Creating an account is an administrator's action, so it belongs here
              rather than as a "register here" link on the login page. The server
              enforces this independently — the menu item only stops showing a
              control to someone it would refuse.
            */}
            {user?.role === 'ADMIN' && (
              <>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    navigate('/sign-up');
                  }}
                >
                  <ListItemIcon>
                    <PersonAddAlt1Icon fontSize="small" />
                  </ListItemIcon>
                  Add user
                </MenuItem>
              </>
            )}
            <Divider />
            <ColorSchemeToggle />
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 268, pt: 1 }} onClick={() => setDrawerOpen(false)}>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              sx={(theme) => ({
                // The drawer's equivalent of the bar's underline: a rule on the
                // panel edge. Present and transparent on every row, for the same
                // reason — otherwise every label shifts 2px as the selection
                // moves down the list.
                borderLeft: '2px solid transparent',
                borderRadius: 0,
                color: NAV.light.itemInk,
                '& .MuiListItemText-primary': { fontSize: 13 },
                // Only the active row is tinted. Colouring every row removes the
                // contrast that makes "you are here" readable at a glance.
                '&.active': {
                  borderLeftColor: NAV.light.activeRule,
                  bgcolor: NAV.light.activeBg,
                  color: NAV.light.activeInk,
                  '& .MuiListItemIcon-root': { color: NAV.light.activeInk },
                  '& .MuiListItemText-primary': { fontSize: 13, fontWeight: 600 },
                },
                ...theme.applyStyles('dark', {
                  color: NAV.dark.itemInk,
                  '&.active': {
                    borderLeftColor: NAV.dark.activeRule,
                    bgcolor: NAV.dark.activeBg,
                    color: NAV.dark.activeInk,
                    '& .MuiListItemIcon-root': { color: NAV.dark.activeInk },
                  },
                }),
              })}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </Box>
      </Drawer>
      {/*
        The page canvas. A flex column with one gap between its children, rather
        than every page spacing itself with `mb` — which is how the pages ended
        up with a title band 16px above its content on one page and 12px on
        another, and how a page's last card gained a trailing margin the page
        below it did not.

        `minHeight: 0` and a stretched column are what let a SurfaceCard marked
        `fill` consume the leftover height, so a short page's last card reaches
        the bottom instead of leaving the page background showing beneath it.
      */}
      <Container
        maxWidth={false}
        sx={{
          paddingBlock: `${CARD_METRICS.pagePaddingBlock}px`,
          paddingInline: `${CARD_METRICS.pagePaddingInline}px`,
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: `${CARD_METRICS.gap}px`,
          minHeight: 0,
        }}
      >
        <Outlet />
      </Container>
    </Box>
  );
}
