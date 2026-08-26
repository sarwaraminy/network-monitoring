import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
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
        <Toolbar sx={{ gap: 1 }}>
          {isCompact && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
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
              color: 'inherit',
              textDecoration: 'none',
              mr: 2,
            }}
          >
            {/* The one piece of colour in the bar, now that it is neutral. */}
            <ShieldMoonOutlinedIcon sx={{ color: 'primary.main' }} />
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
            <Stack direction="row" spacing={0.5} sx={{ flexGrow: 1 }}>
              {NAV_ITEMS.map((item) => (
                <Button
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  startIcon={item.icon}
                  color="inherit"
                  sx={(theme) => ({
                    px: 1.5,
                    color: 'text.secondary',
                    // Square-bottomed, because the active state in one scheme is
                    // a rule sitting on that edge.
                    borderTopLeftRadius: theme.shape.borderRadius,
                    borderTopRightRadius: theme.shape.borderRadius,
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    // Drawn on every item, transparent unless active, so the
                    // labels stay on one baseline rather than the active one
                    // being nudged up 2px as the selection moves.
                    borderBottom: '2px solid transparent',
                    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },

                    // `lifted` — see navTreatment. The current page rises out of
                    // the bar on a tinted surface.
                    '&.active': { color: 'primary.main', bgcolor: 'action.selected' },

                    // `underlined`. Against the near-black dark bar a tinted slab
                    // is the brightest thing on screen, which is the wrong place
                    // for the eye on a page about alerts — so the state moves to
                    // a rule and the surface goes away.
                    ...theme.applyStyles('dark', {
                      '&.active': {
                        color: 'primary.main',
                        bgcolor: 'transparent',
                        borderBottomColor: theme.vars?.palette.primary.main,
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
            <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ p: 0.5 }}>
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
              sx={{
                // The drawer's equivalent of the bar's underline: a rule on the
                // panel edge. Present and transparent on every row, for the same
                // reason — otherwise every label shifts 2px as the selection
                // moves down the list.
                borderLeft: '2px solid transparent',
                color: 'text.secondary',
                '&.active': {
                  borderLeftColor: 'primary.main',
                  bgcolor: 'action.selected',
                  color: 'primary.main',
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                  '& .MuiListItemText-primary': { fontWeight: 600 },
                },
              }}
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
          py: 3,
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minHeight: 0,
        }}
      >
        <Outlet />
      </Container>
    </Box>
  );
}
