import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { orderMigrationFiles } from './migrate.js';

/**
 * The filename half of the migration runner, which is where a version collision
 * has to be caught.
 *
 * Two files sharing a `V14__` prefix used to be reported as something else
 * entirely — a duplicate key on `schema_migrations` on a fresh database, or a
 * *changed migration* on one that already had version 14, because the second
 * file's checksum was compared against the first file's recorded row. Both
 * messages send the reader looking for a problem that is not there, and neither
 * mentions that a second file exists.
 *
 * Tested through `orderMigrationFiles` rather than through `runMigrations`,
 * because the check has to happen before the first file is read and that is the
 * one thing an end-to-end test of the runner could not tell you: a runner that
 * read every file and then complained would pass it.
 */
describe('migration filenames', () => {
  it('orders by numeric version rather than lexically', () => {
    // The reason this is not a plain `sort()`: V2 before V10, and V1 before V2.
    const ordered = orderMigrationFiles(['V10__ten.sql', 'V2__two.sql', 'V1__one.sql']);
    assert.deepEqual(
      ordered.map((entry) => entry.version),
      ['1', '2', '10'],
    );
  });

  it('turns the underscores of a filename into a readable name', () => {
    const [entry] = orderMigrationFiles(['V18__Capture_session.sql']);
    assert.equal(entry?.name, 'Capture session');
  });

  it('skips a file that is not named like a migration', () => {
    // Warned about and ignored, not fatal: a README or an editor's backup file
    // in that directory is not a broken migration.
    assert.deepEqual(
      orderMigrationFiles(['notes.sql', 'V3__three.sql']).map((e) => e.file),
      ['V3__three.sql'],
    );
  });

  it('refuses two files claiming one version, naming both', () => {
    assert.throws(
      () => orderMigrationFiles(['V13__Email_oauth2.sql', 'V14__Adhoc_settings.sql', 'V14__Other.sql']),
      (error: Error) => {
        assert.match(error.message, /V14/);
        // Both files, because the whole failure of the old behaviour was
        // reporting one file's problem without saying the other existed.
        assert.match(error.message, /V14__Adhoc_settings\.sql/);
        assert.match(error.message, /V14__Other\.sql/);
        // And not the file that is merely adjacent.
        assert.doesNotMatch(error.message, /V13/);
        return true;
      },
    );
  });

  it('refuses two spellings of the same version, which sort equal', () => {
    // `compareVersions` splits on both separators, so these two are one version
    // to everything downstream even though the strings differ.
    assert.throws(() => orderMigrationFiles(['V1.2__a.sql', 'V1_2__b.sql']), /V1\.2/);
  });

  it('refuses a trailing-zero spelling of a version already used', () => {
    /*
     * The case the first version of this guard let through, and the likelier of
     * the two: joining the raw components gave `"19"` and `"19.0"` — different
     * keys for two versions `compareVersions` pads to equality and cannot order.
     * The apply order between them then fell to `readdir`, which differs between
     * filesystems, so the same repository could migrate in one order locally and
     * the other in CI.
     */
    assert.throws(
      () => orderMigrationFiles(['V19__a.sql', 'V19.0__b.sql']),
      (error: Error) => {
        assert.match(error.message, /V19__a\.sql/);
        assert.match(error.message, /V19\.0__b\.sql/);
        return true;
      },
    );
  });

  it('still tells genuinely different versions apart', () => {
    // The normalisation drops trailing zeros only, so it must not collapse a
    // version whose last component is a real number — otherwise the guard starts
    // refusing correctly numbered files, which is the expensive false positive.
    const ordered = orderMigrationFiles(['V19.1__a.sql', 'V19__b.sql', 'V19.10__c.sql']);
    assert.deepEqual(
      ordered.map((entry) => entry.file),
      ['V19__b.sql', 'V19.1__a.sql', 'V19.10__c.sql'],
    );
  });

  it('reports every collision, not only the first', () => {
    assert.throws(
      () => orderMigrationFiles(['V4__a.sql', 'V4__b.sql', 'V9__c.sql', 'V9__d.sql']),
      (error: Error) => {
        assert.match(error.message, /V4/);
        assert.match(error.message, /V9/);
        return true;
      },
    );
  });

  it('accepts the migrations this repository actually ships', async () => {
    // The standing check. The guard above is worth nothing if the directory it
    // guards is already in the state it refuses.
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql'));
    assert.ok(files.length > 0, 'found no migrations to check');
    const ordered = orderMigrationFiles(files);
    assert.equal(ordered.length, files.length, 'a shipped migration is not named like one');
  });
});
