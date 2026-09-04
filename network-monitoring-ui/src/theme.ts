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
 * Light keeps a raised bar with the brand sweep; dark uses a deeper flat navy,
 * because the azure sweep was the brightest thing on the page.
 *
 * The bar no longer carries the navigation — that moved to the sidebar, which
 * is what the tab tokens (`activeTabBg`, `activeTabInk`) used to colour. They are
 * gone with the tabs rather than left behind as tokens nothing paints. What is
 * left is the brand strip: the sweep, and `barInk` for the brand and the
 * controls sitting on it. It was `tabInk` while there were tabs to ink.
 */
export const HEADER = {
  /**
   * Fixed bar height, in px.
   *
   * Needed as a number, not just as `Toolbar`'s default, because the sidebar
   * sticks to the underside of the bar and has to be told where that is. MUI's
   * `mixins.toolbar` is a responsive style object rather than a value, so it
   * cannot be arithmetic. 64 is what the default resolves to from `sm` up, and
   * the sidebar is only mounted from `md` up — below that the navigation is a
   * temporary drawer, which floats over the bar and needs no offset.
   */
  height: 64,
  light: {
    barBg: '#F9FAFB',
    navBg: 'linear-gradient(135deg, #154069, #0e558a, #0677b2, #0a669e, #0289c8)',
    barInk: '#FFFFFF',
  },
  dark: {
    barBg: '#0E1B2E',
    navBg: '#122F52',
    barInk: '#FFFFFF',
  },
} as const;

/**
 * Sidebar navigation roles, ported from the PRO 2.0 design system in the
 * sibling `professional` project (its `NavRoles`, tickets PRO20-2693 / -2796).
 *
 * The values are that system's, not ours, and the point of taking them whole is
 * that the two apps then read as one product. Light and dark are NOT symmetric
 * and were never meant to be: PRO specifies light and derives dark, each dark
 * value reusing an established dark role a step off the surface it sits on
 * rather than inverting the light hex.
 *
 * `activeInk` and `activeRule` are deliberately different values in light — a
 * darker ink for the label, a brighter bar for the indicator. They agree in
 * dark, where a deep azure would disappear into the tint.
 *
 * `sectionBg` does double duty as the item HOVER fill, by design: a hovered row
 * reads as "about to become a row like that section header".
 *
 * `divider` is the rule BETWEEN sections and is deliberately lighter than
 * `SURFACE.cardBorder`, which is the panel's own outline and the heavier rule
 * under the header row.
 */
export const NAV = {
  light: {
    activeInk: '#0f4c78',
    activeBg: '#eaf3f8',
    activeRule: '#1272a4',
    /** Panel title ink — the 13/700/0.06em uppercase label in the header row. */
    titleInk: '#12222E',
    sectionBg: '#F5F8FA',
    sectionInk: '#31424E',
    /** Deliberately weaker than the section label it sits beside. */
    chevron: '#718593',
    itemInk: '#3d4a5c',
    /**
     * The SUBTITLE on a two-line item row, at rest, and the same subtitle on the
     * active row. Both are deliberately weaker than the ink they sit under — the
     * subtitle is the quieter half of the row and must read as smaller and
     * lower-contrast than the name above it.
     *
     * DARKENED from the source's #9AA0AA / #4D8BB0, which measure 2.63:1 on the
     * white panel and 3.28:1 on the active tint. Both are under the 4.5:1 that
     * 11px text needs, and "quieter" has a floor: past it the subtitle is not
     * quiet, it is unreadable. These measure 5.17:1 and 5.01:1 on the surfaces
     * they actually sit on, and both stay weaker than the ink above them —
     * `itemInk` is 8.8:1 and `activeInk` 7.9:1 — so the relationship the source
     * is expressing survives the correction.
     *
     * Dark needs no such change: those values were derived against the dark
     * panel and already clear AA.
     */
    itemCodeInk: '#656E79',
    activeCodeInk: '#2E6C93',
    divider: '#EDF3F7',
    /** Search-field placeholder ink. */
    placeholder: '#68747C',
    /**
     * The panel surface. PRO's `surface.surface` — white in light, and one step
     * off the dark canvas in dark, which is what lets the panel read as a
     * bordered object on the page rather than as part of it.
     */
    panelBg: '#FFFFFF',
  },
  dark: {
    activeInk: '#38B0E6',
    activeBg: '#0E2A38',
    activeRule: '#38B0E6',
    titleInk: '#C9DCE8',
    sectionBg: '#1E2C36',
    sectionInk: '#C9DCE8',
    chevron: '#9AA4B2',
    itemInk: '#E6EAEF',
    /*
     * Derived rather than specified, like the rest of dark: each reuses an
     * established dark role a step weaker than the ink it sits under. The active
     * one is the dark active ink blended 15% toward `activeBg`, which lands at
     * 4.81:1 — above AA and BELOW the name's 6.06:1, so the subtitle still reads
     * as the quieter half. An earlier guess measured STRONGER than the name it
     * sits under, inverting the rule.
     */
    itemCodeInk: '#9AA4B2',
    activeCodeInk: '#329CCC',
    divider: '#2A323C',
    placeholder: '#9AA4B2',
    panelBg: '#1B2027',
  },
} as const;

