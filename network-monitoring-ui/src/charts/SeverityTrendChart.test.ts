import { afterEach, describe, expect, it } from 'vitest';
import { createFormatters } from '../i18n/format';
import type { AlertTrendPoint } from '../types';
import { boundaryBandIndex, bucketLabel } from './SeverityTrendChart';

/**
 * Axis labels, and the timezone they are read in.
 *
 * The API aggregates daily buckets in UTC — it has to, because the trend merges live
 * `alerts` rows with rolled-up days that are keyed by UTC date. That makes each day
 * bucket arrive as a UTC midnight, and a UTC midnight formatted in local time is a
 * *different day* for every viewer west of UTC. The chart was quietly correct only
 * on deployments whose browsers happened to sit on or east of the meridian.
 */

const original = process.env.TZ;

afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

describe('day buckets', () => {
  it('keeps the UTC date west of the meridian', () => {
    // Honolulu is UTC-10, so 2026-09-02T00:00Z is 14:00 on Sep 1 locally. Labelled
    // in local time this bar reads "Sep 1" while holding Sep 2's findings.
    process.env.TZ = 'Pacific/Honolulu';

    expect(bucketLabel('day', '2026-09-02T00:00:00.000Z')).toContain('2');
    expect(bucketLabel('day', '2026-09-02T00:00:00.000Z')).not.toContain('1');
  });

  it('keeps the UTC date east of it too', () => {
    // +14:00: local time is already 14:00 on Sep 2, so this direction was never
    // wrong. Asserted anyway, because a fix that shifted the label the other way
    // would look right in one hemisphere and be wrong in both.
    process.env.TZ = 'Pacific/Kiritimati';

    expect(bucketLabel('day', '2026-09-02T00:00:00.000Z')).toContain('2');
  });

  it('agrees with itself across timezones', () => {
    process.env.TZ = 'Pacific/Honolulu';
    const west = bucketLabel('day', '2026-09-02T00:00:00.000Z');
    process.env.TZ = 'Asia/Kabul';
    const east = bucketLabel('day', '2026-09-02T00:00:00.000Z');

    // The same bucket is the same day everywhere. It is the name of a UTC day, not
    // a moment each viewer experiences differently.
    expect(west).toBe(east);
  });

  it('names the last day of a month without rolling back into it', () => {
    // The boundary where an off-by-one-day label is least forgivable: a month's
    // first bar would otherwise be labelled with the previous month.
    process.env.TZ = 'Pacific/Honolulu';

    expect(bucketLabel('day', '2026-09-01T00:00:00.000Z')).toBe(
      new Date('2026-09-01T00:00:00.000Z').toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    );
  });
});

describe('hour buckets', () => {
  it('shows an instant in the viewer own time', () => {
    /*
     * The opposite convention, deliberately. An hourly bucket is a moment rather
     * than the name of a day, and a viewer asking "when did this happen" means
     * their own clock. 22:00Z is 12:00 in Honolulu, and that is the useful answer.
     */
    process.env.TZ = 'Pacific/Honolulu';

    expect(bucketLabel('hour', '2026-09-02T22:00:00.000Z')).toBe(
      new Date('2026-09-02T22:00:00.000Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('is not silently formatted in UTC', () => {
    // If the day fix were applied to both kinds, an hourly chart would show times
    // nobody in a non-UTC timezone recognises.
    process.env.TZ = 'Pacific/Honolulu';
    const local = bucketLabel('hour', '2026-09-02T22:00:00.000Z');

    expect(local).not.toBe(
      new Date('2026-09-02T22:00:00.000Z').toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }),
    );
  });
});

/**
 * The two coarser buckets, which exist so a multi-year window is readable.
 *
 * Five years at a daily bucket is 1,825 bars in about 800px: a solid block with no
 * legible axis, at exactly the window where a trend is most likely to be real.
 */
