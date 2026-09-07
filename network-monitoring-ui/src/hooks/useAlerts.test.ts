import { describe, expect, it } from 'vitest';
import { distinctMacCount } from './useAlerts';

/**
 * The device count behind the dashboard's "Known devices" tile.
 *
 * Worth a test of its own because the obvious implementation is wrong in exactly
 * the deployments this feature exists for. `known_devices` is keyed on
 * (sensor, MAC) since V16, so `rows.length` counts sightings rather than machines
 * — and the tile's caption says "MAC addresses seen". On an installation whose
 * sensors have overlapping coverage, which is the interesting case, the row count
 * is inflated by precisely the overlap.
 */
describe('distinctMacCount', () => {
  it('counts one machine once, however many sensors have seen it', () => {
    const rows = [
      { macAddress: 'aa:bb:cc:dd:ee:ff' },
      { macAddress: 'aa:bb:cc:dd:ee:ff' },
      { macAddress: '11:22:33:44:55:66' },
    ];

    // Three rows, two machines. `rows.length` would say three.
    expect(distinctMacCount(rows)).toBe(2);
  });

  it('is zero for no rows, rather than throwing on the empty case', () => {
    expect(distinctMacCount([])).toBe(0);
  });
});
