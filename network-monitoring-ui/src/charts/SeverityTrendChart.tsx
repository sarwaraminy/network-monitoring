import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { useMemo } from 'react';
import type { AlertTrendPoint } from '../types';
import { SEVERITY_LABEL, SEVERITY_ORDER } from './palette';
import { useChartPalette } from './useChartPalette';

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
export default function SeverityTrendChart({ trend, bucket, height = 260 }: Props) {
  const palette = useChartPalette();

  const labels = useMemo(
    () =>
      trend.map((point) => {
        const date = new Date(point.bucket);
        return bucket === 'hour'
          ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }),
    [trend, bucket],
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

function EmptyPlot({ height, message }: { height: number; message: string }) {
  return (
    <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {message}
      </Typography>
    </Box>
  );
}
