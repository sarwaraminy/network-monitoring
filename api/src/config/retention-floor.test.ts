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

  it('does not warn about the value it accepted', () => {
    assert.equal(
      warnings.filter((line) => line.includes('DEVICE_RETENTION_DAYS')).length,
      0,
      'warned about a value that was within the limit',
    );
  });
});
