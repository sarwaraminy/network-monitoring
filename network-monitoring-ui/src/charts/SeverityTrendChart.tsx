import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { useMemo } from 'react';
import { SEVERITY_STYLE } from '../components/SeverityChip';
import { createFormatters, type Formatters, useFormatters } from '../i18n/format';
import { DEFAULT_LOCALE } from '../i18n/generated/locales';
import { useT } from '../i18n/ui';
import type { AlertTrendPoint, TrendBucket } from '../types';
import { axisChrome, axisLabelCandidates, chartChromeSx, valueAxisWidth } from './chrome';
import { SEVERITY_ORDER } from './palette';
import { useChartPalette } from './useChartPalette';

/**
 * How one bucket is named on the axis.
 *
 * Exported because the timezone question here has one right answer per bucket kind
 * and it is not obvious which:
 *
 *  - An **hourly** bucket is an instant, and an instant belongs in the viewer's own
 *    time. 22:00Z happened to them at whatever their clock said.
 *  - Every **other** bucket is not an instant, it is the name of a UTC period. The
 *    API aggregates in UTC so that live rows out of `alerts` and rolled-up days out
 *    of `alert_rollup_daily` can be merged into one series, and formatting that
 *    midnight in local time renames it: anywhere west of UTC, every bar would carry
 *    the previous day's date.
 *
 * A **week** is labelled by the day it starts on rather than as a range. The axis
 * has room for one short date per band, and "7 Sep" beside "14 Sep" already reads
 * as a week once the caption says so — where "7–13 Sep" at 52 bands does not fit
 * and would be dropped by the tick placer, which is worse than a shorter label.
 */
export function bucketLabel(
  bucket: TrendBucket,
  iso: string,
  format: Formatters = createFormatters(DEFAULT_LOCALE),
): string {
  // The formatter is a parameter with a default rather than a hook call, because
  // this is also the axis' `valueFormatter` — called by the chart outside React's
  // render, where a hook cannot go. The default keeps the existing unit tests
  // calling it with two arguments.
  if (bucket === 'hour') return format.time(iso);
  /*
   * A month band spans no single day, so naming one would be a claim the bucket
   * does not make — and "1 Sep" beside "1 Oct" reads as a daily axis.
   *
   * `day: undefined` is doing real work. `Formatters.day` starts from `{ year,
   * month, day, timeZone: 'UTC' }` and spreads the caller's options over it, so
   * omitting `day` leaves the base's `day: 'numeric'` in place — the first
   * version of this asked for a month and got "Sep 1, 2026". Overriding it is
   * what removes the field.
   *
   * `calendar: 'gregory'` is the one place this interface departs from the Solar
   * Hijri calendar `fa-AF` selects, and it is not a retreat from that choice.
   *
   * The other three units name an INSTANT or a DAY, which is exact in any
   * calendar: an hour is an hour, and the day a week starts on is that day
   * whatever it is called. A month label is different — it is a claim about the
   * extent of the band. The bucket is `date_trunc('month')`, so it holds 1–31
   * January; labelled in Solar Hijri that band reads `جدی ۱۴۰۴`, which runs about
   * 22 December to 20 January, and eleven of the bar's days fall outside the month
   * it is named after. The next bar says `دلو ۱۴۰۴`, so the pair asserts a
   * boundary no bucket in the series has.
   *
   * Naming the band by the calendar it was actually cut in is the truthful option.
   * A Solar Hijri *bucket* would be the other one, and it is a real feature rather
   * than a label change: `date_trunc` has no such unit, so the grouping, the
   * rollup fold and `startOfUtcBucket` would all have to learn the calendar.
   */
  if (bucket === 'month') {
    return format.day(iso, {
      year: 'numeric',
      month: 'short',
      day: undefined,
      calendar: 'gregory',
    });
  }
  return format.day(iso);
}

/**
 * Where a bucket ends, from its own start rather than from its neighbour's.
 *
 * The first version read the end off the next *plotted* bucket, which assumes
 * consecutive entries in `trend` are consecutive in time. They are not: the API
 * emits no row for a period with no findings, so a quiet day is a gap. Daily bars
 * for Jun 1, 2, 3, 5, 6 with a boundary at Jun 4 put the line on **Jun 3** — a
 * bar entirely before the boundary, and therefore entirely aggregate, under a
 * label saying detail begins there.
 *
 * The last bucket had no neighbour at all, so its width was inferred from the
 * previous gap: bars for January and May implied a four-month final bucket, and a
 * boundary in June — genuinely past the chart — still drew a marker.
 *
 * A month is not a fixed number of milliseconds, so it advances the calendar
 * field rather than adding a constant. That is also why this cannot be a
 * subtraction between neighbours even when there are no gaps.
 */
