import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error-handler.js';
import {
  alertDashboardQuerySchema,
  alertListQuerySchema,
  captureStartSchema,
  deliverySettingsPatchSchema,
  idSchema,
  ipAddressSchema,
  loginSchema,
  logSchema,
  parseId,
  parseSince,
  signupSchema,
  suppressionCreateSchema,
  suppressionPreviewSchema,
  suppressionUpdateSchema,
} from './validation.js';

/**
 * Request validation.
 *
 * This is the boundary where untrusted input becomes trusted data, and until now
 * it had no tests at all: a schema that quietly stopped rejecting something would
 * not have failed the build. Every case below is a specific thing that must not
 * reach the layer behind it — an unbounded `limit`, a negative id, a float where a
 * row id is expected, an Invalid Date that silently matches nothing.
 *
 * These are also the tests that make the pending zod 4 upgrade checkable. v4
 * changes `z.coerce.*` semantics, `.default()` inference and the `.email()` API,
 * all of which are exercised here, so the upgrade either keeps them green or does
 * not — rather than passing CI and failing in production.
 */

/** Query strings arrive as strings; nothing here should assume otherwise. */
const q = (o: Record<string, string>) => o;

describe('id coercion', () => {
  it('accepts a positive integer as a string', () => {
    assert.equal(idSchema.parse('42'), 42);
    assert.equal(parseId('42'), 42);
  });

  it('rejects zero, negatives and floats', () => {
    // A float reaching a `WHERE id = $1` is not an error Postgres reports usefully.
    for (const bad of ['0', '-1', '1.5', '0.0']) {
      assert.equal(idSchema.safeParse(bad).success, false, `${bad} should be rejected`);
    }
  });

  it('rejects text, empty and whitespace', () => {
    for (const bad of ['abc', '', '   ', '1abc']) {
      assert.equal(idSchema.safeParse(bad).success, false, `"${bad}" should be rejected`);
    }
  });

  it('rejects the coercion traps', () => {
    // Number('') is 0 and Number(null) is 0 — both would sail through a bare
    // Number() cast. Number([]) is 0 too.
    for (const bad of [null, [], {}, true, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(idSchema.safeParse(bad).success, false, `${JSON.stringify(bad)} should be rejected`);
    }
  });

  it('throws a 400 through parseId rather than leaking a zod error', () => {
    assert.throws(
      () => parseId('nope'),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
  });
});

describe('alert list query', () => {
  it('defaults limit and offset when absent', () => {
    const parsed = alertListQuerySchema.parse(q({}));
    assert.equal(parsed.limit, 200);
    assert.equal(parsed.offset, 0);
  });

  it('caps limit at 500', () => {
    // The only thing between a caller and selecting the whole alerts table.
    assert.equal(alertListQuerySchema.safeParse(q({ limit: '501' })).success, false);
    assert.equal(alertListQuerySchema.safeParse(q({ limit: '999999' })).success, false);
    assert.equal(alertListQuerySchema.parse(q({ limit: '500' })).limit, 500);
  });

  it('rejects a limit below one', () => {
    for (const bad of ['0', '-1', '-500']) {
      assert.equal(alertListQuerySchema.safeParse(q({ limit: bad })).success, false);
    }
  });

  it('rejects a negative offset', () => {
    assert.equal(alertListQuerySchema.safeParse(q({ offset: '-1' })).success, false);
    assert.equal(alertListQuerySchema.parse(q({ offset: '0' })).offset, 0);
  });

  it('accepts only known severities and kinds', () => {
    assert.equal(alertListQuerySchema.parse(q({ severity: 'critical' })).severity, 'critical');
    assert.equal(alertListQuerySchema.safeParse(q({ severity: 'CRITICAL' })).success, false);
    assert.equal(alertListQuerySchema.safeParse(q({ severity: 'urgent' })).success, false);

    assert.equal(alertListQuerySchema.parse(q({ kind: 'port_scan' })).kind, 'port_scan');
    assert.equal(alertListQuerySchema.safeParse(q({ kind: 'made_up' })).success, false);
  });

  it('turns the acknowledged string into a boolean, and only those two strings', () => {
    assert.equal(alertListQuerySchema.parse(q({ acknowledged: 'true' })).acknowledged, true);
    assert.equal(alertListQuerySchema.parse(q({ acknowledged: 'false' })).acknowledged, false);
    // Undefined must stay undefined: it means "either", not "false".
    assert.equal(alertListQuerySchema.parse(q({})).acknowledged, undefined);
    assert.equal(alertListQuerySchema.safeParse(q({ acknowledged: '1' })).success, false);
    assert.equal(alertListQuerySchema.safeParse(q({ acknowledged: 'yes' })).success, false);
  });

  it('rejects a blank since rather than treating it as absent', () => {
    assert.equal(alertListQuerySchema.safeParse(q({ since: '' })).success, false);
    assert.equal(alertListQuerySchema.safeParse(q({ since: '  ' })).success, false);
  });
});

describe('dashboard query', () => {
  it('defaults to seven days', () => {
    assert.equal(alertDashboardQuerySchema.parse(q({})).days, 7);
  });

  it('allows a window longer than the retention default', () => {
    /*
     * The ceiling used to be 365, which is also the `ALERT_RETENTION_DAYS` default,
     * and that combination made the daily rollup unreachable: retention rolls up
     * days *older* than its cutoff, so every bucket in `alert_rollup_daily` sat
     * outside the longest window anyone could ask for. The trend answered a
     * year-long question with only what had not yet expired — the exact flat line
     * the rollup exists to prevent.
     */
    assert.ok(
      1825 > env.retention.alertDays,
      'the dashboard window must be able to reach past the retention cutoff, or the rollup is invisible',
    );
    assert.equal(alertDashboardQuerySchema.parse(q({ days: '730' })).days, 730);
  });

  it('still bounds the window', () => {
    assert.equal(alertDashboardQuerySchema.parse(q({ days: '1825' })).days, 1825);
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '1826' })).success, false);
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '0' })).success, false);
  });

  it('accepts only hour or day as a bucket', () => {
    // This value is inlined into date_trunc() via sql.raw, so the closed set is
    // load-bearing rather than cosmetic.
    assert.equal(alertDashboardQuerySchema.parse(q({ bucket: 'hour' })).bucket, 'hour');
    assert.equal(alertDashboardQuerySchema.parse(q({ bucket: 'day' })).bucket, 'day');
    assert.equal(alertDashboardQuerySchema.safeParse(q({ bucket: 'week' })).success, false);

    const injection = `day'); DROP TABLE alerts;--`;
    assert.equal(alertDashboardQuerySchema.safeParse(q({ bucket: injection })).success, false);
  });

  it('keeps hourly windows at the old ceiling, since the wider one only pays for itself on day buckets', () => {
    /*
     * The 1825-day ceiling above exists so a *daily* trend can reach the rollup.
     * `dashboardData` only folds the rollup into day buckets — an hourly one is
     * always live rows alone — so an hourly request at the wide ceiling would be
     * pure live-row scan and grouping over five years, five times what the old,
     * single 365-day ceiling ever allowed.
     */
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '365', bucket: 'hour' })).success, true);
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '366', bucket: 'hour' })).success, false);
    // The same window is fine for a day bucket, and for no bucket at all (the
    // route picks 'day' itself once days > 2).
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '1825', bucket: 'day' })).success, true);
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '1825' })).success, true);
  });
});

