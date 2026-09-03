import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The audit trail, in the parts that do not need Postgres.
 *
 * The substance of this feature is a transaction — delete the row, append the
 * record, both or neither — and mocking a database to assert that would be testing
 * the mock. That half is verified against a real server and written up in the pull
 * request. What is pinned here is everything that could go wrong quietly:
 *
 *  - **The vocabulary the code writes must be one the database accepts.** The
 *    `action` column has a CHECK constraint on its shape, and an action added in
 *    TypeScript that violates it would not fail here or in review — it would fail
 *    at the moment somebody deleted a finding, which is the worst available time
 *    and place, and on the path where the exception aborts the deletion too.
 *  - **A settings change must not record credential values.** The trail cannot be
 *    pruned and any administrator can read it, so a leak into it is permanent.
 *  - **An update entry must record only what changed**, or every edit becomes a
 *    wall of unchanged fields that nobody reads.
 */

let audit: typeof import('./audit.service.js');
let settings: typeof import('../notify/settings.service.js');
let suppression: typeof import('./suppression.service.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '..', 'db', 'migrations', 'V9__Audit_trail.sql');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  // Nothing here opens a connection: every function under test is pure. Pointed
  // somewhere unreachable so that stops being true loudly rather than silently.
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/should-never-connect';
  audit = await import('./audit.service.js');
  settings = await import('../notify/settings.service.js');
  suppression = await import('./suppression.service.js');
});

describe('the action vocabulary', () => {
  /**
   * The CHECK constraint, read out of the migration rather than copied here.
   *
   * A second copy of the pattern would agree with the first exactly until somebody
   * changed one of them, which is the failure this whole family of tests exists to
   * catch. Reading the migration means the assertion is against what the database
   * will actually enforce.
   */
  function checkPattern(): RegExp {
    const sql = readFileSync(MIGRATION, 'utf8');
    const match = sql.match(/audit_events_action_shape\s+CHECK \(action ~ '([^']+)'\)/);
    assert.ok(match, 'could not find the action CHECK constraint in V9__Audit_trail.sql');
    return new RegExp(match[1]!);
  }

  it('is not empty', () => {
    // A vocabulary that had become empty would make every assertion below vacuous.
    assert.ok(Object.keys(audit.AUDIT_ACTIONS).length >= 10);
  });

  it('every action satisfies the constraint the database will apply', () => {
    const pattern = checkPattern();

    for (const action of Object.keys(audit.AUDIT_ACTIONS)) {
      assert.match(
        action,
        pattern,
        `'${action}' would be rejected by audit_events_action_shape, and the rejection would ` +
          'surface as a failed deletion rather than as a failed test',
      );
    }
  });

  it('rejects the shapes that constraint exists to refuse', () => {
    // Proving the pattern read above is doing work, rather than being something
    // permissive that everything happens to satisfy.
    const pattern = checkPattern();

    for (const bad of [
      'Deleted an alert',
      'alert',
      'alert.',
      '.delete',
      'alert.delete.now',
      'Alert.delete',
      '',
    ]) {
      assert.doesNotMatch(bad, pattern, `'${bad}' should not be a valid action`);
    }
  });

  it('gives every action a label a reader can understand', () => {
    // The UI filter is built from this map, so an action with a blank or
    // placeholder label would ship as an unexplained row in the trail.
    for (const [action, label] of Object.entries(audit.AUDIT_ACTIONS)) {
      assert.ok(label.trim().length > 3, `${action} has no usable label`);
      assert.doesNotMatch(label, /^[a-z_]+\.[a-z_]+$/, `${action}'s label is just the action again`);
    }
  });
});

