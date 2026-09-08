import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { useFormatters } from '../i18n/format';
import { useChartPalette } from './useChartPalette';

export interface MagnitudeDatum {
  label: string;
  value: number;
  /** Shown in the tooltip alongside the value. */
  detail?: string;
}

interface Props {
  data: MagnitudeDatum[];
  height?: number;
  /** Names the quantity, since a single-series chart carries no legend. */
  valueLabel: string;
  emptyMessage?: string;
  /**
   * True when the category labels are technical identifiers — IP addresses,
   * detector kinds — rather than prose.
   *
   * They then keep their own direction inside a right-to-left layout. SVG text is
   * subject to the bidirectional algorithm exactly as HTML is, and this axis is
   * the one place identifiers are rendered where `Identifier` cannot reach: a tick
   * label is a string handed to the chart, not an element this application
   * renders. `192.168.1.10` reordered on an axis is the same bug as `192.168.1.10`
   * reordered in a sentence.
   */
  labelsAreIdentifiers?: boolean;
}

/** Room reserved for category labels, so none of them is clipped. */
const CATEGORY_AXIS_MIN_WIDTH = 84;
const CATEGORY_AXIS_MAX_WIDTH = 190;
/** Rough width of one character at the 11px tick size. */
const APPROX_CHAR_WIDTH = 6.4;

/**
 * Horizontal bars for "compare magnitude, low → high".
 *
 * Horizontal because the category names are long (detector names, IP addresses) —
 * vertical columns would force rotated tick labels.
 *
 * One series, so: one hue, no legend box (the card title already says what is
 * plotted), and the value direct-labelled at the bar tip so the reader does not
 * have to trace back to an axis.
 */
export default function MagnitudeBarChart({
  data,
  height = 260,
  valueLabel,
  emptyMessage = 'Nothing to show yet.',
  labelsAreIdentifiers = false,
}: Props) {
  const palette = useChartPalette();
  const fmt = useFormatters();

  if (data.length === 0) {
    return (
      <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  // Largest at the top: a magnitude ranking should read from its extreme.
  const sorted = [...data].sort((a, b) => a.value - b.value);

  // Measure before reserving: category names here run from "SYN flood" to
  // "Cleartext credentials" to a full IPv6 address, and the default axis width
  // clipped the longer ones to "Cleart…". A clipped label is worse than a short
  // chart, so the axis is sized to the longest string it has to show.
  const longestLabel = sorted.reduce((longest, d) => Math.max(longest, d.label.length), 0);
  const categoryAxisWidth = Math.min(
    CATEGORY_AXIS_MAX_WIDTH,
    Math.max(CATEGORY_AXIS_MIN_WIDTH, Math.ceil(longestLabel * APPROX_CHAR_WIDTH) + 12),
  );

  return (
    <BarChart
      height={height}
      layout="horizontal"
      yAxis={[
        {
          scaleType: 'band',
          data: sorted.map((d) => d.label),
          tickLabelStyle: {
            fontSize: 11,
            ...(labelsAreIdentifiers ? { direction: 'ltr', unicodeBidi: 'isolate' } : {}),
          },
          width: categoryAxisWidth,
        },
      ]}
      xAxis={[{ tickMinStep: 1, tickLabelStyle: { fontSize: 11 } }]}
      series={[
        {
          data: sorted.map((d) => d.value),
          label: valueLabel,
          color: palette.bar,
          // Direct label at the bar tip, so the value is readable without
          // tracing back to the axis. Zero is left unlabelled rather than
          // printing a "0" that adds nothing.
          barLabel: (item) => (item.value ? fmt.number(item.value) : null),
          barLabelPlacement: 'outside',
          valueFormatter: (value, context) => {
            const datum = sorted[context.dataIndex];
            return datum?.detail ? `${value} (${datum.detail})` : String(value);
          },
        },
      ]}
      // Single series: the card heading names it, so a one-swatch legend would
      // only restate the title.
      hideLegend
      grid={{ vertical: true }}
      borderRadius={4}
      margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
      sx={{
        '& .MuiChartsGrid-line': { stroke: palette.grid, strokeWidth: 1 },
        '& .MuiChartsAxis-line, & .MuiChartsAxis-tick': { stroke: palette.axis },
        // Direct labels wear a text token, never the series colour.
        '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 11 },
      }}
    />
  );
}
