import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import ShieldMoonOutlinedIcon from '@mui/icons-material/ShieldMoonOutlined';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useStoredBoolean } from '../hooks/useStoredBoolean';
import { CARD_METRICS, HEADER, SIDEBAR_METRICS } from '../theme';
import ColorSchemeToggle from './ColorSchemeToggle';
import { visibleNavGroups } from './navItems';
import SideNav from './SideNav';

/** Where the sidebar's collapsed state is remembered. Namespaced, not bare. */
const COLLAPSED_KEY = 'nm.sidebar.collapsed';

/**
 * The application shell: brand bar across the top, grouped navigation down the
 * left, page canvas filling the rest.
 *
 * The navigation used to be a row of tabs in the bar, and it moved because it
 * outgrew that row — eight destinations with no way to say which belonged
 * together, and the next one would have had to wrap or shrink. A sidebar spends
 * horizontal room to buy two things the strip could not offer at any width:
 * named groups, and headroom. It spends no VERTICAL room, which is the axis that
 * actually matters here — every page in this app is a tall table sized by
 * `useViewportFitHeight`, and a second row of chrome would have come straight
 * out of the rows on screen.
 *
 * Three widths, one navigation:
 *
 *  - from `md`: the sidebar, expanded or collapsed to an icon rail. The choice
 *    is the user's and is remembered, because it depends on their screen rather
 *    than on ours.
 *  - below `md`: a temporary drawer over the page, opened by the same button.
 *
 * The two mountings are mutually exclusive, not both-rendered-and-one-hidden.
 * Rendering both puts every link in the document twice, which duplicates them
 * for a screen reader and lets a keyboard tab through a panel nobody can see.
 */
export default function AppLayout() {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useStoredBoolean(COLLAPSED_KEY, false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const { user, logout } = useAuth();
  /*
   * Admin-only entries are not rendered for anyone else, and a group left empty
   * by that filtering is dropped with them.
   *
   * The server refuses the route regardless — this only stops offering a link
   * that would answer 403, which is the convention the account menu below and
   * the alerts table's delete button already follow. Filtered once and handed to
   * whichever mounting is on screen, so the two cannot disagree about what is on
   * offer.
   */
  const navGroups = useMemo(() => visibleNavGroups(user?.role), [user?.role]);
  const navigate = useNavigate();

  /*
   * Leaving compact width closes the drawer.
   *
   * `drawerOpen` outlives the breakpoint that made it meaningful. While the
   * drawer was mounted at every width it merely sat behind the desktop layout;
   * now that the two mountings are exclusive, a stale `true` is applied fresh on
   * the way back — so opening the drawer, widening past `md`, and narrowing
   * again put the sheet over the page with nobody having touched the button.
   * Rotating a tablet is enough to do it.
   */
  useEffect(() => {
    if (!isCompact) setDrawerOpen(false);
  }, [isCompact]);

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
        {/*
          A fixed height, matching `HEADER.height`. The sidebar sticks to the
          underside of this bar and needs the offset as a number; leaving the
          height to `Toolbar`'s responsive default would make that offset a guess
          that is wrong at exactly one breakpoint.
        */}
        <Toolbar sx={{ gap: 1, minHeight: `${HEADER.height}px !important` }}>
          {/*
            Compact only. From `md` up the collapse control lives in the panel's
            own 48px header row, which is where the design puts it — a caret on
            the thing it collapses, rather than a hamburger in the bar aimed at
            something else on screen.
          */}
          {isCompact && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
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
              minWidth: 0,
            }}
          >
            {/* The one piece of iconography in the bar, now that the tabs are
                out of it. */}
            <ShieldMoonOutlinedIcon sx={{ color: 'inherit' }} />
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
              Network Monitoring
            </Typography>
          </Stack>

          <Box sx={{ flexGrow: 1 }} />

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
              <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
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

      {/*
        Sidebar and canvas side by side. `minHeight: 0` on the row and on the
        canvas column is what lets a SurfaceCard marked `fill` consume the
        leftover height — without it a flex child refuses to shrink below its
        content and the card's bottom edge slides under the fold.
      */}
      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        {isCompact ? (
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            // The panel keeps its own margin inside the sheet, so the sheet is
            // the panel plus both margins — the same object as on the desktop,
            // not a second, flatter version of it.
            slotProps={{
              paper: {
                sx: { width: SIDEBAR_METRICS.panelWidth + SIDEBAR_METRICS.panelMargin * 2 },
              },
            }}
          >
            {/*
              Never collapsed, and no collapse control: the drawer is already an
              overlay, so the width the rail would save is width nothing else is
              using, and the sheet's own scrim is how it closes.
            */}
            <SideNav groups={navGroups} onNavigate={() => setDrawerOpen(false)} />
          </Drawer>
        ) : (
          /*
           * The panel is a bordered object floating on the page, not a flush
           * column — that is the design, and it is why this wrapper exists at
           * all: the panel needs a bounded height to scroll inside, and the
           * wrapper is what bounds it.
           *
           * Sticky rather than fixed, so it stays inside the flex row and the
           * canvas beside it needs no matching offset. It parks under the bar
           * and the panel takes its own margin from there.
           */
          <Box
            sx={{
              flexShrink: 0,
              alignSelf: 'flex-start',
              position: 'sticky',
              top: HEADER.height,
              height: `calc(100vh - ${HEADER.height}px)`,
              display: 'flex',
            }}
          >
            <SideNav
              groups={navGroups}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed(!collapsed)}
            />
          </Box>
        )}

        {/*
          The page canvas. A flex column with one gap between its children, rather
          than every page spacing itself with `mb` — which is how the pages ended
          up with a title band 16px above its content on one page and 12px on
          another, and how a page's last card gained a trailing margin the page
          below it did not.
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
            // Both axes. `minWidth` is the one that is easy to miss: a flex item
            // defaults to `min-width: auto`, so a wide table would push the
            // canvas wider than the row instead of scrolling inside it, and take
            // the sidebar off screen with it.
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <Outlet />
        </Container>
      </Box>
    </Box>
  );
}
