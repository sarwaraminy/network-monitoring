import { createTheme } from '@mui/material/styles';

const MONO_STACK = '"JetBrains Mono", "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace';

/**
 * Table header fill: one step off `background.paper`, not the page colour.
 *
 * Opaque on purpose. Both tables use sticky headers, so a translucent fill would
 * let rows scroll visibly through the header.
 */
export const HEAD_SURFACE = { light: '#f7f9fc', dark: '#16213a' } as const;

/**
 * Shared MUI theme, with light and dark colour schemes.
 *
 * `cssVariables` emits CSS custom properties and a `data-mui-color-scheme`
 * attribute, so switching schemes re-paints without re-rendering the tree and
 * without a flash of the wrong theme on load. Material React Table reads the same
 * theme, so table chrome follows automatically.
 *
 * A dark scheme is close to mandatory for this kind of tool: it is read for long
 * stretches, often in a dim room, and every comparable product defaults to it.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#1d4ed8', dark: '#1a3ba8', light: '#4b74e8' },
        secondary: { main: '#0f766e' },
        error: { main: '#b91c1c' },
        warning: { main: '#b45309' },
        info: { main: '#0369a1' },
        success: { main: '#15803d' },
        // `default` is deeper than it looks it needs to be, on purpose: at
        // #f4f6fb the page and a white card were about 1.07:1 apart, so cards
        // read as part of the page rather than sitting on it. `paper` stays
        // #ffffff because charts/palette.ts is validated against that surface.
        background: { default: '#e8ecf4', paper: '#ffffff' },
        text: { primary: '#111827', secondary: '#4b5563' },
      },
    },
    dark: {
      palette: {
        // Lifted and desaturated relative to the light scheme, so contrast stays
        // comfortable against a dark surface rather than glowing.
        primary: { main: '#7da2ff', dark: '#5b84e8', light: '#a6c1ff' },
        secondary: { main: '#5eead4' },
        error: { main: '#f87171' },
        warning: { main: '#fbbf24' },
        info: { main: '#7dd3fc' },
        success: { main: '#4ade80' },
        // Same reasoning as light. Separation matters more here: shadows are
        // almost invisible on a dark page, so the colour step and the border are
        // the only things distinguishing a card from the background.
        background: { default: '#060a12', paper: '#111a2b' },
        text: { primary: '#e6edf7', secondary: '#9aa8bd' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h5: { fontWeight: 650, letterSpacing: '-0.01em' },
    h6: { fontWeight: 650, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiAppBar: {
      // `transparent` stops MuiAppBar injecting its own background and
      // contrast text, so the rules below are the only thing painting the bar.
      defaultProps: { elevation: 0, color: 'transparent' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: 'none',
          color: theme.vars.palette.text.primary,

          /*
           * Translucent and blurred, following the colour scheme.
           *
           * This replaces a bar pinned to #0f172a in both schemes. A permanently
           * dark slab above a light page is the single most dated thing about the
           * chrome — it is the default Material look from a decade ago, and it
           * fights the light scheme rather than belonging to it.
           *
           * The bar is `position="sticky"`, so content passes underneath it. A
           * blurred translucent surface makes that legible instead of hiding it,
           * and it is what current desktop and web chrome does.
           */
          backgroundColor: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'saturate(180%) blur(12px)',
          WebkitBackdropFilter: 'saturate(180%) blur(12px)',
          borderBottom: `1px solid ${theme.vars.palette.divider}`,

          ...theme.applyStyles('dark', {
            // Tracks background.default, so the bar reads as the same material
            // as the page rather than a separate panel floating over it.
            backgroundColor: 'rgba(11, 18, 32, 0.72)',
          }),

          // Without blur support, 72% opacity over scrolling content is
          // unreadable. Fall back to an opaque surface rather than a smear.
          '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
            backgroundColor: theme.vars.palette.background.paper,
          },
        }),
      },
    },
    /*
     * Every surface in the app is `variant="outlined"` — Card and Paper both —
     * so one rule on the outlined slot covers all of them. Menus and dialogs use
     * `elevation` instead and are untouched.
     *
     * Colour alone is not enough separation at these lightness levels, and
     * pushing the page darker until it were would make the app gloomy. A hairline
     * plus a shallow shadow does the rest.
     */
    MuiPaper: {
      styleOverrides: {
        outlined: ({ theme }) => ({
          boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
          ...theme.applyStyles('dark', {
            // A drop shadow is invisible against a near-black page, so spend the
            // separation on a brighter edge instead.
            boxShadow: 'none',
            borderColor: 'rgba(255, 255, 255, 0.11)',
          }),
        }),
      },
    },
    /*
     * Tables. These target MUI primitives rather than Material React Table, so a
     * plain table and an MRT table are styled once and match — MRT renders real
     * MuiTableCell/MuiTableRow underneath. MRT's own chrome is in tableTheme.ts.
     */
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          // Horizontal rules only. Vertical borders turn a table into a grid and
          // make every row harder to scan across.
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        }),
        head: ({ theme }) => ({
          /*
           * A hair off the paper surface, not the page colour. Using
           * `background.default` here tinted the header with the deepened page
           * blue-grey, which reads as muddy against a white table.
           *
           * It must stay opaque, not a translucent overlay: both tables enable
           * `enableStickyHeader`, and rows scrolling visibly underneath a
           * see-through header is worse than no tint at all.
           */
          backgroundColor: HEAD_SURFACE.light,
          ...theme.applyStyles('dark', { backgroundColor: HEAD_SURFACE.dark }),
          color: theme.vars.palette.text.secondary,
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }),
        /*
         * Both tables set `enableStickyHeader`, and MUI's own stickyHeader rule
         * hardcodes `background.default`. It is emitted after the `head` slot, so
         * it silently wins and the header takes the *page* colour — which is how
         * the header stayed blue-grey while everything else went white.
         */
        stickyHeader: ({ theme }) => ({
          backgroundColor: HEAD_SURFACE.light,
          ...theme.applyStyles('dark', { backgroundColor: HEAD_SURFACE.dark }),
        }),
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          // The container already draws the bottom edge; a rule under the final
          // row doubles it up.
          '&:last-of-type td': { borderBottom: 0 },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
        // Slightly tighter than MUI's default, which looks loose at size="small".
        labelSmall: { paddingLeft: 8, paddingRight: 8 },
      },
    },

    // Floating surfaces get the same hairline as the fixed ones, so the whole UI
    // is built from one material.
    MuiMenu: {
      styleOverrides: {
        paper: ({ theme }) => ({
          border: `1px solid ${theme.vars.palette.divider}`,
          backgroundImage: 'none',
        }),
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: ({ theme }) => ({
          border: `1px solid ${theme.vars.palette.divider}`,
          backgroundImage: 'none',
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          border: `1px solid ${theme.vars.palette.divider}`,
          backgroundImage: 'none',
        }),
      },
    },

    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: {
        tooltip: { fontSize: '0.75rem', fontWeight: 500, padding: '6px 10px' },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        // Scrollbars inside tables and hex dumps, following the active scheme.
        '*': { scrollbarWidth: 'thin' },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: 'var(--mui-palette-action-disabled)',
          borderRadius: 8,
        },
      },
    },
  },
});

/** Applied to hex dumps, MAC addresses and packet detail text. */
export const monoSx = { fontFamily: MONO_STACK, fontSize: '0.78rem' } as const;

/**
 * Surface used for code-like blocks (hex dumps, WHOIS output). A literal
 * `grey.50` would be near-white in the dark scheme, so this follows the scheme.
 */
export const codeSurfaceSx = {
  bgcolor: 'action.hover',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
} as const;
