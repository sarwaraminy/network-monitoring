import { createTheme } from '@mui/material/styles';

const MONO_STACK = '"JetBrains Mono", "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace';

/**
 * Table header fill: one step off `background.paper`, not the page colour.
 *
 * Opaque on purpose. Both tables use sticky headers, so a translucent fill would
 * let rows scroll visibly through the header.
 */
/**
 * Surface roles, ported from the PRO 2.0 design system in the sibling
 * `professional` project.
 *
 * The relationships are what matter, not the hexes on their own: in light the
 * canvas is pure white and the card sits a hair off it (#FBFDFE), so the card
 * reads as raised by tint rather than by shadow. In dark the canvas drops to
 * #10171D so the card (#17222B) can hold the same relationship. Elevation is
 * tint plus a hairline, never a drop shadow.
 *
 * `gridOnCard` is the odd one and deliberately so: in light it is the canvas
 * colour, so a table nested in a card reads as punched through the card back to
 * the page. Dark carries that relationship rather than inventing a shade.
 */
export const SURFACE = {
  light: {
    canvas: '#FFFFFF',
    card: '#FBFDFE',
    cardHeader: '#EDF3F7',
    cardBorder: '#DCE6EC',
    cardHeaderInk: '#2E4553',
    gridHeaderInk: '#5C6D78',
    gridOnCard: '#FFFFFF',
    gridOnCardOutline: '#E7EEF2',
  },
  dark: {
    canvas: '#10171D',
    card: '#17222B',
    cardHeader: '#1E2C36',
    cardBorder: '#2C3E4A',
    cardHeaderInk: '#C9DCE8',
    gridHeaderInk: '#9FB3C0',
    gridOnCard: '#10171D',
    gridOnCardOutline: '#2C3E4A',
  },
} as const;

/**
 * The application header.
 *
 * Light keeps a raised bar with the brand sweep behind the tabs; dark uses a
 * deeper flat navy, because the azure sweep was the brightest thing on the page.
 *
 * `activeTabInk` is a separate token from the brand azure on purpose. Base azure
 * measures 3.28:1 on the lifted pale tab and 3.94:1 on the dark navy, both under
 * the 4.5:1 floor for 14px text; these two values clear it.
 *
 * There is no underline token. The source system uses one as dark mode's
 * substitute for the lift; both schemes lift here, so a rule under the tab would
 * be a second marker under a surface that already says "current page".
 */
export const HEADER = {
  light: {
    barBg: '#F9FAFB',
    navBg: 'linear-gradient(135deg, #154069, #0e558a, #0677b2, #0a669e, #0289c8)',
    tabInk: '#FFFFFF',
    activeTabInk: '#1A6EA8',
    activeTabBg: '#F9FAFB',
  },
  dark: {
    barBg: '#0E1B2E',
    navBg: '#122F52',
    tabInk: '#FFFFFF',
    activeTabInk: '#33A9DD',
    // The page canvas, which is the same idea as light's `#F9FAFB`: the active
    // tab is a notch of the page showing through the bar. Dark had carried only
    // an underline, on the reasoning that a pale slab on dark chrome is the
    // brightest thing on screen — true of a PALE slab, but the canvas is darker
    // than the bar, so it recesses rather than glares.
    activeTabBg: SURFACE.dark.canvas,
  },
} as const;

/** Drawer / sidebar rows. Only the active row is tinted. */
export const NAV = {
  light: { activeInk: '#1A6EA8', activeBg: '#EEF3F7', activeRule: '#1A6EA8', itemInk: '#3C4A54' },
  dark: { activeInk: '#38B0E6', activeBg: '#0E2A38', activeRule: '#38B0E6', itemInk: '#E6EAEF' },
} as const;

/**
 * Table header fill.
 *
 * Kept as a token because the tables still reference it, but it now resolves to
 * the card header tint so a grid head and a card head are the same surface.
 */
export const HEAD_SURFACE = {
  light: SURFACE.light.cardHeader,
  dark: SURFACE.dark.cardHeader,
} as const;

