import { afterEach, describe, expect, it } from 'vitest';
import { bucketLabel } from './SeverityTrendChart';

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
