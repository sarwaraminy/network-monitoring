import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DELIVERY_DEFAULTS,
  DELIVERY_FIELDS,
  type DeliveryField,
  effectiveSettings,
  environmentPinnedFields,
  invalidEnvironmentVariables,
  isSecretField,
  parseFieldValue,
  pinnedConflicts,
  redactForApi,
  resolveDeliverySettings,
} from './settings.js';

/**
 * Delivery settings resolution.
 *
 * Three properties carry the whole design, and each has a way of failing quietly:
 *
 *  1. **The environment wins.** A deployment pinned by Compose or config management
 *     must not be contradicted by a web form, or the file says one thing, the process
 *     does another, and the next redeploy reverts whatever was changed in the UI.
 *  2. **A pinned field is reported as pinned.** The obligation that follows from (1):
 *     a form control that accepts an edit and changes nothing is the failure this
 *     codebase keeps finding, so provenance is part of the contract rather than
 *     something the page infers.
 *  3. **Secrets never come back out.** The webhook URL is a bearer credential for
 *     Slack and Teams and the SMTP password is a password. `/api/notify/status` has
 *     never returned the URL; that has to survive the settings becoming editable.
 *
 * Plus one rule inherited rather than chosen: a variable that is present but BLANK
 * counts as unset, because env.ts's own `optional`, `int` and `bool` all fall back on
 * `raw.trim() === ''`. Two layers disagreeing about what an empty variable means is
 * the drift `env-defaults.test.ts` exists to catch, so the agreement is asserted here
 * rather than assumed.
 */

const NO_ENV: Record<string, string | undefined> = {};