function endOfBucket(iso: string, bucket: TrendBucket): number {
  const at = new Date(iso);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const date = at.getUTCDate();

  switch (bucket) {
    case 'hour':
      return Date.UTC(year, month, date, at.getUTCHours() + 1);
    case 'day':
      return Date.UTC(year, month, date + 1);
    case 'week':
      return Date.UTC(year, month, date + 7);
    case 'month':
      return Date.UTC(year, month + 1, 1);
  }
}

/**
 * Which plotted band the retention boundary falls in, or `null` for none.
 *
 * Exported and pure because this is where the bugs have been, and because a
 * rendered reference line is positioned by an SVG `x` that a DOM test cannot read
 * back — so "is a marker shown" is testable through the component and "which bar
 * is it on" is only testable here. The first version of the gap fix had a render
 * test that passed either way for exactly that reason.
 *
 * The boundary is an instant inside a bucket, so the search is for the first
 * bucket whose END is past it — not the first that starts at or after it, which
 * misses whenever the boundary falls inside the newest band.
 *
 * `null` at index 0: the boundary is inside the first plotted band, so nothing on
 * screen is wholly aggregated and a line at the left edge would be read as a
 * boundary further back. `null` for no match: the boundary is past everything
 * plotted, which is genuinely off-screen.
 */
export function boundaryBandIndex(
  trend: readonly AlertTrendPoint[],
  bucket: TrendBucket,
  rolledUpBefore: string | null,
): number | null {
  if (!rolledUpBefore || trend.length === 0) return null;

  const at = new Date(rolledUpBefore).getTime();
  const index = trend.findIndex((point) => endOfBucket(point.bucket, bucket) > at);
  return index > 0 ? index : null;
}

interface Props {
  trend: AlertTrendPoint[];
  bucket: TrendBucket;
  /**
   * Where detail ends and the daily rollup begins, or `null` for a window that
   * does not reach that far back.
   */
  rolledUpBefore?: string | null;
  height?: number;
}

/**
 * Findings over time, stacked by severity.
 *
 * Form: the job is part-to-whole over time, which is a stacked column. Severity is
 * ordinal, so the stack order runs least→most severe from the baseline up and the
 * colours are one hue stepped by lightness — see charts/palette.ts for why this is
 * a ramp rather than five distinct hues.
 *
 * A 2px gap in the surface colour separates the segments, which is what makes
 * neighbouring steps read as distinct without drawing a border around them.
 *
 * The chrome — dashed horizontal grid, hairline axes, small recessive ticks, a
 * compact numeric scale, a crosshair on hover — is ported from the dashboard
 * charts in the sibling `professional` project, so the two read as one house
 * style. See charts/chrome.ts.
 *
 * **Their area-under-line form is deliberately not ported**, and the reason is
 * the data rather than taste. The API emits no row for a period with no findings,
 * so a quiet bucket is a *gap* in `trend` — see `endOfBucket`. A line or a
 * stacked area interpolates straight through that gap and draws values for
 * periods the series says nothing about, which on a security dashboard is a
 * fabricated quiet spell rather than a cosmetic difference. Columns leave the gap
 * visible. Adopting the area form would mean the API emitting explicit zeroes
 * first, which is a change to the endpoint and not to this file.
 */
