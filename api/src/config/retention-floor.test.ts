import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * The retention floor.
 *
 * `ALERT_RETENTION_DAYS=1` is a plausible typo for 10 or 100, and honouring it would
 * delete very nearly every finding on the next sweep — irreversibly, because the
 * rollup preserves counts and not rows. There is no undo for this one, so the floor
 * is the difference between a slipped digit costing a day of noise and costing a
 * year of history.
 *
 * In its own file because `env.ts` reads `process.env` once at import: the value
 * under test has to be set before that happens, and a second suite in the same
 * process could not then set a different one.
 */

let env: typeof import('./env.js')['env'];
const warnings: string[] = [];

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  // Well below the floor, and below it by a factor that a fat-fingered edit would
  // plausibly produce.
  process.env.ALERT_RETENTION_DAYS = '1';
  // A legitimate short window, to be sure the floor is a floor and not a fixed value.
  process.env.DEVICE_RETENTION_DAYS = '30';
  // A monthly sweep: over what a JavaScript timer can express, and the failure mode
  // is the opposite of what was asked for.
  process.env.RETENTION_SWEEP_HOURS = '720';

  // Captured rather than silenced: a clamp that happens quietly is its own bug, so
  // the warning is part of the behaviour being asserted.
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  ({ env } = await import('./env.js'));
  console.warn = original;
});

describe('retention floor', () => {
  it('clamps a window below the minimum instead of honouring it', () => {
    assert.equal(env.retention.alertDays, 7);
  });

  it('says so, loudly, naming the variable and the value', () => {
    // Silently correcting configuration is how an operator ends up believing a
    // setting applies when it does not — the failure this codebase keeps finding.
    // The variable's name is in the message because that is what they can search
    // for; the field key would be useless to them.
    const warning = warnings.find((line) => line.includes('ALERT_RETENTION_DAYS'));
    assert.ok(warning, `no warning mentioned ALERT_RETENTION_DAYS: ${JSON.stringify(warnings)}`);
    assert.match(warning, /=1/);
    assert.match(warning, /7-day minimum/);
    // And it names the actual alternative, rather than leaving them to guess that
    // "keep everything" is even possible.
    assert.match(warning, /RETENTION_ENABLED=false/);
  });

  it('leaves a short but legitimate window alone', () => {
    // 30 days is a real choice for a noisy lab. A floor that quietly became a
    // default would take that away.
    assert.equal(env.retention.deviceDays, 30);
  });

  it('clamps a sweep interval past what a timer can express', () => {
    /*
     * `setInterval` takes a signed 32-bit delay. 720 hours is 2,592,000,000 ms,
     * which Node does not reject and does not throw on — it warns and uses **1 ms**,
     * so the operator who asked for a monthly sweep gets a continuous one hammering
     * the database. Inverting a setting into its own opposite is the worst of the
     * three ways this could go wrong.
     */
    assert.equal(env.retention.sweepHours, 596);
    // 596 hours is the largest whole number of hours that fits.
    assert.ok(596 * 3_600_000 <= 2_147_483_647);
    assert.ok(597 * 3_600_000 > 2_147_483_647);
  });

  it('says so, naming the variable and what it is now doing', () => {
    const warning = warnings.find((line) => line.includes('RETENTION_SWEEP_HOURS'));
    assert.ok(warning, `no warning mentioned RETENTION_SWEEP_HOURS: ${JSON.stringify(warnings)}`);
    assert.match(warning, /=720/);
    assert.match(warning, /596/);
  });

  it('does not warn about the value it accepted', () => {
    assert.equal(
      warnings.filter((line) => line.includes('DEVICE_RETENTION_DAYS')).length,
      0,
      'warned about a value that was within the limit',
    );
  });
});
