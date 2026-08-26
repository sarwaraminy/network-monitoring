import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../middleware/error-handler.js';
import {
  alertDashboardQuerySchema,
  alertListQuerySchema,
  captureStartSchema,
  idSchema,
  ipAddressSchema,
  loginSchema,
  logSchema,
  parseId,
  parseSince,
  signupSchema,
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

  it('bounds days to a year', () => {
    assert.equal(alertDashboardQuerySchema.parse(q({ days: '365' })).days, 365);
    assert.equal(alertDashboardQuerySchema.safeParse(q({ days: '366' })).success, false);
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
