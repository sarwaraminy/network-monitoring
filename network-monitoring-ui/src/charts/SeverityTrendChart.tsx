import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { useMemo } from 'react';
import { createFormatters, type Formatters, useFormatters } from '../i18n/format';
import { DEFAULT_LOCALE } from '../i18n/generated/locales';
import type { AlertTrendPoint } from '../types';
import { SEVERITY_LABEL, SEVERITY_ORDER } from './palette';
import { useChartPalette } from './useChartPalette';

/**
 * How one bucket is named on the axis.
 *
 * Exported because the timezone question here has one right answer per bucket kind
 * and it is not obvious which:
 *
 *  - An **hourly** bucket is an instant, and an instant belongs in the viewer's own
 *    time. 22:00Z happened to them at whatever their clock said.
 *  - A **daily** bucket is not an instant, it is the name of a UTC day. The API
 *    aggregates days in UTC so that live rows out of `alerts` and rolled-up days out
 *    of `alert_rollup_daily` can be merged into one series, and formatting that
 *    midnight in local time renames it: anywhere west of UTC, every bar would carry
 *    the previous day's date.
 */
export function bucketLabel(
  bucket: 'hour' | 'day',
  iso: string,
  format: Formatters = createFormatters(DEFAULT_LOCALE),
): string {
  // The formatter is a parameter with a default rather than a hook call, because
  // this is also the axis' `valueFormatter` — called by the chart outside React's
  // render, where a hook cannot go. The default keeps the existing unit tests
  // calling it with two arguments.
  return bucket === 'hour' ? format.time(iso) : format.day(iso);
}

interface Props {
  trend: AlertTrendPoint[];
  bucket: 'hour' | 'day';
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
export default function SeverityTrendChart({ trend, bucket, height = 260 }: Readonly<Props>) {
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

  if (trend.length === 0) {
    return <EmptyPlot height={height} message="No findings in this period." />;
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
              label: SEVERITY_LABEL[severity],
              stack: 'severity',
              color: palette.severity[severity],
            }))
          : [{ data: trend.map(() => 0), label: 'No findings', color: palette.grid }]
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
    />
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
