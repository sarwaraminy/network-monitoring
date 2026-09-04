import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { adhocRole } from './adhoc.service.js';

/**
 * The console's role name, which two languages have to agree on.
 *
 * `V11__Adhoc_role_per_database.sql` builds it in SQL and this builds it in
 * TypeScript, and `proveSandbox` compares the TypeScript answer against
 * `current_user`. They agree by both implementing the same rule, so the rule is
 * pinned here — the failure when they drift is an error comparing two strings
 * that are identical for as far as a reader gets, over a role that does exist.
 *
 * No database needed: this is a pure function about names.
 */

const LIMIT = 63;

describe('adhocRole', () => {
  it('names the role for its database', () => {
    assert.equal(adhocRole('netmonitoring'), 'nm_adhoc_netmonitoring');
  });

  it('stays inside the identifier limit for a long database name', () => {
    // Postgres truncates silently past 63 bytes, which is how the two sides
    // start naming different roles with no error saying so.
    const long = 'netmonitoring_some_rather_long_suite_name_that_keeps_going_test';
    assert.ok(Buffer.byteLength(adhocRole(long)) <= LIMIT, 'the role name exceeds the identifier limit');
  });

  it('keeps two long names distinct rather than colliding', () => {
    // Truncation alone would map both of these onto one role — the shared-role
    // collision V11 exists to remove, reintroduced by the fix for the limit.
    const a = adhocRole(`netmonitoring_${'a'.repeat(60)}_first`);
    const b = adhocRole(`netmonitoring_${'a'.repeat(60)}_second`);

    assert.notEqual(a, b);
    assert.ok(Buffer.byteLength(a) <= LIMIT);
    assert.ok(Buffer.byteLength(b) <= LIMIT);
  });

  it('uses the same rule the migration does', () => {
    // The SQL is `left('nm_adhoc_' || db, 54) || '_' || left(md5(db), 8)`.
    // Spelled out here rather than described, so a change to either side that
    // does not change the other fails.
    const database = 'x'.repeat(80);
    const expected = `${`nm_adhoc_${database}`.slice(0, 54)}_${createHash('md5')
      .update(database)
      .digest('hex')
      .slice(0, 8)}`;

    assert.equal(adhocRole(database), expected);
  });

  it('is stable, so a restart reaches the same role', () => {
    assert.equal(adhocRole('netmonitoring'), adhocRole('netmonitoring'));
  });
});
