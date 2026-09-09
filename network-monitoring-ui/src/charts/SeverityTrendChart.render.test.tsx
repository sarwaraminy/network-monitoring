import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/render';
import type { AlertTrendPoint } from '../types';
import SeverityTrendChart from './SeverityTrendChart';

/**
 * The retention marker, rendered.
 *
 * This file exists because the marker had no coverage at all. `SeverityTrendChart.test.ts`
 * is a `.ts` file testing `bucketLabel` as a pure function, there is no
 * `DashboardPage` test, and the MSW fixture returns `rolledUpBefore: null` — so
 * the whole `<ChartsReferenceLine>` could be deleted and all 328 UI tests still
 * passed. It was the feature the pull request is named for and the one part
 * nothing checked, which is how an off-by-one in the band search survived a round
 * of review.
 *
 * The band search is what these cases are about. `point.bucket` is a bucket
 * START and `rolledUpBefore` is an instant inside one, so "first bucket starting
 * at or after the boundary" misses whenever the boundary falls inside the newest
 * bucket — and any retention window shorter than the bucket width does that.
 */

const MONTHS: AlertTrendPoint[] = [
  '2026-05-01T00:00:00.000Z',
  '2026-06-01T00:00:00.000Z',
  '2026-07-01T00:00:00.000Z',
  '2026-08-01T00:00:00.000Z',
].map((bucket) => ({ bucket, critical: 0, high: 2, medium: 1, low: 0, info: 0 }));

/** The label the marker carries, from the English catalogue. */
const MARKER = 'Detail kept from here';

describe('the retention marker', () => {
  it('marks the bucket the boundary falls inside', async () => {
    renderApp(
      <SeverityTrendChart
        trend={MONTHS}
        bucket="month"
        // Mid-July: detail begins part-way through the third bar.
        rolledUpBefore="2026-07-16T00:00:00.000Z"
      />,
    );

    expect(await screen.findByText(MARKER)).toBeInTheDocument();
  });

  it('still marks a boundary inside the NEWEST bucket', async () => {
    /*
     * The case that was broken. With `ALERT_RETENTION_DAYS` shorter than the
     * bucket width the boundary lands in the last band — no bucket starts at or
     * after it, so the old search returned -1 and the line disappeared while
     * essentially every bar on screen was an aggregate.
     */
    renderApp(<SeverityTrendChart trend={MONTHS} bucket="month" rolledUpBefore="2026-08-20T00:00:00.000Z" />);

    expect(await screen.findByText(MARKER)).toBeInTheDocument();
  });

  it('says nothing when no bucket on screen is aggregated', async () => {
    // The boundary sits inside the FIRST band, so there is nothing to its left to
    // divide off. A line at the edge would be read as a boundary further back.
    renderApp(<SeverityTrendChart trend={MONTHS} bucket="month" rolledUpBefore="2026-05-02T00:00:00.000Z" />);

    // The chart itself rendered — otherwise "no marker" would be trivially true of
    // a component that drew nothing at all.
    expect(await screen.findByText('May 2026')).toBeInTheDocument();
    expect(screen.queryByText(MARKER)).not.toBeInTheDocument();
  });

  it('says nothing when the boundary is newer than everything plotted', async () => {
    // Genuinely off-screen, in the future of the newest band's end.
    renderApp(<SeverityTrendChart trend={MONTHS} bucket="month" rolledUpBefore="2026-11-01T00:00:00.000Z" />);

    expect(screen.queryByText(MARKER)).not.toBeInTheDocument();
  });

  it('says nothing when the API reports no crossover', async () => {
    // `rolledUpBefore: null` — an hourly window, a window that does not reach the
    // cutoff, or an install that has never rolled anything up.
    renderApp(<SeverityTrendChart trend={MONTHS} bucket="month" rolledUpBefore={null} />);

    expect(screen.queryByText(MARKER)).not.toBeInTheDocument();
  });
});
