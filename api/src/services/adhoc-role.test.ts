import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { parse as parseConnectionString } from 'pg-connection-string';
import { adhocConnectionString, adhocRole } from './adhoc.service.js';

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
    // The SQL is `'nm_adhoc_' || left(md5(db), 16)`. Spelled out here rather
    // than described, so a change to either side that is not made to the other
    // fails.
    const database = 'x'.repeat(80);
    const expected = `nm_adhoc_${createHash('md5').update(database).digest('hex').slice(0, 16)}`;

    assert.equal(adhocRole(database), expected);
  });

  it('stays inside the limit for a multibyte name, which is where slicing broke', () => {
    // The budget is BYTES; a character slice let a multibyte name come in under
    // the character limit and over the byte one, so Postgres truncated at CREATE
    // ROLE while this side kept the full string. Nothing is truncated now, which
    // is what makes this hold rather than what documents it.
    const database = 'ネットワーク監視'.repeat(12);

    assert.ok(Buffer.byteLength(adhocRole(database)) <= LIMIT);
    assert.notEqual(adhocRole(database), adhocRole(`${database}x`));
  });

  it('is stable, so a restart reaches the same role', () => {
    assert.equal(adhocRole('netmonitoring'), adhocRole('netmonitoring'));
  });
});

describe('adhocConnectionString', () => {
  /*
   * The round-trip, asserted rather than reasoned about.
   *
   * This bug was reported three times and marked fixed twice before it was: the
   * `URL` setter percent-encodes some characters and leaves an existing `%`
   * alone, while `pg-connection-string` runs `decodeURIComponent` on the way
   * out — so a password containing `%` plus two hex digits authenticated with a
   * different string than `ALTER ROLE` had set. The console then failed its own
   * sandbox proof and reported a safety-check failure, which sent the reader to
   * look at the proof.
   *
   * Parsed with the same library the pool uses, because the question is not what
   * the URL looks like but what `pg` will read back out of it.
   */
  const parse = (url: string) => parseConnectionString(url);

  it('round-trips a password containing a percent escape', () => {
    // The exact value from the report. Character-by-character, `%41` is what
    // decodes to `A` and disappears.
    const password = 'p%41ss#w rd';
    const parsed = parse(adhocConnectionString('nm_adhoc_x', password));

    assert.equal(parsed.password, password);
  });

  it('round-trips the characters that broke it in other ways', () => {
    for (const password of ['a#b', 'a b', "a'b", 'a@b:c/d', 'a%%b', '100%']) {
      const parsed = parse(adhocConnectionString('nm_adhoc_x', password));
      assert.equal(parsed.password, password, `password ${password} did not survive the URL`);
    }
  });

  it('keeps the role it was given', () => {
    const parsed = parse(adhocConnectionString('nm_adhoc_netmonitoring', 'pw'));

    assert.equal(parsed.user, 'nm_adhoc_netmonitoring');
  });
});
