import { describe, expect, it } from 'vitest';
import type { Severity } from '../types';
import { chartPalette, SEVERITY_ORDER } from './palette';

/**
 * Guards the chart palette.
 *
 * Every colour in palette.ts was checked with the data-viz validator against this
 * app's own surfaces. These tests pin the properties that validation depends on, so
 * a casual "make the red brighter" edit fails here rather than silently producing a
 * ramp that no longer reads as ordered.
 *
 * Re-run the validator, don't just update the expectations, if a value changes.
 */

/** Relative luminance per WCAG, used for both the ordering and contrast checks. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('chart palette', () => {
  it('covers every severity in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = chartPalette(mode);
      for (const severity of SEVERITY_ORDER) {
        expect(palette.severity[severity], `${mode}/${severity}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('steps monotonically by severity, so the ramp reads as ordered', () => {
    // Light surface: more severe = darker. Dark surface: more severe = lighter.
    const light = chartPalette('light');
    const lightLuminance = SEVERITY_ORDER.map((s) => luminance(light.severity[s]));
    for (let i = 1; i < lightLuminance.length; i += 1) {
      expect(lightLuminance[i]!, `light ${SEVERITY_ORDER[i]} vs ${SEVERITY_ORDER[i - 1]}`).toBeGreaterThan(
        lightLuminance[i - 1]!,
      );
    }

    const dark = chartPalette('dark');
    const darkLuminance = SEVERITY_ORDER.map((s) => luminance(dark.severity[s]));
    for (let i = 1; i < darkLuminance.length; i += 1) {
      expect(darkLuminance[i]!, `dark ${SEVERITY_ORDER[i]} vs ${SEVERITY_ORDER[i - 1]}`).toBeLessThan(
        darkLuminance[i - 1]!,
      );
    }
  });

  it('keeps the surface-nearest severity step above the 2:1 ordinal floor', () => {
    // The step closest to the surface is the one that risks disappearing into it.
    const light = chartPalette('light');
    expect(contrast(light.severity.info, light.surface)).toBeGreaterThanOrEqual(2);

    const dark = chartPalette('dark');
    expect(contrast(dark.severity.info, dark.surface)).toBeGreaterThanOrEqual(2);
  });

  it('keeps the single-series bar hue above 3:1 against its surface', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = chartPalette(mode);
      expect(contrast(palette.bar, palette.surface), mode).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses different values per mode rather than reusing one set', () => {
    // An automatic light/dark flip lands outside the dark lightness band, which is
    // why each mode has its own validated steps.
    const light = chartPalette('light');
    const dark = chartPalette('dark');
    expect(dark.bar).not.toBe(light.bar);
    for (const severity of SEVERITY_ORDER) {
      expect(dark.severity[severity], severity).not.toBe(light.severity[severity]);
    }
  });

  it('orders severities most-severe first', () => {
    expect(SEVERITY_ORDER).toEqual<Severity[]>(['critical', 'high', 'medium', 'low', 'info']);
  });

  it('keeps grid and axis chrome recessive against the surface', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = chartPalette(mode);
      // Chrome must be visible but never compete with the data.
      expect(contrast(palette.grid, palette.surface), `${mode} grid`).toBeLessThan(3);
    }
  });
});
