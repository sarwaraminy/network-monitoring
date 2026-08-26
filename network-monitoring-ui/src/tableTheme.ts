import type { Theme } from '@mui/material/styles';
import { SURFACE } from './theme';

/**
 * Shared Material React Table appearance.
 *
 * Only the things the MUI theme cannot reach live here. Cell borders, header
 * typography and row hover are set in `theme.ts` against `MuiTableCell` and
 * friends, so a plain MUI table and an MRT table look identical — MRT renders
 * real MUI primitives, so there is no reason to style them twice.
 *
 * What is left is MRT's own chrome: the wrapper Paper and its two toolbars.
 * MRT defaults the wrapper to an *elevated* Paper, which is why the tables used
 * to float on a drop shadow while every card in the app sat flat inside a
 * hairline. Matching them is the point of this file.
 */

/** Spread into `useMaterialReactTable({ ... })` before any per-table options. */
export const sharedTableOptions = {
  muiTablePaperProps: {
    // Same surface treatment as every Card: outlined, and picking up the shadow
    // and dark-mode border from the MuiPaper override in theme.ts.
    variant: 'outlined' as const,
    sx: (theme: Theme) => ({
      // Stated explicitly rather than left to Paper's default. MRT ships its own
      // background on the wrapper, and in dark mode MUI layers an elevation
      // gradient on top of it, so without pinning both the table ends up a
      // different shade from every Card beside it.
      backgroundColor: SURFACE.light.gridOnCard,
      ...theme.applyStyles('dark', { backgroundColor: SURFACE.dark.gridOnCard }),
      backgroundImage: 'none',
      // Clips the sticky header and the toolbars to the rounded corners; without
      // it the header's tinted background squares off the top of the card.
      overflow: 'hidden',

      /*
       * MRT paints `background.default` onto every row and cell it renders. It
       * does that with its own `sx`, which is emitted as a single-class emotion
       * rule — so it beats anything in the theme's `styleOverrides`, and the
       * table stayed page-coloured no matter what MuiTableCell said.
       *
       * Reaching it from the Paper is what wins: a descendant selector scores
       * higher than MRT's single class, without resorting to `!important` or
       * repeating props on every table.
       */
      // The doubled class names are deliberate. A single descendant selector was
      // enough for the cells but not for the body rows, which MRT paints from a
      // rule that outranks it. Repeating the class buys specificity without
      // reaching for `!important`, which would then have to be fought again by
      // anything legitimately overriding a single table.
      '& .MuiTableRow-root.MuiTableRow-root, & .MuiTableCell-root.MuiTableCell-root': {
        backgroundColor: 'transparent',
      },
      // Same specificity as the reset above, declared after it, so it wins.
      // The grid head sits on the grid's own surface, not a tinted band. This
      // rule exists only to out-rank MRT's inline background, which is emitted
      // as a single emotion class and beats the theme's `styleOverrides`; the
      // colour it restores is the same one theme.ts sets on `MuiTableCell.head`.
      '& .MuiTableCell-head.MuiTableCell-head': {
        backgroundColor: SURFACE.light.gridOnCard,
        ...theme.applyStyles('dark', { backgroundColor: SURFACE.dark.gridOnCard }),
      },
      // Zeroing the backgrounds also removes MRT's row hover, so put it back.
      '& .MuiTableBody-root .MuiTableRow-root:hover .MuiTableCell-root.MuiTableCell-root': {
        backgroundColor: theme.vars?.palette.action.hover,
      },
    }),
  },

  // Transparent so the Paper colour above is what shows through.
  //
  // Note there is deliberately no `muiTableContainerProps` here: both tables set
  // their own for maxHeight, and a per-table value replaces the shared one whole
  // rather than merging — a rule here would look applied and silently not be.
  muiTableProps: {
    sx: { backgroundColor: 'transparent' },
  },

  // The toolbars inherit the Paper surface rather than painting their own, so
  // the table reads as one object instead of three stacked strips.
  muiTopToolbarProps: {
    sx: {
      backgroundColor: 'transparent',
      backgroundImage: 'none',
      boxShadow: 'none',
    },
  },
  muiBottomToolbarProps: {
    sx: {
      backgroundColor: 'transparent',
      backgroundImage: 'none',
      boxShadow: 'none',
      borderTop: '1px solid',
      borderColor: 'divider',
    },
  },
} as const;