describe('delivery settings resolution', () => {
  describe('the environment wins', () => {
    it('takes an environment value over a stored one', () => {
      const resolved = resolveDeliverySettings({ NOTIFY_MAX_PER_HOUR: '5' }, { maxPerHour: 99 });
      assert.equal(resolved.maxPerHour.value, 5);
      assert.equal(resolved.maxPerHour.source, 'environment');
    });

    it('takes a stored value over the default', () => {
      const resolved = resolveDeliverySettings(NO_ENV, { maxPerHour: 99 });
      assert.equal(resolved.maxPerHour.value, 99);
      assert.equal(resolved.maxPerHour.source, 'database');
    });

    it('falls back to the default when neither is set', () => {
      const resolved = resolveDeliverySettings(NO_ENV, {});
      assert.equal(resolved.maxPerHour.value, DELIVERY_DEFAULTS.maxPerHour);
      assert.equal(resolved.maxPerHour.source, 'default');
    });

    it('treats a blank variable as unset, exactly like env.ts', () => {
      // Not a free choice. env.ts's optional/int/bool all return their fallback on
      // `raw.trim() === ''`, so any other rule here would be two layers disagreeing
      // about what an empty variable means — the drift env-defaults.test.ts exists
      // to catch. The consequence is documented: `SYSLOG_HOST=` expresses "no
      // default", not "forbidden", so the UI can still set one.
      const resolved = resolveDeliverySettings(
        { NOTIFY_WEBHOOK_URL: '', SYSLOG_APP_NAME: '   ' },
        { webhookUrl: 'https://hooks.slack.com/services/T/B/x' },
      );
      assert.equal(resolved.webhookUrl.value, 'https://hooks.slack.com/services/T/B/x');
      assert.equal(resolved.webhookUrl.source, 'database');
      // Whitespace-only is blank too, and falls all the way to the default.
      assert.equal(resolved.syslogAppName.value, 'nmt');
      assert.equal(resolved.syslogAppName.source, 'default');
    });

    it('agrees with env.ts about what an empty integer variable means', () => {
      // `Number('')` is 0, so a naive parser turns `NOTIFY_MAX_PER_HOUR=` into a
      // ceiling of zero — every notification rate-limited away, silently. env.ts
      // guards this with `raw.trim() === ''`; this must too. Caught by this test
      // while writing it, not by inspection.
      const resolved = resolveDeliverySettings({ NOTIFY_MAX_PER_HOUR: '' }, {});
      assert.equal(resolved.maxPerHour.value, DELIVERY_DEFAULTS.maxPerHour);
      assert.equal(resolved.maxPerHour.source, 'default');
      assert.equal(parseFieldValue('maxPerHour', ''), undefined);
      assert.equal(parseFieldValue('maxPerHour', '   '), undefined);
    });

    it('falls through a set-but-unparseable variable rather than pinning nonsense', () => {
      // The alternative is a server that will not boot because somebody typed
      // NOTIFY_MAX_PER_HOUR=lots. A stored value is a better answer than no server.
      const resolved = resolveDeliverySettings({ NOTIFY_MAX_PER_HOUR: 'lots' }, { maxPerHour: 7 });
      assert.equal(resolved.maxPerHour.value, 7);
      assert.equal(resolved.maxPerHour.source, 'database');
    });
  });

  describe('provenance', () => {
    it('lists exactly the fields the environment has pinned', () => {
      const resolved = resolveDeliverySettings(
        { NOTIFY_ENABLED: 'true', SMTP_HOST: 'relay.internal' },
        { maxPerHour: 4 },
      );
      assert.deepEqual(environmentPinnedFields(resolved).sort(), ['emailHost', 'enabled']);
    });

    it('reports every field, so the page never has to guess', () => {
      // A field missing from the response would render as editable by default,
      // which is the wrong direction for a pinned one.
      const resolved = resolveDeliverySettings(NO_ENV, {});
      const fields = Object.keys(DELIVERY_FIELDS) as DeliveryField[];
      for (const field of fields) {
        assert.ok(resolved[field], `${field} missing from the resolution`);
        assert.ok(['environment', 'database', 'default'].includes(resolved[field].source));
      }
      assert.equal(Object.keys(resolved).length, fields.length);
    });
  });

  describe('secrets', () => {
    it('never returns a secret value through the API view', () => {
      const resolved = resolveDeliverySettings(NO_ENV, {
        webhookUrl: 'https://hooks.slack.com/services/T/B/super-secret',
        emailPassword: 'hunter2',
        emailUser: 'nmt@example.com',
      });
      const view = redactForApi(resolved);
      const serialised = JSON.stringify(view);

      assert.ok(!serialised.includes('super-secret'), 'the webhook URL leaked');
      assert.ok(!serialised.includes('hunter2'), 'the SMTP password leaked');
      // But whether they are configured is exactly what the form needs.
      assert.equal(view.webhookUrl?.configured, true);
      assert.equal(view.emailPassword?.configured, true);
      assert.equal(view.webhookUrl?.value, undefined);
      // A username is not a secret, and hiding it would make the form unusable.
      assert.equal(view.emailUser?.value, 'nmt@example.com');
    });

    it('reports an unset secret as not configured rather than omitting it', () => {
      const view = redactForApi(resolveDeliverySettings(NO_ENV, {}));
      assert.equal(view.webhookUrl?.configured, false);
      assert.equal(view.emailPassword?.configured, false);
    });

    it('treats whitespace as not configured', () => {
      // Otherwise a webhook of "   " reports configured and delivers nothing.
      const view = redactForApi(resolveDeliverySettings(NO_ENV, { webhookUrl: '   ' }));
      assert.equal(view.webhookUrl?.configured, false);
    });

    it('marks exactly the two fields that are credentials', () => {
      const secrets = (Object.keys(DELIVERY_FIELDS) as DeliveryField[]).filter(isSecretField);
      assert.deepEqual(secrets.sort(), ['emailPassword', 'webhookUrl']);
    });
  });

  describe('parsing', () => {
    it('accepts the boolean spellings an operator actually types', () => {
      for (const yes of ['true', 'TRUE', '1', 'yes', 'on', true]) {
        assert.equal(parseFieldValue('enabled', yes), true, String(yes));
      }
      for (const no of ['false', '0', 'no', 'off', false]) {
        assert.equal(parseFieldValue('enabled', no), false, String(no));
      }
      // Not undefined: env.ts's old bool() treated any unrecognized, non-blank
      // value as false, and a legacy typo must keep resolving that way rather
      // than falling through to a default that might be true.
      assert.equal(parseFieldValue('enabled', 'perhaps'), false);
    });

    it('refuses a fractional integer, but not a negative one', () => {
      assert.equal(parseFieldValue('maxPerHour', '12'), 12);
      assert.equal(parseFieldValue('maxPerHour', 1.5), undefined);
      assert.equal(parseFieldValue('maxPerHour', ''), undefined);
      // As lenient as the env.ts parser it replaces: a legacy NOTIFY_MAX_PER_HOUR=-1
      // muted every notification (count >= ceiling is always true for a negative
      // ceiling) and must keep doing so. The database's CHECK constraint is what
      // stops a negative value from being stored; this layer only checks shape.
      assert.equal(parseFieldValue('maxPerHour', -1), -1);
    });

    it('refuses an enum value outside the closed set', () => {
      assert.equal(parseFieldValue('minSeverity', 'HIGH'), 'high');
      assert.equal(parseFieldValue('minSeverity', 'urgent'), undefined);
      assert.equal(parseFieldValue('webhookFormat', 'teams-connector'), 'teams-connector');
      assert.equal(parseFieldValue('syslogProtocol', 'sctp'), undefined);
    });

    it('splits a recipient list and drops the blanks', () => {
      assert.deepEqual(parseFieldValue('emailTo', 'a@x.test, b@x.test ,'), ['a@x.test', 'b@x.test']);
      assert.deepEqual(parseFieldValue('emailTo', ['a@x.test', '']), ['a@x.test']);
      assert.deepEqual(parseFieldValue('emailTo', ''), []);
    });

    it('trims a string, because a pasted URL brings whitespace', () => {
      assert.equal(parseFieldValue('webhookUrl', '  https://x.test/hook  '), 'https://x.test/hook');
    });
  });

  describe('effective settings', () => {
    it('produces every field as a plain value', () => {
      const settings = effectiveSettings(resolveDeliverySettings({ NOTIFY_ENABLED: 'true' }, {}));
      assert.equal(settings.enabled, true);
      assert.equal(settings.minSeverity, 'high');
      assert.deepEqual(settings.emailTo, []);
      assert.equal(Object.keys(settings).length, Object.keys(DELIVERY_FIELDS).length);
    });
  });
});

