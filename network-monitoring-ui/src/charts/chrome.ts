import type { ChartPalette } from './palette';

/**
 * The furniture every chart shares: grid, axes, ticks.
 *
 * Ported from the dashboard charts in the sibling `professional` project, so the
 * two products read as one house style. What came across is the *chrome* — a
 * dashed grid, hairline axes without tick marks, small recessive tick labels, and
 * a compact numeric scale. What deliberately did not is the area-under-line form
 * those charts use; see the note in SeverityTrendChart.
 *
 * One module rather than an `sx` per chart because the point is that they match.
 * Two charts restyled separately drift on the first change to either.
 *
 * **What belongs here is what is true of both charts.** The two differ in layout
 * — the trend chart is vertical and its value axis is Y, the magnitude chart is
 * horizontal and its value axis is X — so anything that depends on which axis
 * carries values, or on which grid lines are drawn, stays with the chart. An
 * earlier version put the "hide the Y axis line" rule in here, which is right for
 * the trend chart and removes the baseline every bar grows from in the other.
 */

/** Tick labels: small and recessive, so the data is what carries weight. */
export const TICK_FONT_SIZE = 11;

/**
 * Rough advance of one character at the tick size.
 *
 * Used only by `MagnitudeBarChart`'s *category* axis, whose labels are known
 * strings rather than ticks a scale invents. The value axes ask MUI to measure
 * instead — see the note on `width: 'auto'` in SeverityTrendChart — because an
 * estimate cannot see a tick the scale added above the data, and because 6.4px a
 * character is a poor guess for Perso-Arabic in particular.
 */
export const APPROX_CHAR_WIDTH = 6.4;

export const tickLabelStyle = { fontSize: TICK_FONT_SIZE } as const;

/**
 * Axis config shared by both charts: no tick marks, small labels.
 *
 * `disableTicks` rather than hiding the marks in CSS. MUI lays the axis out from
 * the `tickSize` prop, not from what CSS ends up painting, so `display: none`
 * removed the marks and left their space reserved — six pixels out of a budget
 * that was already ellipsizing labels.
 */
export const axisChrome = { disableTicks: true, tickLabelStyle } as const;

/**
 * Grid and axis styling, as an `sx` for an `@mui/x-charts` root.
 *
 * The dash is the visible half of the port: a solid grid competes with the series
 * for attention, and `professional` draws `3 3` in the divider colour.
 *
 * *Which* grid lines are drawn is each chart's own business — the trend chart
 * draws horizontals across a vertical stack, the magnitude chart verticals across
 * horizontal bars — so this styles whatever is there rather than deciding.
 */
export function chartChromeSx(palette: ChartPalette) {
  return {
    '& .MuiChartsGrid-line': {
      stroke: palette.grid,
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
    '& .MuiChartsAxis-line': { stroke: palette.axis, strokeWidth: 1 },
    /*
     * No tick-label `font-size` here on purpose.
     *
     * MUI fits axis labels from the *inline* style it is given, not from what CSS
     * ends up applying, so a size set here would paint at 11px while the layout
     * reserved room for the 12px default — over-reserving on every axis, and on
     * the computed width above silently changing the arithmetic. `axisChrome`
     * carries `tickLabelStyle`, which is where MUI can see it.
     */
  };
}
