import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADHOC_FIELDS,
  adhocPinnedConflicts,
  adhocPinnedFields,
  effectiveAdhocSettings,
  resolveAdhocSettings,
} from './adhoc-settings.js';

/**
 * The query console's three layers.
 *
 * `env.ts` argues that a SQL prompt on the production database should be an
 * installation's decision rather than a click in a browser session, and these
 * settings are editable anyway — so the rule that keeps both true is the one
 * under test here. **The environment wins.** A deployment that pins
 * `ADHOC_ENABLED=false` cannot be contradicted by a row, and the decision to
 * have the capability at all stays with whoever sets `ADHOC_DB_PASSWORD`, which
 * is deliberately not one of these fields.
 *
 * Pure functions, so no database: the resolver is handed an environment and a
 * row and asked what applies.
 */

/** What applies, given these two layers. */
const effective = (env: Record<string, string | undefined>, stored: Record<string, unknown> = {}) =>
  effectiveAdhocSettings(resolveAdhocSettings(env, stored));

const sourceOf = (
  env: Record<string, string | undefined>,
  stored: Record<string, unknown>,
  field: 'enabled' | 'audit' | 'maxRows',
) => resolveAdhocSettings(env, stored)[field].source;

describe('the environment wins', () => {
  it('leaves the console off when nobody has asked for it', () => {
    // The default, and the reason it is the default: a console nobody decided to
    // have is a SQL prompt nobody decided to have.
    const settings = effective({});

    assert.equal(settings.enabled, false);
    assert.equal(settings.writeEnabled, false);
    assert.equal(sourceOf({}, {}, 'enabled'), 'default');
  });

  it('honours a stored row when the environment is silent', () => {
    // The whole point of the feature: an administrator turning it on without
    // editing a file they may not have access to.
    assert.equal(effective({}, { enabled: true }).enabled, true);
    assert.equal(sourceOf({}, { enabled: true }, 'enabled'), 'database');
  });

  it('refuses to let a row contradict the environment', () => {
    /*
     * The assertion the design rests on. A deployment that pins the console off
     * in its Compose file must not be switchable on from a browser — otherwise
     * "the environment wins" is a comment rather than a property, and an
     * administrator session becomes a way to obtain SQL on the production
     * database.
     */
    const env = { ADHOC_ENABLED: 'false' };

    assert.equal(effective(env, { enabled: true }).enabled, false);
    assert.equal(sourceOf(env, { enabled: true }, 'enabled'), 'environment');
    assert.deepEqual(adhocPinnedFields(resolveAdhocSettings(env, { enabled: true })), ['enabled']);
  });

  it('treats a blank variable as undecided rather than as false', () => {
    // `ADHOC_ENABLED=` left in a file is somebody who has not chosen, which is
    // how env.ts reads a blank everywhere else. Reading it as `false` would pin
    // the field and make the interface inert for no reason anybody stated.
    const env = { ADHOC_ENABLED: '  ' };

    assert.equal(effective(env, { enabled: true }).enabled, true);
    assert.equal(sourceOf(env, { enabled: true }, 'enabled'), 'database');
  });

  it('names the variable, not the field key, when a patch hits a pinned field', () => {
    // What an operator can grep for. The delivery settings' own 409 named the
    // internal key and helped nobody.
    const resolution = resolveAdhocSettings({ ADHOC_WRITE_ENABLED: 'false' }, {});

    assert.deepEqual(adhocPinnedConflicts(resolution, { writeEnabled: true }), ['ADHOC_WRITE_ENABLED']);
    // And says nothing about a field the patch does not touch.
    assert.deepEqual(adhocPinnedConflicts(resolution, { maxRows: 10 }), []);
  });
});

describe('write mode and the audit trail', () => {
  it('forces auditing to all while writes are allowed', () => {
    /*
     * The one combination this feature must not offer: a console that can DELETE
     * and a trail that records none of it. It was previously unreachable only
     * because both flags came from the environment and an operator would have had
     * to set them together deliberately. Now that either can be set in a browser,
     * the rule has to live where both are read.
     */
    const settings = effective({}, { enabled: true, writeEnabled: true, audit: 'off' });

    assert.equal(settings.writeEnabled, true);
    assert.equal(settings.audit, 'all');
  });

  it('leaves auditing alone when the console can only read', () => {
    // The rule is about write mode, not about auditing in general: an operator
    // who wants a quieter trail on a read-only console may still have one.
    assert.equal(effective({}, { enabled: true, audit: 'off' }).audit, 'off');
  });

  it('cannot be bypassed by pinning audit in the environment', () => {
    // The environment wins everywhere else, and here it must not: `ADHOC_AUDIT=off`
    // with writes on is exactly the combination the rule exists to refuse, and a
    // resolver that let the pin through would offer it.
    const settings = effective({ ADHOC_AUDIT: 'off' }, { enabled: true, writeEnabled: true });

    assert.equal(settings.audit, 'all');
  });
});

describe('values a layer offers but the table would refuse', () => {
  it('falls through rather than clamping an out-of-range number', () => {
    // Clamping would mean the interface reporting success for a value the
    // database never stored, and the two then disagreeing about what applies.
    // The bounds here are V14's CHECK constraints.
    assert.equal(effective({}, { maxRows: 999_999 }).maxRows, 1000);
    assert.equal(sourceOf({}, { maxRows: 999_999 }, 'maxRows'), 'default');
  });

  it('falls through on a number that is not one', () => {
    assert.equal(effective({ ADHOC_MAX_ROWS: 'lots' }).maxRows, 1000);
    assert.equal(effective({ ADHOC_TIMEOUT_MS: '1.5' }).timeoutMs, 10_000);
  });

  it('falls through on an audit mode nobody implemented', () => {
    assert.equal(effective({ ADHOC_AUDIT: 'verbose' }).audit, 'all');
    assert.equal(sourceOf({ ADHOC_AUDIT: 'verbose' }, {}, 'audit'), 'default');
  });

  it('accepts the spellings of a boolean an operator actually writes', () => {
    for (const yes of ['true', 'TRUE', '1', 'yes', 'on']) {
      assert.equal(effective({ ADHOC_ENABLED: yes }).enabled, true, yes);
    }
    for (const no of ['false', '0', 'no', 'off']) {
      assert.equal(effective({ ADHOC_ENABLED: no }).enabled, false, no);
    }
  });
});

describe('the password', () => {
  it('is not one of these fields', () => {
    /*
     * Guarding the design rather than the code. Without a password the console
     * cannot start whatever these settings say, which is what keeps the decision
     * to *have* a SQL prompt with whoever installed the server. Adding it here
     * would be the obvious next "improvement" and is the one thing this registry
     * must not grow — so the absence is asserted rather than left to a comment.
     */
    const fields = Object.keys(ADHOC_FIELDS);

    assert.ok(!fields.some((field) => /password/i.test(field)), `a password field appeared: ${fields}`);

    /*
     * Widened to string[] on purpose. `ADHOC_FIELDS` is `as const`, so the union
     * of variable names does not include this one and `tsc` rejects the
     * comparison outright — the check is enforced at compile time before it is
     * ever run here. Keeping the runtime assertion anyway, because the compiler's
     * refusal is a type error somebody could silence with a cast, and this one
     * fails the suite instead.
     */
    const variables: string[] = Object.values(ADHOC_FIELDS).map((spec) => spec.env);
    assert.ok(!variables.includes('ADHOC_DB_PASSWORD'), `ADHOC_DB_PASSWORD became editable: ${variables}`);
  });
});
