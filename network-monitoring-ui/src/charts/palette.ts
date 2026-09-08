import type { Severity } from '../types';

/**
 * Chart colours, and why these exact values.
 *
 * Severity is an **ordinal** scale — every level is bad, they differ only in
 * degree — so it gets a single-hue red ramp with monotone lightness rather than
 * five unrelated hues. The earlier attempt used one status colour per level and
 * failed validation: status-yellow and status-orange sit ΔE 13.6 apart in normal
 * vision, below the 15 floor, so those two segments would have been
 * indistinguishable where they touch in a stacked column.
 *
 * Magnitude charts (findings per detector, per source) are a single series, so
 * they take one hue and no legend.
 *
 * Every value below was checked with the data-viz validator against this app's
 * own surfaces — `#ffffff` light, `#111a2b` dark — not against a default:
 *   - severity ramp, both modes: monotone lightness, adjacent ΔL ≥ 0.06,
 *     surface-end contrast ≥ 2:1, single hue. All checks pass.
 *   - bar hue, both modes: inside the lightness band, chroma floor,
 *     contrast ≥ 3:1. All checks pass.
 *
 * If you change a value here, re-run the validator rather than eyeballing it.
 */

export interface ChartPalette {
  /** Ordinal severity ramp: more severe = further from the surface. */
  severity: Record<Severity, string>;
  /** Single hue for one-series magnitude charts. */
  bar: string;
  /** Recessive chrome. */
  grid: string;
  axis: string;
  /** Surface colour, used for the 2px gaps that separate touching marks. */
  surface: string;
}

const LIGHT: ChartPalette = {
  severity: {
    critical: '#851212',
    high: '#b51b1b',
    medium: '#dd3b3b',
    low: '#f06060',
    info: '#f98a8a',
  },
  bar: '#2a78d6',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#ffffff',
};

const DARK: ChartPalette = {
  severity: {
    // Inverted direction: on a dark surface, more severe means lighter, so the
    // worst level is still the most prominent.
    critical: '#fbb2b2',
    high: '#f48585',
    medium: '#e65555',
    low: '#c73636',
    info: '#a32c2c',
  },
  bar: '#5b8def',
  grid: '#2c2c2a',
  axis: '#383835',
  surface: '#111a2b',
};

export function chartPalette(mode: 'light' | 'dark'): ChartPalette {
  return mode === 'dark' ? DARK : LIGHT;
}

/** Severities in ordinal order, most severe first. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/*
 * There is no SEVERITY_LABEL here any more.
 *
 * It held the same five words as `SEVERITY_STYLE[…].labelKey` in
 * components/SeverityChip.tsx, and only that one went through the translation
 * pass — so the trend chart's legend read "Critical/High/…" beside tiles and
 * chips showing "Kritisch/Hoch/…", from the same data on the same screen. Two
 * spellings of one list is what let them diverge; the chart reads the keyed one
 * now.
 */