describe('since', () => {
  const NOW = Date.parse('2026-07-27T12:00:00Z');

  it('returns undefined when absent', () => {
    assert.equal(parseSince(undefined, NOW), undefined);
    assert.equal(parseSince('', NOW), undefined);
  });

  it('reads relative windows', () => {
    assert.equal(parseSince('30m', NOW)?.getTime(), NOW - 30 * 60_000);
    assert.equal(parseSince('24h', NOW)?.getTime(), NOW - 24 * 3_600_000);
    assert.equal(parseSince('7d', NOW)?.getTime(), NOW - 7 * 86_400_000);
  });

  it('reads an ISO date', () => {
    assert.equal(parseSince('2026-07-01T00:00:00Z', NOW)?.toISOString(), '2026-07-01T00:00:00.000Z');
  });

  it('rejects garbage instead of producing an Invalid Date', () => {
    // new Date('nonsense') does not throw; it yields Invalid Date, and comparing
    // against that silently matches nothing — which reads as "no alerts found"
    // rather than as a bad request.
    for (const bad of ['nonsense', '24x', 'yesterday', '--', '7 days']) {
      assert.throws(
        () => parseSince(bad, NOW),
        (error: unknown) => error instanceof HttpError && error.status === 400,
        `"${bad}" should be a 400`,
      );
    }
  });
});