/**
 * Sidebar metrics, in px — PRO 2.0's `SIDEBAR_METRICS`, same source.
 *
 * Every number the design's measurement table gives lives here, because the
 * design's whole point is that these are the SAME wherever the panel appears:
 * one width, one set of row heights, and only the title and the section list
 * differ. There is deliberately no way to override one per screen — that drift
 * is what the consolidation existed to remove.
 *
 * The two indents are a pair, not a choice: the active row drops to 20 so that
 * its 2px rule lands flush and its label stays on the same optical line as its
 * inactive neighbours. Ours reaches the same result by drawing the rule on
 * every row and colouring only the active one, which needs a single 20px
 * indent — same geometry, one value instead of two.
 */
export const SIDEBAR_METRICS = {
  /** Panel width, and the rail left behind when it is collapsed. */
  panelWidth: 290,
  railWidth: 56,
  /** The panel's margin from the header above it and the page beside it. */
  panelMargin: 14,

  /** Title + collapse control. A row, not a card. */
  headerRowHeight: 48,
  headerFontSize: 13,
  headerTracking: '0.06em',

  /** Search row; the field itself is shorter than the row that holds it. */
  searchRowHeight: 52,
  searchFieldHeight: 32,
  searchFieldRadius: 5,

  /** Section header — the whole row is the click target, not just the chevron. */
  sectionHeaderHeight: 38,
  sectionFontSize: 11.5,
  sectionFontWeight: 700,
  sectionTracking: '0.07em',
  // No caret size: the source's table says 6px, but the caret it actually
  // renders is fixed at 16px by design — one glyph size for the whole app. A
  // constant nothing reads is worse than no constant.

  /**
   * Item row. The active treatment is fill, ink and a rule — never a size
   * change, which would make the list jump as the selection moves.
   *
   * `itemRowHeight` is a MINIMUM, not a fixed height: a one-line row is exactly
   * 34px and a wrapped or two-line one takes the space it needs rather than
   * clipping.
   */
  itemRowHeight: 34,
  itemFontSize: 13,
  /**
   * Item indent.
   *
   * The source carries a second constant here, `itemActiveIndent: 20`, for the
   * active row — 2px less, so its rule lands flush and the label stays on the
   * same optical line as its neighbours. That constant is not copied: the rule
   * here is drawn on every row and merely coloured when active, so `SideNav`
   * derives the same 20px as `itemIndent - activeRuleWidth`. Restating it would
   * be a value nothing reads, which this file argues against a few lines up.
   */
  itemIndent: 22,
  activeRuleWidth: 2,

  /*
   * The TWO-LINE item row: a label with a short code or qualifier under it.
   *
   * Separate metrics rather than changes to the single-line numbers above, so a
   * row without a subtitle is untouched. The variant is chosen by whether a row
   * HAS a subtitle, not by which screen renders it — so it is not the
   * per-screen override this design set out to remove, and any future entry
   * that needs a second line gets the treatment for free.
   */
  itemTwoLinePaddingY: 8,
  // No `itemTwoLinePaddingX`. The source insets a two-line row by its own 12px
  // rather than the 22px indent, which suits a panel where every row has a
  // subtitle; here almost none would, and a subtitled row 10px to the left of
  // its neighbours breaks the indent that carries the hierarchy. `SideNav`
  // insets both variants by `itemIndent`.
  itemNameFontSize: 13.5,
  itemNameLineHeight: 1.3,
  itemCodeFontSize: 11,
  itemCodeLineHeight: 1.2,
  itemCodeTracking: '0.04em',
  itemCodeGap: 2,
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
           * Light gets the brand sweep; dark gets a flat, deeper navy instead,
           * because the azure sweep was the brightest thing on a dark page and
           * pulled the eye to the chrome rather than to the alerts.
           *
           * The bar no longer carries the navigation — that is the sidebar's now
           * — so what sits on this sweep is the brand, the account avatar and,
           * below `md`, the drawer button. `barInk` colours all three.
           *
           * Opaque rather than the blurred translucent bar it replaces: a sweep
           * cannot be translucent, because the page scrolling through it turns
           * the gradient muddy.
           */
          background: HEADER.light.navBg,
          color: HEADER.light.barInk,
          borderBottom: 'none',
          ...theme.applyStyles('dark', {
            background: HEADER.dark.navBg,
            color: HEADER.dark.barInk,
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
