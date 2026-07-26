import { createTheme } from '@mui/material/styles';

const MONO_STACK = '"JetBrains Mono", "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace';

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
        background: { default: '#f4f6fb', paper: '#ffffff' },
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
        background: { default: '#0b1220', paper: '#111a2b' },
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
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          // Fixed dark bar in both schemes: it reads as chrome rather than content.
          backgroundColor: '#0f172a',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiTooltip: { defaultProps: { arrow: true } },
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
