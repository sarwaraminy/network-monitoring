import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openTestDatabase } from '../test/database.js';

/**
 * What the seed copies out of the environment, and the one field it must not.
 *
 * The seed exists so that removing an environment line keeps the behaviour it was
 * producing: an installation configured entirely through variables would
 * otherwise show every field as "from the environment", editable nowhere, and
 * deleting a line would revert it to a default nobody chose.
 *
 * `enabled` is the exception, because of what pins it. `docker-compose.flow.yml`
 * writes `FLOW_ENABLED: 'true'` into itself — not passed through like the rest —
 * and publishes the UDP port in the same block; its header calls the two
 * inseparable. Switching collection on is what that file *is*.
 *
 * So seeding it takes the off switch away from the deployment that has it. The
 * first boot under the overlay copies `true` into the row, and from then on the
 * row carries it independently of the file. Removing the overlay to stop
 * collecting — the documented way to stop collecting — leaves a collector holding
 * a socket open on a value from a file that no longer exists, presented in the
 * admin form as an ordinary editable setting with nothing connecting the two.
 *
 * Driven against a real row rather than a stub, because what is under test is the
 * `setWhere ... IS NULL` insert and what the resolver then makes of a column that
 * was left alone. A mock of either would only restate the thing being checked.
 */

process.env.NODE_ENV = 'test';
process.env.SENSOR_ID = 'flow-seed-sensor';

const database = await openTestDatabase({ id: 'flowseed' });

let seedFlowSettingsFromEnvironment: typeof import('./flow-settings.service.js').seedFlowSettingsFromEnvironment;
let resolveFlowSettings: typeof import('./flow-settings.js').resolveFlowSettings;

interface Row {
  enabled: boolean | null;
  port: number | null;
  bind_address: string | null;
  exporters: string | null;
}

const readRow = async (): Promise<Row | undefined> => {
  const { rows } = await database.pool!.query<Row>(
    'SELECT enabled, port, bind_address, exporters FROM flow_settings WHERE id = 1',
  );
  return rows[0];
};

/** The overlay's own environment block, as Compose would deliver it. */
const OVERLAY = { FLOW_ENABLED: 'true', FLOW_PORT: '2055', FLOW_BIND_ADDRESS: '0.0.0.0' };

describe('seeding the flow settings from the environment', { skip: database.skip }, () => {
  before(async () => {
    ({ seedFlowSettingsFromEnvironment } = await import('./flow-settings.service.js'));
    ({ resolveFlowSettings } = await import('./flow-settings.js'));
  });

  beforeEach(async () => {
    await database.pool!.query('DELETE FROM flow_settings');
    for (const [key, value] of Object.entries(OVERLAY)) process.env[key] = value;
    process.env.FLOW_EXPORTERS = '10.0.0.1,10.0.0.2';
  });

  after(async () => {
    await database.pool?.end();
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  it('copies the settings an administrator should inherit and then own', async () => {
    const seeded = await seedFlowSettingsFromEnvironment();

    assert.deepEqual(seeded.sort(), ['bindAddress', 'exporters', 'port']);

    const row = await readRow();
    assert.equal(row?.port, 2055);
    assert.equal(row?.bind_address, '0.0.0.0');
    assert.equal(row?.exporters, '10.0.0.1,10.0.0.2');
  });

  it('leaves the switch alone, so the overlay keeps meaning what it says', async () => {
    await seedFlowSettingsFromEnvironment();

    const row = await readRow();
    assert.equal(
      row?.enabled,
      null,
      'FLOW_ENABLED was persisted, so the deployment that turned collection on can no longer turn it off',
    );
  });

  it('stops collecting when the overlay is removed', async () => {
    /*
     * The failure this is all for, end to end. Boot under the overlay, seed,
     * then take the overlay away — which is how the documentation says to stop
     * collecting — and resolve against the row that the seeded boot left behind.
     */
    await seedFlowSettingsFromEnvironment();
    const row = await readRow();

    const withoutOverlay = resolveFlowSettings(
      {},
      {
        enabled: row?.enabled ?? undefined,
        port: row?.port ?? undefined,
        bindAddress: row?.bind_address ?? undefined,
        exporters: row?.exporters ?? undefined,
      },
    );

    assert.equal(withoutOverlay.enabled.value, false);
    assert.equal(withoutOverlay.enabled.source, 'default');

    // And the rest of the configuration survives, which is the half the seed is
    // for: the port and the allowlist are still there to switch back on.
    assert.equal(withoutOverlay.port.value, 2055);
    assert.equal(withoutOverlay.exporters.value, '10.0.0.1,10.0.0.2');
  });

  it('never overwrites a value an administrator has chosen', async () => {
    // The rule the seed already had, asserted beside the new one because the two
    // are easy to conflate: "only where nobody decided" is about the row, and
    // `enabled` is excluded whatever the row says.
    await database.pool!.query('INSERT INTO flow_settings (id, port, updated_by) VALUES (1, 9999, $1)', [
      'someone@example.test',
    ]);

    const seeded = await seedFlowSettingsFromEnvironment();

    assert.equal(seeded.includes('port'), false);
    assert.equal((await readRow())?.port, 9999);
  });

  it('turns collection on from the row when an administrator saved it there', async () => {
    /*
     * The other side of excluding `enabled`, and the reason excluding it costs
     * nothing: an administrator who switches collection on in the form writes a
     * real `true` to this column, and that survives everything the seed does.
     * What is refused is the environment writing it on their behalf.
     */
    await database.pool!.query('INSERT INTO flow_settings (id, enabled, updated_by) VALUES (1, true, $1)', [
      'someone@example.test',
    ]);
    await seedFlowSettingsFromEnvironment();

    const row = await readRow();
    const resolved = resolveFlowSettings({}, { enabled: row?.enabled ?? undefined });

    assert.equal(resolved.enabled.value, true);
    assert.equal(resolved.enabled.source, 'database');
  });
});
