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

  it('is not fooled by a quiet period leaving a gap in the series', async () => {
    /*
     * The API emits no bucket for a period with no findings, so consecutive
     * entries in `trend` are not consecutive in time. Reading a bucket's end off
     * the NEXT PLOTTED one therefore absorbs the gap into its predecessor: daily
     * bars for Jun 1, 2, 3, 5, 6 with the boundary at Jun 4 put the line on Jun 3
     * — a bar entirely before the boundary, so entirely aggregate, under a label
     * saying detail begins there.
     *
     * Every other fixture in this file is contiguous, which is why the first
     * version of `endOfBucket` passed.
     */
    const withGap: AlertTrendPoint[] = [
      '2026-06-01T00:00:00.000Z',
      '2026-06-02T00:00:00.000Z',
      '2026-06-03T00:00:00.000Z',
      // Jun 4 is quiet, so the API sends nothing for it.
      '2026-06-05T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
    ].map((bucket) => ({ bucket, critical: 0, high: 1, medium: 0, low: 0, info: 0 }));

    renderApp(<SeverityTrendChart trend={withGap} bucket="day" rolledUpBefore="2026-06-04T00:00:00.000Z" />);

    /*
     * Only that a marker is drawn at all. WHICH bar it lands on is what the gap
     * broke, and a reference line is positioned by an SVG `x` this cannot read
     * back — the first version of this case asserted the axis label `Jun 5`
     * existed, which was true whether or not the line was on it.
     *
     * `boundaryBandIndex` is exported for that reason and pinned in
     * SeverityTrendChart.test.ts, where the band is an index and can be asserted.
     */
    expect(await screen.findByText(MARKER)).toBeInTheDocument();
  });

  it('does not stretch the last bucket to cover a boundary past the chart', async () => {
    /*
     * The last bucket has no next neighbour, so its width used to be inferred from
     * the gap to its predecessor. Bars for January and May implied a four-month
     * final bucket, and a boundary in June — genuinely past everything plotted —
     * still satisfied "ends after the boundary" and drew a marker.
     */
    const sparse: AlertTrendPoint[] = ['2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'].map(
      (bucket) => ({ bucket, critical: 0, high: 1, medium: 0, low: 0, info: 0 }),
    );

    renderApp(<SeverityTrendChart trend={sparse} bucket="month" rolledUpBefore="2026-06-20T00:00:00.000Z" />);

    expect(await screen.findByText('May 2026')).toBeInTheDocument();
    expect(screen.queryByText(MARKER)).not.toBeInTheDocument();
  });

  it('says nothing when the API reports no crossover', async () => {
    // `rolledUpBefore: null` — an hourly window, a window that does not reach the
    // cutoff, or an install that has never rolled anything up.
    renderApp(<SeverityTrendChart trend={MONTHS} bucket="month" rolledUpBefore={null} />);

    expect(screen.queryByText(MARKER)).not.toBeInTheDocument();
  });
});