describe('capture start', () => {
  it('requires an interface name', () => {
    assert.equal(captureStartSchema.safeParse({}).success, false);
    assert.equal(captureStartSchema.safeParse({ interfaceName: '' }).success, false);
    assert.equal(captureStartSchema.safeParse({ interfaceName: '   ' }).success, false);
  });

  it('applies snaplength and timeout defaults', () => {
    const parsed = captureStartSchema.parse({ interfaceName: 'eth0' });
    assert.equal(parsed.snaplength, 65_536);
    assert.equal(parsed.timeout, 10);
  });

  it('rejects a non-positive snaplength', () => {
    for (const bad of ['0', '-1']) {
      assert.equal(captureStartSchema.safeParse({ interfaceName: 'eth0', snaplength: bad }).success, false);
    }
  });

  it('allows a zero timeout but not a negative one', () => {
    assert.equal(captureStartSchema.parse({ interfaceName: 'eth0', timeout: '0' }).timeout, 0);
    assert.equal(captureStartSchema.safeParse({ interfaceName: 'eth0', timeout: '-1' }).success, false);
  });

  it('trims the interface name', () => {
    assert.equal(captureStartSchema.parse({ interfaceName: '  eth0  ' }).interfaceName, 'eth0');
  });
});

describe('ip address body', () => {
  it('requires a non-empty value', () => {
    assert.equal(ipAddressSchema.safeParse({}).success, false);
    assert.equal(ipAddressSchema.safeParse({ ipAddress: '' }).success, false);
    assert.equal(ipAddressSchema.safeParse({ ipAddress: '   ' }).success, false);
  });

  it('bounds the length', () => {
    // This value is checked again before reaching a BPF expression, but an
    // unbounded string should not get that far in the first place.
    assert.equal(ipAddressSchema.safeParse({ ipAddress: 'x'.repeat(256) }).success, false);
    assert.equal(ipAddressSchema.parse({ ipAddress: '10.0.0.1' }).ipAddress, '10.0.0.1');
  });
});

describe('login', () => {
  it('requires both fields', () => {
    assert.equal(loginSchema.safeParse({ email: 'a@b.com' }).success, false);
    assert.equal(loginSchema.safeParse({ password: 'x' }).success, false);
    assert.equal(loginSchema.safeParse({ email: '', password: 'x' }).success, false);
    assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success, false);
  });

  it('does not require a well-formed email, so the failure is the same for any bad login', () => {
    // Rejecting malformed emails here would answer "is this an account?" before
    // the password is checked.
    assert.equal(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success, true);
  });
});

describe('signup', () => {
  const valid = {
    email: 'someone@example.com',
    password: 'a-good-password',
    firstname: 'Sam',
  };

  it('accepts a minimal valid body and fills the defaults', () => {
    const parsed = signupSchema.parse(valid);
    assert.equal(parsed.role, 'USER');
    assert.equal(parsed.langCode, 'en');
    assert.equal(parsed.lastname, '');
  });

  it('requires a well-formed email', () => {
    assert.equal(signupSchema.safeParse({ ...valid, email: 'not-an-email' }).success, false);
    assert.equal(signupSchema.safeParse({ ...valid, email: '' }).success, false);
  });

  it('enforces a minimum password length', () => {
    assert.equal(signupSchema.safeParse({ ...valid, password: 'short' }).success, false);
    assert.equal(signupSchema.safeParse({ ...valid, password: '12345678' }).success, true);
  });

  it('requires a first name', () => {
    assert.equal(signupSchema.safeParse({ ...valid, firstname: '' }).success, false);
    assert.equal(signupSchema.safeParse({ ...valid, firstname: '  ' }).success, false);
  });

  it('accepts only the two known roles', () => {
    assert.equal(signupSchema.parse({ ...valid, role: 'ADMIN' }).role, 'ADMIN');
    assert.equal(signupSchema.safeParse({ ...valid, role: 'SUPERADMIN' }).success, false);
    assert.equal(signupSchema.safeParse({ ...valid, role: 'admin' }).success, false);
  });

  it('parses role but does not decide it', () => {
    // A reminder in test form: this field is a request, not an instruction. What
    // the account actually gets is decided by services/signup-policy.ts from the
    // caller's verified token. See the privilege-escalation fix.
    assert.equal(signupSchema.parse({ ...valid, role: 'ADMIN' }).role, 'ADMIN');
  });
});