export default function SeverityTrendChart({
  trend,
  bucket,
  rolledUpBefore = null,
  height = 260,
}: Readonly<Props>) {
  const t = useT();
  const palette = useChartPalette();
  const chrome = useMemo(() => chartChromeSx(palette), [palette]);

  const format = useFormatters();

  /*
   * The axis is sized from the widest label it will actually carry.
   *
   * The stack's tallest column is what sets the scale, so its total is about the
   * largest tick MUI will place — close enough to size from, and it is the only
   * value available before the chart lays itself out.
   */
  const axisWidth = useMemo(() => {
    const tallest = trend.reduce(
      (most, point) => Math.max(most, point.critical + point.high + point.medium + point.low + point.info),
      0,
    );
    return valueAxisWidth(...axisLabelCandidates(tallest, format.compact));
  }, [trend, format]);
  const labels = useMemo(
    () => trend.map((point) => bucketLabel(bucket, point.bucket, format)),
    [trend, bucket, format],
  );

  // Least severe at the bottom, so the stack reads upward in order of seriousness.
  const stackOrder = useMemo(() => [...SEVERITY_ORDER].reverse(), []);

  // Only plot severities that actually occur; an all-zero series adds a legend
  // entry that means nothing.
  const present = useMemo(
    () => stackOrder.filter((severity) => trend.some((point) => point[severity] > 0)),
    [stackOrder, trend],
  );

  /*
   * The band the retention boundary sits on: the oldest bucket still made of rows.
   *
   * Everything to its left is served from `alert_rollup_daily` — counts kept after
   * the detail behind them was deleted. Without the marker those bars are
   * indistinguishable from quiet ones, which is the confusion the rollup exists to
   * prevent arriving from the other direction: the operator sees a low bar, opens
   * it expecting findings, and gets nothing.
   *
   * The band is found by which bucket CONTAINS the boundary, not by which one
   * starts at or after it.
   *
   * `point.bucket` is a bucket start and `rolledUpBefore` is an instant inside
   * one, so a "first start at or after it" search misses whenever the boundary
   * falls inside the newest bucket — `findIndex` returns -1 and the marker
   * vanishes. Any retention window shorter than the bucket width reaches that:
   * `ALERT_RETENTION_DAYS=7` with the five-year period puts the boundary about a
   * week ago while the newest bucket starts on the 1st of the month, so from the
   * 8th onwards there was no line at all — with essentially every bar on screen an
   * aggregate. The user guide now tells the reader the line is what marks where
   * detail ends, so its absence positively asserts "all of this is detailed",
   * exactly when none of it is.
   *
   * Null still means off-screen, and now only that. A boundary newer than the last
   * bucket's end is genuinely in the future; one inside the FIRST bucket has
   * nothing aggregated to its left to divide off, so a line at the left edge would
   * be read as a boundary that is really further back.
   */
  const boundaryBand = useMemo(() => {
    const index = boundaryBandIndex(trend, bucket, rolledUpBefore);
    return index === null ? null : (labels[index] ?? null);
  }, [rolledUpBefore, trend, labels, bucket]);

  if (trend.length === 0) {
    return <EmptyPlot height={height} message={t('chart.no_findings_period')} />;
  }

  return (
    <BarChart
      height={height}
      xAxis={[{ scaleType: 'band', data: labels, ...axisChrome }]}
      yAxis={[
        {
          tickMinStep: 1,
          ...axisChrome,
          /*
           * No axis line, which is right here and not in the shared chrome: this
           * chart is vertical, so Y is the value axis and the horizontal grid
           * already carries the scale. `MagnitudeBarChart` is horizontal, where Y
           * is the category axis and its line is the baseline every bar grows
           * from.
           *
           * The prop rather than a `display: none` rule, for the reason
           * `disableTicks` replaced the equivalent CSS: MUI lays out from what it
           * is passed, not from what CSS paints.
           */
          disableLine: true,
          width: axisWidth,
          // Shortened per locale, so a large count is a tick rather than an axis
          // wide enough to crowd the plot.
          valueFormatter: (value: number | null) => (value === null ? '' : format.compact(value)),
        },
      ]}
      series={
        present.length > 0
          ? present.map((severity) => ({
              data: trend.map((point) => point[severity]),
              label: t(SEVERITY_STYLE[severity].labelKey),
              stack: 'severity',
              color: palette.severity[severity],
            }))
          : [{ data: trend.map(() => 0), label: t('dashboard.no_findings'), color: palette.grid }]
      }
      // A legend is always present once two or more series are plotted; identity
      // must never rest on colour alone.
      hideLegend={present.length < 2}
      slotProps={{ legend: { position: { vertical: 'bottom', horizontal: 'center' } } }}
      grid={{ horizontal: true }}
      /*
       * No `axisHighlight` here on purpose. `useBarChartProps` already defaults a
       * vertical bar series to `{ x: 'band' }` — and a horizontal one to
       * `{ y: 'band' }`, which is how `MagnitudeBarChart` gets the same crosshair
       * without a line of its own. Passing it explicitly changed nothing and read
       * as load-bearing.
       */
      borderRadius={4}
      margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
      sx={{
        ...chrome,
        // The 2px surface gap between stacked segments, which is this chart's own
        // and not part of the shared chrome.
        '& .MuiBarChart-element': { stroke: palette.surface, strokeWidth: 2 },
      }}
    >
      {boundaryBand !== null && (
        <ChartsReferenceLine
          x={boundaryBand}
          label={t('chart.detail_from_here')}
          labelAlign="start"
          // Dashed and in the axis colour: this is chart furniture describing where
          // the data came from, not another series. A solid line in a severity
          // colour would read as a threshold somebody set.
          lineStyle={{ stroke: palette.axis, strokeDasharray: '4 4' }}
          labelStyle={{ fontSize: 11, fill: palette.axis }}
        />
      )}
    </BarChart>
  );
}

function EmptyPlot({ height, message }: Readonly<{ height: number; message: string }>) {
  return (
    <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {message}
      </Typography>
    </Box>
  );
}