/**
 * Shape and card metrics, in px.
 *
 * These sit deliberately off the 8px spacing grid: the source spec gives 13px
 * card padding, a 12px inter-card gap and 14/16px page padding by value, and it
 * is the later and more specific rule for this component. Do not round them.
 *
 * The 5px card radius is one off the 4px used everywhere else, and that is also
 * from the spec rather than a slip.
 */
export const RADIUS = { sm: 4, md: 8, card: 5 } as const;

export const CARD_METRICS = {
  headerPaddingBlock: 8,
  headerPaddingInline: 13,
  bodyPadding: 13,
  gap: 12,
  pagePaddingBlock: 14,
  pagePaddingInline: 16,
  borderWidth: 1,
  headerFontSize: 13,
  headerFontWeight: 700,
} as const;

/** Grid metrics: 48px rows, 40px dense, a 13px/700 header on a hairline. */
export const GRID_METRICS = {
  rowHeight: 48,
  denseRowHeight: 40,
  headerFontSize: 13,
  headerFontWeight: 700,
} as const;

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
        background: { default: SURFACE.light.canvas, paper: SURFACE.light.card },
        divider: SURFACE.light.cardBorder,
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
        background: { default: SURFACE.dark.canvas, paper: SURFACE.dark.card },
        divider: SURFACE.dark.cardBorder,
        text: { primary: '#e6edf7', secondary: '#9aa8bd' },
      },
    },
  },
  shape: { borderRadius: RADIUS.sm },
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

          /*
           * The brand header, from the PRO 2.0 system.
           *
           * Light gets the brand sweep behind the tabs; dark gets a flat, deeper
           * navy instead, because the azure sweep was the brightest thing on a
           * dark page and pulled the eye to the chrome rather than the alerts.
           *
           * This is opaque rather than the blurred translucent bar it replaces.
           * A sweep cannot be translucent — the page scrolling through it turns
           * the gradient muddy — and the tab treatment below depends on the bar
           * being a known colour.
           */
          background: HEADER.light.navBg,
          color: HEADER.light.tabInk,
          borderBottom: 'none',
          ...theme.applyStyles('dark', {
            background: HEADER.dark.navBg,
            color: HEADER.dark.tabInk,
          }),
        }),
      },
    },
    /*
     * Every surface in the app is `variant="outlined"` — Card and Paper both —
     * so one rule on the outlined slot covers all of them. Menus and dialogs use
     * `elevation` instead and are untouched.
     */
    MuiPaper: {
      styleOverrides: {
        // No drop shadow, in either scheme. Elevation is carried by the surface
        // tint and the hairline — a card is a hair off the canvas, and that plus
        // a 1px border is the whole treatment.
        outlined: ({ theme }) => ({
          boxShadow: 'none',
          borderColor: SURFACE.light.cardBorder,
          borderRadius: RADIUS.card,
          ...theme.applyStyles('dark', { borderColor: SURFACE.dark.cardBorder }),
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
          backgroundColor: SURFACE.light.gridOnCard,
          color: SURFACE.light.gridHeaderInk,
          ...theme.applyStyles('dark', {
            backgroundColor: SURFACE.dark.gridOnCard,
            color: SURFACE.dark.gridHeaderInk,
          }),
          fontSize: GRID_METRICS.headerFontSize,
          fontWeight: GRID_METRICS.headerFontWeight,
          // Title-case, not the shouted uppercase this had. A 13px/700 label on
          // a hairline is the whole header treatment; the tinted band it used to
          // sit on is gone, so the header reads as part of the grid rather than
          // as a second piece of chrome inside the card.
          letterSpacing: 0,
          textTransform: 'none',
          whiteSpace: 'nowrap',
        }),
        /*
         * Both tables set `enableStickyHeader`, and MUI's own stickyHeader rule
         * hardcodes `background.default`. It is emitted after the `head` slot, so
         * it silently wins and the header takes the *page* colour — which is how
         * the header stayed blue-grey while everything else went white.
         */
        stickyHeader: ({ theme }) => ({
          // Opaque, and the same colour as the grid it sits on. Both tables are
          // sticky, and rows scrolling visibly under a transparent header is
          // worse than any tint decision.
          backgroundColor: SURFACE.light.gridOnCard,
          ...theme.applyStyles('dark', { backgroundColor: SURFACE.dark.gridOnCard }),
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