describe('log rows', () => {
  const valid = {
    sourceip: '10.0.0.1',
    destinationip: '10.0.0.2',
    protocol: 'TCP',
    details: 'something happened',
  };

  it('accepts a minimal valid row', () => {
    assert.equal(logSchema.safeParse(valid).success, true);
  });

  it('requires the non-nullable fields', () => {
    for (const field of ['sourceip', 'destinationip', 'protocol', 'details'] as const) {
      assert.equal(logSchema.safeParse({ ...valid, [field]: '' }).success, false, `${field} empty`);
      const without = { ...valid };
      delete (without as Record<string, unknown>)[field];
      assert.equal(logSchema.safeParse(without).success, false, `${field} missing`);
    }
  });

  it('allows the optional MAC fields to be null or absent', () => {
    assert.equal(logSchema.safeParse({ ...valid, sourcemac: null }).success, true);
    assert.equal(logSchema.safeParse({ ...valid, ipversion: null }).success, true);
  });

  it('coerces a timestamp and rejects an unparseable one', () => {
    const parsed = logSchema.parse({ ...valid, timestamp: '2026-07-27T12:00:00Z' });
    assert.ok(parsed.timestamp instanceof Date);
    assert.equal(logSchema.safeParse({ ...valid, timestamp: 'not a date' }).success, false);
  });

  it('bounds the field lengths', () => {
    assert.equal(logSchema.safeParse({ ...valid, sourceip: 'x'.repeat(201) }).success, false);
    assert.equal(logSchema.safeParse({ ...valid, protocol: 'x'.repeat(101) }).success, false);
  });
});

/**
 * Suppression rules.
 *
 * The stakes here are different from every other schema in this file. A rejected
 * request is a nuisance; an *accepted* suppression rule that is broader than its
 * author wrote is silence, and silence looks exactly like a quiet network. So the
 * cases below concentrate on the two ways this boundary could betray that: a rule
 * with nothing to match on, and a range that covers more than it appears to.
 */