describe('week and month buckets', () => {
  it('names a week by the UTC day it starts on', () => {
    // Same hazard as a day bucket, and the same fix: the bucket is a UTC period,
    // so formatting its midnight locally renames it west of the meridian.
    process.env.TZ = 'Pacific/Honolulu';

    // 7 September 2026 is a Monday, which is where date_trunc('week') puts it.
    expect(bucketLabel('week', '2026-09-07T00:00:00.000Z')).toContain('7');
    expect(bucketLabel('week', '2026-09-07T00:00:00.000Z')).not.toContain('6');
  });

  it('names a month without naming a day in it', () => {
    process.env.TZ = 'UTC';
    const label = bucketLabel('month', '2026-09-01T00:00:00.000Z');

    // A month band spans no single day, so a day number in the label would be a
    // claim the bucket does not make — and "1 Sep" beside "1 Oct" reads as daily.
    expect(label).toMatch(/Sep/i);
    expect(label).toContain('2026');
    expect(label).not.toMatch(/\b1\b/);
  });

  it('names a Dari month band by the calendar it was cut in', () => {
    /*
     * `fa-AF` selects the Solar Hijri calendar, deliberately, and for an hour, a
     * day or a week's starting day that is exact — those labels name an instant or
     * a day, which every calendar agrees on.
     *
     * A month label is a claim about the band's extent, and the bucket is
     * `date_trunc('month')`. Labelled Solar Hijri, the 1–31 January band reads
     * `جدی ۱۴۰۴` — roughly 22 December to 20 January — so eleven of its days fall
     * outside the month it is named after, and the next bar's `دلو` asserts a
     * boundary the series does not have.
     */
    process.env.TZ = 'UTC';
    const label = bucketLabel('month', '2026-01-01T00:00:00.000Z', createFormatters('fa-AF'));

    // The Gregorian year the band belongs to, in Dari digits.
    expect(label).toContain('۲۰۲۶');
    // Not the Solar Hijri year, which would name a band that starts in December.
    expect(label).not.toContain('۱۴۰۴');
  });

  it('leaves the other Dari units on the calendar the language reads', () => {
    // Only the month label departs. A day is a day in any calendar, so there is
    // nothing to correct and the reader keeps the calendar they expect: 1 January
    // 2026 is 11 Jadi, and the label says so.
    process.env.TZ = 'UTC';
    const day = bucketLabel('day', '2026-01-01T00:00:00.000Z', createFormatters('fa-AF'));

    expect(day).toContain('جدی');
    expect(day).not.toMatch(/جنو|Jan/);
  });

  it('keeps a month label stable across timezones', () => {
    // The failure this guards is a month bucket rolling back into the previous
    // month for every viewer west of UTC — "Aug" on a bar holding September.
    process.env.TZ = 'Pacific/Honolulu';
    const west = bucketLabel('month', '2026-09-01T00:00:00.000Z');
    process.env.TZ = 'Asia/Kabul';
    const east = bucketLabel('month', '2026-09-01T00:00:00.000Z');

    expect(west).toBe(east);
    expect(west).toMatch(/Sep/i);
  });
});

/**
 * Which band the retention marker lands on.
 *
 * Pure, because a rendered reference line is positioned by an SVG `x` that a DOM
 * test cannot read back: the component test can say a marker is shown, and only
 * this can say which bar it is on. Both bugs in this search were "wrong bar"
 * rather than "no marker", and the first attempt at a gap test asserted the axis
 * label existed — which was true either way.
 */
describe('which band the retention boundary falls in', () => {
  const bars = (...iso: string[]): AlertTrendPoint[] =>
    iso.map((bucket) => ({ bucket, critical: 0, high: 1, medium: 0, low: 0, info: 0 }));

  const DAYS = bars(
    '2026-06-01T00:00:00.000Z',
    '2026-06-02T00:00:00.000Z',
    '2026-06-03T00:00:00.000Z',
    '2026-06-05T00:00:00.000Z',
    '2026-06-06T00:00:00.000Z',
  );

  it('skips a gap rather than absorbing it into the previous bar', () => {
    /*
     * Jun 4 is quiet, so the API sends no bucket for it. Reading a bucket's end
     * off the next PLOTTED one made Jun 3 appear to run until Jun 5, so a boundary
     * at Jun 4 landed on Jun 3 — a bar entirely before the boundary, and so
     * entirely aggregate, under a label saying detail starts there.
     */
    expect(boundaryBandIndex(DAYS, 'day', '2026-06-04T00:00:00.000Z')).toBe(3);
    expect(DAYS[3]?.bucket).toBe('2026-06-05T00:00:00.000Z');
  });

  it('picks the bar the boundary falls inside, not the next one', () => {
    // Mid-way through Jun 2: that bar is part aggregate, part detail, and is where
    // the transition is.
    expect(boundaryBandIndex(DAYS, 'day', '2026-06-02T09:00:00.000Z')).toBe(1);
  });

  it('still finds a boundary inside the newest bar', () => {
    // The -1 case: no bar starts at or after this, but the last one contains it.
    expect(boundaryBandIndex(DAYS, 'day', '2026-06-06T18:00:00.000Z')).toBe(4);
  });

  it('gives the last bar its own width rather than the gap behind it', () => {
    // January and May plotted: inferring the final width from the gap implied a
    // four-month bar, so a boundary in June — past the chart — still matched.
    const months = bars('2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    expect(boundaryBandIndex(months, 'month', '2026-06-20T00:00:00.000Z')).toBeNull();
    // Inside May, which is the last bar, is still found.
    expect(boundaryBandIndex(months, 'month', '2026-05-20T00:00:00.000Z')).toBe(1);
  });

  it('says nothing when the boundary is inside the first bar', () => {
    // Nothing on screen is wholly aggregated, so a line at the left edge would be
    // read as a boundary further back than it is.
    expect(boundaryBandIndex(DAYS, 'day', '2026-06-01T06:00:00.000Z')).toBeNull();
  });

  it('says nothing without a boundary, or without bars', () => {
    expect(boundaryBandIndex(DAYS, 'day', null)).toBeNull();
    expect(boundaryBandIndex([], 'day', '2026-06-04T00:00:00.000Z')).toBeNull();
  });

  it('advances a month by the calendar rather than by 30 days', () => {
    // February is 28 days. A fixed-width month would put the end of the February
    // bar in early March and pick the wrong band around the boundary.
    const months = bars('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    expect(boundaryBandIndex(months, 'month', '2026-02-27T00:00:00.000Z')).toBe(1);
    expect(boundaryBandIndex(months, 'month', '2026-03-02T00:00:00.000Z')).toBeNull();
  });
});
