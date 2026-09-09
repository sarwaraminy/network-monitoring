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
 */
export default function SeverityTrendChart({
  trend,
  bucket,
  rolledUpBefore = null,
  height = 260,
}: Readonly<Props>) {
  const t = useT();
  const palette = useChartPalette();

  const format = useFormatters();
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
   * Placed on the first LIVE bucket rather than the last rolled-up one, so the line
   * reads as "detail starts here". Null when the boundary falls outside the plotted
   * range — before the oldest bar, or after the newest — because a line pinned to
   * the edge of the axis would be read as a boundary that is really off-screen.
   */
  const boundaryBand = useMemo(() => {
    if (!rolledUpBefore) return null;
    const at = new Date(rolledUpBefore).getTime();
    const index = trend.findIndex((point) => new Date(point.bucket).getTime() >= at);
    // `> 0`, not `>= 0`: index 0 means every plotted bucket is live, so the
    // boundary is older than the window and there is nothing here to divide.
    return index > 0 ? (labels[index] ?? null) : null;
  }, [rolledUpBefore, trend, labels]);

  if (trend.length === 0) {
    return <EmptyPlot height={height} message={t('chart.no_findings_period')} />;
  }

  return (
    <BarChart
      height={height}
      xAxis={[{ scaleType: 'band', data: labels, tickLabelStyle: { fontSize: 11 } }]}
      yAxis={[{ tickMinStep: 1, tickLabelStyle: { fontSize: 11 } }]}
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
      borderRadius={4}
      margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
      sx={{
        // Recessive hairline grid, and the 2px surface gap between stacked segments.
        '& .MuiChartsGrid-line': { stroke: palette.grid, strokeWidth: 1 },
        '& .MuiChartsAxis-line, & .MuiChartsAxis-tick': { stroke: palette.axis },
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
