import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
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
            <ShieldMoonOutlinedIcon />
            <Typography
              variant="subtitle1"
              noWrap
              sx={{
                fontWeight: 700,
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
                  sx={{
                    px: 1.5,
                    opacity: 0.78,
                    borderBottom: '2px solid transparent',
                    borderRadius: 0,
                    '&.active': { opacity: 1, borderBottomColor: 'primary.light' },
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Stack>
          )}

          <Box sx={{ flexGrow: isCompact ? 1 : 0 }} />

          <ColorSchemeToggle />

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
            <ListItemButton key={item.to} component={NavLink} to={item.to}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </Box>
      </Drawer>
      <Container maxWidth={false} sx={{ py: 3, flexGrow: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