describe('refusing to store what the environment pins', () => {
  it('names the pinned fields in a patch', () => {
    // Storing them would be defensible — they would apply if the variable were
    // removed — but it would mean answering 200 to a change that changes nothing,
    // and reporting provenance exists precisely so nobody has to guess about that.
    const resolution = resolveDeliverySettings({ NOTIFY_ENABLED: 'true', SMTP_HOST: 'relay.internal' }, {});

    assert.deepEqual(
      pinnedConflicts({ enabled: false, maxPerHour: 4, emailHost: 'other.internal' }, resolution).sort(),
      ['emailHost', 'enabled'],
    );
  });

  it('is empty when nothing in the patch is pinned', () => {
    const resolution = resolveDeliverySettings({ NOTIFY_ENABLED: 'true' }, {});
    assert.deepEqual(pinnedConflicts({ maxPerHour: 4, minSeverity: 'low' }, resolution), []);
  });

  it('does not treat a stored or default field as pinned', () => {
    // Only the environment pins. A value that came from the row is exactly what the
    // form is for changing.
    const resolution = resolveDeliverySettings({}, { maxPerHour: 9 });
    assert.deepEqual(pinnedConflicts({ maxPerHour: 4, minSeverity: 'low' }, resolution), []);
  });

  it('ignores a key that is not a setting at all', () => {
    // The schema refuses unknown keys before this runs; this makes the function
    // safe on its own rather than dependent on that ordering.
    const resolution = resolveDeliverySettings({ NOTIFY_ENABLED: 'true' }, {});
    assert.deepEqual(pinnedConflicts({ nonsense: 1 }, resolution), []);
  });
});

describe('naming a bad environment value rather than silently ignoring it', () => {
  it('names the variable, not the field, since that is what an operator edits', () => {
    assert.deepEqual(invalidEnvironmentVariables({ NOTIFY_MIN_SEVERITY: 'critial' }), [
      'NOTIFY_MIN_SEVERITY',
    ]);
    assert.deepEqual(invalidEnvironmentVariables({ NOTIFY_MAX_PER_HOUR: 'lots' }), ['NOTIFY_MAX_PER_HOUR']);
  });

  it('says nothing about a variable that is unset, blank, or parses fine', () => {
    assert.deepEqual(
      invalidEnvironmentVariables({
        NOTIFY_MIN_SEVERITY: 'high',
        NOTIFY_DIGEST_SECONDS: '',
        SYSLOG_PORT: undefined,
      }),
      [],
    );
  });

  it('lists every bad one, not just the first', () => {
    assert.deepEqual(
      invalidEnvironmentVariables({ NOTIFY_MIN_SEVERITY: 'critial', NOTIFY_MAX_PER_HOUR: 'lots' }).sort(),
      ['NOTIFY_MAX_PER_HOUR', 'NOTIFY_MIN_SEVERITY'],
    );
  });

  it('never flags a boolean: an unrecognized string still parses, to false', () => {
    // See parseFieldValue's boolean case — this is the one kind that never falls
    // through, matching the legacy parser it replaces.
    assert.deepEqual(invalidEnvironmentVariables({ NOTIFY_INCLUDE_EVIDENCE: 'maybe' }), []);
  });
});
