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
 * The same estimate `MagnitudeBarChart` uses for its category axis, and the same
 * trade: measuring text properly means rendering it, and an axis that resizes
 * after paint makes the plot jump.
 */
const APPROX_CHAR_WIDTH = 6.4;

/**
 * What MUI reserves beside a Y tick label, and does not give back.
 *
 * `tickSize` (4 with `disableTicks`, 6 without) plus `TICK_LABEL_GAP` (2) are
 * subtracted from the axis width before the label is laid out, and a label past
 * what is left is ellipsized — `ChartsSingleYAxisTicks.js`. Worth naming because
 * `disableTicks` does *not* reclaim the space it stops drawing: it forces
 * `tickSize` to 4 rather than 0.
 */
const Y_TICK_OVERHEAD = 4 + 2;

const MIN_VALUE_AXIS_WIDTH = 34;
/**
 * A ceiling, because the axis competes with the plot for the card's width.
 *
 * At this point a label is ellipsized rather than allowed to take the chart over
 * — the same trade `MagnitudeBarChart` makes on its category axis.
 */
const MAX_VALUE_AXIS_WIDTH = 88;

/**
 * Room for a Y axis whose widest label is `longest`.
 *
 * Computed rather than fixed, and computed from the *rendered* label, because the
 * three locales are not close to each other. A fixed 52px was sized from German
 * on the assumption that `"2,8 Mio."` was the longest of the three; both halves
 * of that were wrong. German does not abbreviate below a million at all —
 * `compact(120_000)` is `120.000` — and Dari spells the unit out where German
 * shortens it, so `compact(1_200_000_000)` is `۱٫۲ میلیارد`, eleven characters
 * against four for `1.2B`. Every Dari tick past a thousand was being ellipsized,
 * on numbers whose whole purpose is to be read at a glance, in the locale least
 * likely to be checked by eye.
 *
 * It follows the data rather than the poll: the label only lengthens when the
 * series changes order of magnitude, which is both rare and the moment a wider
 * axis is genuinely needed.
 */
export function valueAxisWidth(longest: string): number {
  const text = Math.ceil(longest.length * APPROX_CHAR_WIDTH);
  return Math.min(MAX_VALUE_AXIS_WIDTH, Math.max(MIN_VALUE_AXIS_WIDTH, text + Y_TICK_OVERHEAD));
}

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
    '& .MuiChartsAxis-tickLabel': { fontSize: TICK_FONT_SIZE },
  };
}