describe('suppression rules', () => {
  const minimal = { kind: 'port_scan', reason: 'authorised weekly vulnerability scan' };

  describe('create', () => {
    it('accepts a rule with one criterion and a reason', () => {
      const parsed = suppressionCreateSchema.parse(minimal);
      assert.equal(parsed.kind, 'port_scan');
      // Off by default would be a rule that does nothing until somebody notices.
      assert.equal(parsed.enabled, true);
    });

    it('refuses a rule with no criteria at all', () => {
      // The one mistake on this screen with no recoverable symptom: the tool
      // simply goes quiet. Refused here, and again by a CHECK constraint.
      assert.equal(suppressionCreateSchema.safeParse({ reason: 'because' }).success, false);
      assert.equal(
        suppressionCreateSchema.safeParse({
          reason: 'because',
          kind: null,
          sourceCidr: null,
          targetCidr: null,
          port: null,
        }).success,
        false,
      );
    });

    it('accepts explicit nulls as long as one criterion survives', () => {
      const parsed = suppressionCreateSchema.parse({
        ...minimal,
        sourceCidr: null,
        targetCidr: null,
        port: null,
      });
      assert.equal(parsed.kind, 'port_scan');
    });

    it('demands a reason worth reading', () => {
      for (const reason of [undefined, '', '   ', 'x']) {
        assert.equal(
          suppressionCreateSchema.safeParse({ kind: 'port_scan', reason }).success,
          false,
          `reason ${JSON.stringify(reason)}`,
        );
      }
    });

    it('normalises a range to what it actually matches', () => {
      // `10.0.0.7/24` is a legal way to write the whole /24. Stored verbatim it
      // would show one address beside a rule covering 256 of them.
      const parsed = suppressionCreateSchema.parse({
        ...minimal,
        sourceCidr: '10.0.0.7/24',
        targetCidr: ' 192.168.1.50 ',
      });
      assert.equal(parsed.sourceCidr, '10.0.0.0/24');
      assert.equal(parsed.targetCidr, '192.168.1.50/32');
    });

    it('refuses a match-everything range on either side', () => {
      assert.equal(suppressionCreateSchema.safeParse({ ...minimal, sourceCidr: '0.0.0.0/0' }).success, false);
      assert.equal(suppressionCreateSchema.safeParse({ ...minimal, targetCidr: '::/0' }).success, false);
    });

    it('says how to write a range when it refuses one', () => {
      // The message is the whole difference between an operator fixing a typo and
      // an operator concluding the field does not work.
      const parsed = suppressionCreateSchema.safeParse({ ...minimal, sourceCidr: 'the scanner' });
      assert.equal(parsed.success, false);
      const message = parsed.success ? '' : parsed.error.issues.map((issue) => issue.message).join(' ');
      assert.match(message, /10\.0\.0\.0\/24/);
      assert.match(message, /leave the field empty/i);
    });

    it('refuses a range it cannot parse', () => {
      for (const cidr of ['10.0.0', '10.0.0.256', '10.0.0.0/33', 'fe80::1%eth0', '']) {
        assert.equal(
          suppressionCreateSchema.safeParse({ ...minimal, sourceCidr: cidr }).success,
          false,
          `sourceCidr ${JSON.stringify(cidr)}`,
        );
      }
    });

    it('refuses a kind no detector produces', () => {
      // A rule naming a kind that cannot occur is inert, and its author believes
      // otherwise. The closed enum is what makes that unrepresentable.
      assert.equal(
        suppressionCreateSchema.safeParse({ kind: 'portscan', reason: 'typo above' }).success,
        false,
      );
    });

    it('bounds the port and coerces it from a string', () => {
      assert.equal(suppressionCreateSchema.parse({ ...minimal, port: '445' }).port, 445);
      assert.equal(suppressionCreateSchema.parse({ ...minimal, port: 1 }).port, 1);
      assert.equal(suppressionCreateSchema.parse({ ...minimal, port: 65_535 }).port, 65_535);
      for (const port of [0, -1, 65_536, 1.5]) {
        assert.equal(suppressionCreateSchema.safeParse({ ...minimal, port }).success, false, `port ${port}`);
      }
    });

    it('coerces an expiry and rejects one it cannot read', () => {
      const parsed = suppressionCreateSchema.parse({ ...minimal, expiresAt: '2026-09-01T00:00:00Z' });
      assert.ok(parsed.expiresAt instanceof Date);
      assert.equal(suppressionCreateSchema.safeParse({ ...minimal, expiresAt: 'soon' }).success, false);
    });

    it('accepts an expiry that has already passed', () => {
      // Deliberate, and documented where the schema is defined: such a rule is
      // inert, so it hides nothing, and refusing it would block an edit to any
      // other field of an already-expired rule.
      assert.equal(
        suppressionCreateSchema.safeParse({ ...minimal, expiresAt: '2020-01-01T00:00:00Z' }).success,
        true,
      );
    });
  });

  describe('update', () => {
    it('accepts a patch that changes nothing', () => {
      // The criteria check cannot run here — clearing the only criterion of a rule
      // is invalid and clearing one of two is fine, and the patch cannot tell
      // those apart. The route merges and checks the result.
      assert.equal(suppressionUpdateSchema.safeParse({}).success, true);
    });

    it('keeps a rule being switched off distinct from one left alone', () => {
      // `enabled: false` must survive as false rather than being read as absent,
      // which is the whole point of the `??` in the route's merge.
      assert.equal(suppressionUpdateSchema.parse({ enabled: false }).enabled, false);
      assert.equal(suppressionUpdateSchema.parse({}).enabled, undefined);
    });

    it('distinguishes clearing a criterion from leaving it', () => {
      assert.equal(suppressionUpdateSchema.parse({ sourceCidr: null }).sourceCidr, null);
      assert.equal(suppressionUpdateSchema.parse({}).sourceCidr, undefined);
      assert.equal(suppressionUpdateSchema.parse({ expiresAt: null }).expiresAt, null);
      assert.equal(suppressionUpdateSchema.parse({}).expiresAt, undefined);
    });

    it('holds a patched range to the same standard as a new one', () => {
      assert.equal(suppressionUpdateSchema.parse({ sourceCidr: '10.1.2.3/16' }).sourceCidr, '10.1.0.0/16');
      assert.equal(suppressionUpdateSchema.safeParse({ sourceCidr: '0.0.0.0/0' }).success, false);
      assert.equal(suppressionUpdateSchema.safeParse({ port: 70_000 }).success, false);
    });
  });

  describe('preview', () => {
    it('bounds how much history it will scan', () => {
      assert.equal(suppressionPreviewSchema.parse({ kind: 'port_scan' }).limit, 500);
      assert.equal(suppressionPreviewSchema.parse({ kind: 'port_scan', limit: '50' }).limit, 50);
      assert.equal(suppressionPreviewSchema.safeParse({ kind: 'port_scan', limit: 0 }).success, false);
      assert.equal(suppressionPreviewSchema.safeParse({ kind: 'port_scan', limit: 2_001 }).success, false);
    });

    it('refuses to preview a rule with no criteria', () => {
      // A rule that matches everything would report "this would hide all 500 of
      // your alerts", which is true, useless, and reassuringly specific.
      assert.equal(suppressionPreviewSchema.safeParse({}).success, false);
    });
  });
});