describe('who is recorded', () => {
  const asUser = (fields: Record<string, unknown>) =>
    fields as unknown as Parameters<typeof audit.actorOf>[0];

  it('uses the email, which is what a reader recognises', () => {
    assert.deepEqual(audit.actorOf(asUser({ id: 7, email: 'sam@example.com', role: 'ADMIN' })), {
      name: 'sam@example.com',
      id: 7,
    });
  });

  it('records the account id as well as the email', () => {
    /*
     * Both columns, because they answer different questions: `actor` survives the
     * account being renamed or deleted, and `actor_id` is what tells two accounts
     * apart when an address is reused. The first version returned only the string,
     * so `actor_id` was NULL on every row — the disambiguator the migration argues
     * for, never written, and invisible because the UI fixture supplied one.
     */
    assert.equal(audit.actorOf(asUser({ id: 42, email: 'sam@example.com' })).id, 42);
  });

  it('falls back to the id rather than producing a blank', () => {
    // `actor` is NOT NULL with a non-blank CHECK, so an undefined here would be a
    // constraint violation on the deletion path. Unreachable behind requireAuth,
    // which is exactly why it is spelled out instead of left to chance.
    assert.equal(audit.actorOf(asUser({ id: 7, email: null })).name, 'user:7');
  });

  it('says something even with no user at all', () => {
    assert.deepEqual(audit.actorOf(undefined), { name: 'user:unknown', id: null });
  });

  it('never returns a blank name, whatever it is handed', () => {
    for (const user of [undefined, {}, { id: null }, { email: '' }, { email: '   ' }]) {
      const actor = audit.actorOf(user === undefined ? undefined : asUser(user));
      assert.notEqual(actor.name.trim(), '', `blank actor for ${JSON.stringify(user)}`);
    }
  });
});

describe('a delivery-settings change', () => {
  it('records which fields changed', () => {
    const detail = settings.settingsAuditDetail({
      webhookUrl: 'https://hooks.example.com/abc',
      emailPort: 587,
    });

    assert.deepEqual(detail, { fields: ['emailPort', 'webhookUrl'] });
  });

  it('records no value, for any field, ever', () => {
    /*
     * The assertion that matters. Two of these are credentials — a webhook URL is
     * a bearer token in a query string, and the email password is a password —
     * and the audit trail cannot be pruned, so anything that reaches it is there
     * for the life of the installation.
     */
    const secrets = {
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/xoxb-secret-token',
      emailPassword: 'correct-horse-battery-staple',
      emailUser: 'alerts@example.com',
    };
    const serialised = JSON.stringify(settings.settingsAuditDetail(secrets));

    for (const value of Object.values(secrets)) {
      assert.ok(!serialised.includes(value), `the audit detail leaked ${value}`);
    }
    // And it is not empty either — "records nothing" would pass the check above.
    assert.deepEqual(JSON.parse(serialised), {
      fields: ['emailPassword', 'emailUser', 'webhookUrl'],
    });
  });

  it('is stable in order, so two identical changes read identically', () => {
    assert.deepEqual(
      settings.settingsAuditDetail({ emailPort: 1, webhookUrl: 'x' }),
      settings.settingsAuditDetail({ webhookUrl: 'y', emailPort: 2 }),
    );
  });
});

describe('a suppression rule change', () => {
  const rule = {
    kind: 'port_scan',
    sourceCidr: '10.0.0.0/8',
    targetCidr: null,
    port: null,
    reason: 'the vulnerability scanner',
    enabled: true,
    expiresAt: null,
  };

  it('records only the fields that moved', () => {
    const changed = suppression.ruleChanges(
      { ...rule } as Parameters<typeof suppression.ruleChanges>[0],
      { ...rule, reason: 'the new scanner' } as Parameters<typeof suppression.ruleChanges>[1],
    );

    assert.deepEqual(changed, { reason: { from: 'the vulnerability scanner', to: 'the new scanner' } });
  });

  it('records both sides, because "reason changed" is not an answer', () => {
    const changed = suppression.ruleChanges(
      { ...rule } as Parameters<typeof suppression.ruleChanges>[0],
      { ...rule, enabled: false } as Parameters<typeof suppression.ruleChanges>[1],
    );

    assert.deepEqual(changed, { enabled: { from: true, to: false } });
  });

  it('is empty when nothing moved', () => {
    // A PATCH that changes nothing is a real thing — the UI sends the whole form —
    // and recording it as though every field had changed would bury the edits that
    // did happen.
    assert.deepEqual(
      suppression.ruleChanges(
        { ...rule } as Parameters<typeof suppression.ruleChanges>[0],
        { ...rule } as Parameters<typeof suppression.ruleChanges>[1],
      ),
      {},
    );
  });

  it('notices a criterion being widened to nothing', () => {
    // Removing a criterion makes a rule match *more*, which is the direction that
    // matters: a rule losing its source range starts suppressing the whole network.
    const changed = suppression.ruleChanges(
      { ...rule } as Parameters<typeof suppression.ruleChanges>[0],
      { ...rule, sourceCidr: null } as Parameters<typeof suppression.ruleChanges>[1],
    );

    assert.deepEqual(changed, { sourceCidr: { from: '10.0.0.0/8', to: null } });
  });
});
