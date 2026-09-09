import type { ChartPalette } from './palette';

/**
 * The furniture every chart shares: grid, axes, ticks.
 *
 * Ported from the dashboard charts in the sibling `professional` project, so the
 * two products read as one house style. What came across is the *chrome* — a
 * dashed horizontal-only grid, hairline axes with no tick marks, 11px secondary
 * tick labels, and a compact numeric scale. What deliberately did not is the
 * area-under-line form those charts use; see the note in SeverityTrendChart.
 *
 * One module rather than an `sx` per chart because the point is that they match.
 * Two charts restyled separately drift on the first change to either.
 */

/** Tick labels: small and recessive, so the data is what carries weight. */
export const TICK_FONT_SIZE = 11;

/**
 * Room reserved for the Y axis.
 *
 * Fixed rather than measured, and wide enough for a compact label plus its
 * suffix: "2,8 Mio." is the longest of the three languages, and an axis that
 * resizes as the numbers grow makes the plot jump between polls.
 */
export const Y_AXIS_WIDTH = 52;

export const tickLabelStyle = { fontSize: TICK_FONT_SIZE } as const;

/**
 * Grid and axis styling, as an `sx` for an `@mui/x-charts` root.
 *
 * The dash is the visible half of the port: a solid grid competes with the series
 * for attention, and `professional` draws `3 3` in the divider colour. Vertical
 * grid lines are off — a band axis already separates the categories, and adding
 * verticals draws a box around every bar.
 *
 * Tick marks go and the axis line stays as a hairline: with labels this small the
 * marks are noise, but the baseline is what stops the bars floating.
 */
export function chartChromeSx(palette: ChartPalette) {
  return {
    '& .MuiChartsGrid-line': {
      stroke: palette.grid,
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
    '& .MuiChartsAxis-line': { stroke: palette.axis, strokeWidth: 1 },
    // The marks, not the labels — `MuiChartsAxis-tick` is the small line, and
    // `-tickLabel` the text, which keeps its colour from the theme.
    '& .MuiChartsAxis-tick': { display: 'none' },
    '& .MuiChartsAxis-tickLabel': { fontSize: TICK_FONT_SIZE },
    /*
     * The Y axis loses its line as well as its ticks.
     *
     * `professional` draws no vertical baseline: the horizontal grid already
     * carries the scale, and a left-hand rule closes the plot on a side the data
     * does not start from. Scoped to the left axis so the X baseline survives.
     */
    '& .MuiChartsAxis-directionY .MuiChartsAxis-line': { display: 'none' },
  };
}