/**
 * The delivery settings patch.
 *
 * The boundary where an IT admin's form post becomes stored configuration that
 * decides where findings about their network are sent. Two things it must get right,
 * and both are about saying nothing silently:
 *
 *  - absent and null mean different things, because the form cannot round-trip a
 *    secret the API never sends it;
 *  - an unknown key is refused rather than dropped, because a typo that returns 200
 *    having changed nothing is the exact failure this feature exists to remove.
 */
describe('delivery settings patch', () => {
  it('accepts a single field', () => {
    const parsed = deliverySettingsPatchSchema.parse({ maxPerHour: 6 });
    assert.deepEqual(parsed, { maxPerHour: 6 });
  });

  it('keeps absent and null distinct', () => {
    // Absent leaves the stored value alone; null clears it so the field falls back
    // to the environment or the default. Collapsing them would mean the form could
    // not save anything without also retyping the webhook URL.
    const cleared = deliverySettingsPatchSchema.parse({ webhookUrl: null });
    assert.equal('webhookUrl' in cleared, true);
    assert.equal(cleared.webhookUrl, null);

    const untouched = deliverySettingsPatchSchema.parse({ maxPerHour: 6 });
    assert.equal('webhookUrl' in untouched, false);
  });

  it('refuses an empty patch', () => {
    assert.equal(deliverySettingsPatchSchema.safeParse({}).success, false);
  });

  it('refuses an unknown key rather than ignoring it', () => {
    // `minSeverety` would otherwise return 200 having changed nothing.
    assert.equal(deliverySettingsPatchSchema.safeParse({ minSeverety: 'high' }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ maxPerHour: 6, nonsense: 1 }).success, false);
  });

  it('bounds every number the same way the CHECK constraints do', () => {
    // V7 refuses these too. Two copies of a bound can drift, so both layers are
    // asserted rather than one being trusted to imply the other.
    assert.equal(deliverySettingsPatchSchema.safeParse({ maxPerHour: 0 }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ digestSeconds: -1 }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ throttleSeconds: -1 }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ syslogPort: 0 }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ syslogPort: 65_536 }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ emailPort: 0 }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ syslogFacility: 24 }).success, false);

    // And accepts the meaningful edges: no batching, no throttling.
    assert.equal(deliverySettingsPatchSchema.parse({ digestSeconds: 0 }).digestSeconds, 0);
    assert.equal(deliverySettingsPatchSchema.parse({ throttleSeconds: 0 }).throttleSeconds, 0);
    assert.equal(deliverySettingsPatchSchema.parse({ syslogFacility: 0 }).syslogFacility, 0);
  });

  it('refuses a value outside a closed set', () => {
    assert.equal(deliverySettingsPatchSchema.safeParse({ minSeverity: 'urgent' }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ webhookFormat: 'msteams' }).success, false);
    assert.equal(deliverySettingsPatchSchema.safeParse({ syslogProtocol: 'sctp' }).success, false);
    // teams-connector is a real format and must stay reachable.
    assert.equal(
      deliverySettingsPatchSchema.parse({ webhookFormat: 'teams-connector' }).webhookFormat,
      'teams-connector',
    );
  });

  it('takes recipients as a list or as the comma string the env variable uses', () => {
    assert.deepEqual(deliverySettingsPatchSchema.parse({ emailTo: ['a@x.test', ' b@x.test '] }).emailTo, [
      'a@x.test',
      'b@x.test',
    ]);
    // Somebody will paste the NOTIFY_EMAIL_TO value straight in.
    assert.deepEqual(deliverySettingsPatchSchema.parse({ emailTo: 'a@x.test, b@x.test,' }).emailTo, [
      'a@x.test',
      'b@x.test',
    ]);
    // Cleared, rather than an empty list, when the operator means "unset".
    assert.equal(deliverySettingsPatchSchema.parse({ emailTo: null }).emailTo, null);
    assert.deepEqual(deliverySettingsPatchSchema.parse({ emailTo: '' }).emailTo, []);
  });

  it('trims a pasted secret, because trailing whitespace is a silent failure', () => {
    assert.equal(
      deliverySettingsPatchSchema.parse({ webhookUrl: '  https://hooks.slack.com/services/T/B/x  ' })
        .webhookUrl,
      'https://hooks.slack.com/services/T/B/x',
    );
  });

  it('refuses a from-address or recipient that is not a real email address', () => {
    // Otherwise a typo saves successfully and only surfaces later as a silent
    // SMTP rejection, on the one field this feature exists to make configurable
    // without editing a file and finding out at the next incident.
    assert.equal(deliverySettingsPatchSchema.safeParse({ emailFrom: 'not-an-email' }).success, false);
    assert.equal(
      deliverySettingsPatchSchema.safeParse({ emailTo: ['ops@example.test', 'bad'] }).success,
      false,
    );

    assert.equal(
      deliverySettingsPatchSchema.parse({ emailFrom: '  nmt@example.test  ' }).emailFrom,
      'nmt@example.test',
    );
  });

  it('does not hold emailUser to the same standard, since it is a login, not an address', () => {
    // Plenty of SMTP providers hand out an AUTH username that is not
    // email-shaped at all — an API key, a plain account name.
    assert.equal(deliverySettingsPatchSchema.parse({ emailUser: 'apikey' }).emailUser, 'apikey');
  });
});

