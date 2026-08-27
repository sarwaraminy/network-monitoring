import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DELIVERY_DEFAULTS,
  DELIVERY_FIELDS,
  type DeliveryField,
  effectiveSettings,
  environmentPinnedFields,
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
      assert.equal(parseFieldValue('enabled', 'perhaps'), undefined);
    });

    it('refuses a negative or fractional integer', () => {
      assert.equal(parseFieldValue('maxPerHour', '12'), 12);
      assert.equal(parseFieldValue('maxPerHour', -1), undefined);
      assert.equal(parseFieldValue('maxPerHour', 1.5), undefined);
      assert.equal(parseFieldValue('maxPerHour', ''), undefined);
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

/**
 * The defaults here must not drift from env.ts's own fallbacks.
 *
 * Exactly the failure `env-defaults.test.ts` was written for, in a new place: a
 * second copy of a default is a default that can silently disagree. Compared as text
 * rather than by importing `env`, because importing it reads `process.env`, which is
 * the layer under test.
 */
describe('delivery defaults match env.ts', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const envSource = readFileSync(join(HERE, '..', 'config', 'env.ts'), 'utf8');

  /** `bool('NAME', true)` / `int('NAME', 42)` / `optional('NAME', 'x')` from env.ts. */
  function envDefaultFor(variable: string): string | undefined {
    const pattern = new RegExp(`\\b(?:bool|int|optional)\\(\\s*'${variable}'\\s*,\\s*('[^']*'|[^),]*)\\)`);
    return pattern.exec(envSource)?.[1]?.trim();
  }

  it('agrees with env.ts wherever env.ts states a default', () => {
    const checked: string[] = [];

    for (const [field, spec] of Object.entries(DELIVERY_FIELDS)) {
      const declared = envDefaultFor(spec.env);
      if (declared === undefined) continue;

      const ours = DELIVERY_DEFAULTS[field as DeliveryField];
      // env.ts states seconds for the two windows and multiplies by 1000 itself; our
      // field is named `…Seconds` and holds the same number.
      const normalised = declared.replace(/^'|'$/g, '');
      const oursText = Array.isArray(ours) ? '' : String(ours);

      assert.equal(
        normalised,
        oursText,
        `${field} (${spec.env}): env.ts says ${declared}, DELIVERY_DEFAULTS says ${oursText}`,
      );
      checked.push(field);
    }

    // Guards against the regex silently matching nothing and the loop asserting
    // nothing — the way a comparison test passes while watching an empty set.
    assert.ok(checked.length > 12, `only ${checked.length} defaults compared: ${checked.join(', ')}`);
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
