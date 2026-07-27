import { useColorScheme } from '@mui/material/styles';
import { useMemo } from 'react';
import { type ChartPalette, chartPalette } from './palette';

/**
 * The chart palette for whichever colour scheme is active.
 *
 * Dark-mode chart colours are chosen and validated separately rather than
 * derived by flipping the light ones — an automatic inversion lands outside the
 * lightness band for the dark surface.
 */
export function useChartPalette(): ChartPalette {
  const { mode, systemMode } = useColorScheme();
  // `mode` is 'system' until the user picks explicitly.
  const resolved = mode === 'system' ? systemMode : mode;
  return useMemo(() => chartPalette(resolved === 'dark' ? 'dark' : 'light'), [resolved]);
}