describe('webhook URL shape', () => {
  it('refuses a URL with no scheme, which is the plausible paste', () => {
    // It used to store fine. Then `detectFormat` falls back to `generic` because
    // `new URL()` throws, and every send burns three attempts with 500ms/1s/2s
    // backoff before reporting `webhook request failed` — visible only to whoever
    // reads the logs. Refused where the operator is still looking at the field.
    const parsed = deliverySettingsPatchSchema.safeParse({
      webhookUrl: 'hooks.slack.com/services/T000/B000/xxx',
    });
    assert.equal(parsed.success, false);
    const message = parsed.success ? '' : parsed.error.issues.map((issue) => issue.message).join(' ');
    assert.match(message, /including the scheme/i);
  });

  it('accepts http as well as https', () => {
    // A generic JSON endpoint on an internal network is a legitimate target, and
    // refusing it would be inventing a policy nobody asked for.
    assert.equal(
      deliverySettingsPatchSchema.parse({ webhookUrl: 'https://hooks.slack.com/services/T/B/x' }).webhookUrl,
      'https://hooks.slack.com/services/T/B/x',
    );
    assert.equal(
      deliverySettingsPatchSchema.parse({ webhookUrl: 'http://collector.internal/hook' }).webhookUrl,
      'http://collector.internal/hook',
    );
  });

  it('refuses every other scheme', () => {
    // Which also keeps `javascript:` and `file:` out of a value that later gets
    // fetched.
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.test/hook', 'not a url']) {
      assert.equal(
        deliverySettingsPatchSchema.safeParse({ webhookUrl: url }).success,
        false,
        `expected ${url} to be refused`,
      );
    }
  });

  it('still allows clearing it', () => {
    // Null is how "fall back to the environment or the default" is expressed, and
    // a shape check must not take that away.
    assert.equal(deliverySettingsPatchSchema.parse({ webhookUrl: null }).webhookUrl, null);
  });

  it('trims before checking, so a pasted URL with whitespace is accepted', () => {
    assert.equal(
      deliverySettingsPatchSchema.parse({ webhookUrl: '  https://x.test/hook  ' }).webhookUrl,
      'https://x.test/hook',
    );
  });
});
