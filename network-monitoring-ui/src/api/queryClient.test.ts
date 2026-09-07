import { describe, expect, it } from 'vitest';
import { ALL_SENSORS, queryKeys } from './queryClient';

/**
 * The sensor segment of a cache key cannot be mistaken for a sensor.
 *
 * React Query serves a cached entry to whoever asks with the same key, which is
 * exactly right and exactly why an ambiguous key is a data-correctness bug rather
 * than a tidiness one. The sentinel standing for "every sensor" used to be the
 * string `all`, which is a perfectly legal sensor id — so an installation with a
 * sensor named `all` had one key for two different questions, and the unfiltered
 * view and that sensor's view served each other's numbers out of cache with no
 * refetch and nothing on screen to suggest it.
 *
 * The property that makes the fix hold is not "nobody would call a sensor that".
 * It is that the sentinel cannot satisfy the id rule at all.
 */

/**
 * The first character of a sensor id, per `SENSOR_ID_PATTERN` in the API's
 * `constants.ts` — `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`. Restated rather than imported
 * because the API is a separate package; the assertion below is what keeps the two
 * from drifting into agreement by accident.
 */
const ID_STARTS_WITH = /^[A-Za-z0-9]/;

describe('sensor cache keys', () => {
  it('uses a sentinel no sensor id can equal', () => {
    expect(ALL_SENSORS).not.toMatch(ID_STARTS_WITH);
    // The one that was wrong, named so the regression reads as itself.
    expect(ALL_SENSORS).not.toBe('all');
  });

  it('gives a named sensor and the unfiltered view different keys', () => {
    expect(queryKeys.alertSummary('branch-office')).not.toEqual(queryKeys.alertSummary());
    expect(queryKeys.knownDevices('branch-office')).not.toEqual(queryKeys.knownDevices());
  });

  it('does not collide for a sensor named after the sentinel it replaced', () => {
    // The bug, as a test: `all` is a plausible name for an aggregating collector,
    // and nothing in the product rejects it.
    expect(queryKeys.alertSummary('all')).not.toEqual(queryKeys.alertSummary());
    expect(queryKeys.knownDevices('all')).not.toEqual(queryKeys.knownDevices());
  });

  it('keys the same sensor the same way twice', () => {
    // The other direction: a sentinel that collided with nothing would also be
    // useless if it were not stable.
    expect(queryKeys.alertSummary('branch-office')).toEqual(queryKeys.alertSummary('branch-office'));
    expect(queryKeys.alertSummary()).toEqual(queryKeys.alertSummary(undefined));
  });
});
