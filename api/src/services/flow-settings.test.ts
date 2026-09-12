import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveFlowSettings,
  exporterList,
  FLOW_DEFAULTS,
  flowPinnedFields,
  invalidFlowEnvironmentVariables,
  parseFlowField,
  resolveFlowSettings,
} from './flow-settings.js';
import { changedFlowFields } from './flow-settings.service.js';

/**
 * The flow settings resolver, in the parts that decide what an operator can do.
 *
 * The three-layer rule is not the interesting bit — delivery and the query
 * console already prove that shape works. What is worth pinning here is the
 * handful of decisions specific to this feature, every one of which is a way for
 * the form to be quietly wrong rather than visibly broken:
 *
 *  - **A blank environment variable does not pin.** The whole reason the shipped
 *    Compose file can pass these through at all — see `compose-unpinned.test.ts`
 *    — and therefore the whole reason a customer with no shell can use the form.
 *  - **A blank stored `exporters` does.** An administrator who clears the
 *    allowlist means "accept any sender", and treating that as "nobody has
 *    decided" would silently reinstate whatever the environment said. The two
 *    blanks look identical and mean opposite things.
 *  - **The defaults match `env.ts`.** They have to, or removing an environment
 *    line changes behaviour, which is the thing the seed exists to prevent.
 */

const noEnvironment: Record<string, string | undefined> = {};

describe('resolving the flow settings', () => {
  it('falls through to the code defaults when nothing is configured', () => {
    const resolution = resolveFlowSettings(noEnvironment, {});

    assert.deepEqual(effectiveFlowSettings(resolution), FLOW_DEFAULTS);
    assert.equal(resolution.enabled.source, 'default');
    assert.equal(resolution.port.source, 'default');
  });

  it('lets the environment win over the stored row', () => {
    const resolution = resolveFlowSettings({ FLOW_PORT: '4739' }, { port: 2055 });

    assert.equal(resolution.port.value, 4739);
    assert.equal(resolution.port.source, 'environment');
    assert.deepEqual(flowPinnedFields(resolution), ['port']);
  });

  it('treats a blank environment variable as no opinion', () => {
    /*
     * The property the shipped Compose file depends on. `FLOW_PORT: ${FLOW_PORT:-}`
     * arrives as an empty string, and if that counted as a value then every
     * deployment would be pinned by a file the customer cannot edit — which is
     * the bug this codebase has now shipped twice.
     */
    const resolution = resolveFlowSettings(
      { FLOW_ENABLED: '', FLOW_PORT: '', FLOW_BIND_ADDRESS: '' },
      { enabled: true, port: 4739 },
    );

    assert.equal(resolution.enabled.value, true);
    assert.equal(resolution.enabled.source, 'database');
    assert.equal(resolution.port.value, 4739);
    assert.deepEqual(flowPinnedFields(resolution), []);
  });

  it('keeps a cleared allowlist rather than falling back to the environment', () => {
    /*
     * The asymmetry, and the one genuinely fiddly rule here. An empty
     * `exporters` in the ROW is a decision — accept any sender — while an empty
     * one in the ENVIRONMENT is an unset Compose variable. Same characters,
     * opposite meanings, and getting it wrong would silently reinstate an
     * allowlist an administrator had deliberately emptied.
     */
    const resolution = resolveFlowSettings({ FLOW_EXPORTERS: '10.0.0.9' }, { exporters: '' });

    // The environment still wins while it is set...
    assert.equal(resolution.exporters.value, '10.0.0.9');

    // ...but with nothing in the environment, the cleared row is honoured rather
    // than falling through to the default.
    const unpinned = resolveFlowSettings({}, { exporters: '' });
    assert.equal(unpinned.exporters.value, '');
    assert.equal(unpinned.exporters.source, 'database');
  });

  it('refuses a port the socket could not bind rather than clamping it', () => {
    // Out of bounds is not a value: a privileged port cannot be bound by an
    // unprivileged container, and silently turning 80 into 1024 would make the
    // form and the collector disagree about what was saved.
    assert.equal(parseFlowField('port', '80'), undefined);
    assert.equal(parseFlowField('port', '70000'), undefined);
    assert.equal(parseFlowField('port', '2055'), 2055);
  });

  it('falls back rather than pinning when the environment holds nonsense', () => {
    // A value that does not parse is not a decision. Pinning the field to it
    // would disable the control and apply nothing, which is the worst of both.
    const resolution = resolveFlowSettings({ FLOW_PORT: 'two thousand' }, {});

    assert.equal(resolution.port.value, FLOW_DEFAULTS.port);
    assert.equal(resolution.port.source, 'default');
  });

  it('parses the allowlist the way the collector reads it', () => {
    // Whitespace and stray commas come from a text field somebody typed into.
    assert.deepEqual(exporterList({ ...FLOW_DEFAULTS, exporters: ' 10.0.0.1 , ,10.0.0.2,' }), [
      '10.0.0.1',
      '10.0.0.2',
    ]);
    assert.deepEqual(exporterList({ ...FLOW_DEFAULTS, exporters: '' }), []);
  });

  it('accepts one address per line, which is what the field asks for', () => {
    /*
     * The form's control is a two-row textarea, and the shape of a control is a
     * promise about its format. Splitting on commas alone turned three addresses
     * entered down the page into a single entry holding the whole block — not
     * empty, so the "blank accepts any sender" escape did not apply, just one
     * unmatchable address refusing every datagram while the form reported
     * "Saved, and in force".
     */
    const perLine = ['10.0.0.1', '10.0.0.2', '10.0.0.3'].join('\n');
    assert.deepEqual(exporterList({ ...FLOW_DEFAULTS, exporters: perLine }), [
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.3',
    ]);

    // Mixed, because a list somebody has edited twice ends up that way.
    const mixed = `10.0.0.1,\r\n 10.0.0.2 ;10.0.0.3`;
    assert.deepEqual(exporterList({ ...FLOW_DEFAULTS, exporters: mixed }), [
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.3',
    ]);
  });

  it('names an environment variable it had to ignore', () => {
    /*
     * An unusable value falls through to the next layer, which is right. What was
     * missing is that it happened in silence: the variable is in the operator's
     * Compose file, the collector is running on a different port, and the form
     * shows the field as editable rather than pinned — because a rejected value
     * does not pin. The one thing that would explain it is the line nobody wrote.
     */
    assert.deepEqual(invalidFlowEnvironmentVariables({ FLOW_PORT: '514', FLOW_ENABLED: 'maybe' }).sort(), [
      'FLOW_ENABLED',
      'FLOW_PORT',
    ]);
  });

  it('says nothing about a variable that is simply unset', () => {
    // Absent and blank are "nobody decided", not "this is wrong" — warning about
    // them would make the log noise on every deployment that uses the form.
    assert.deepEqual(invalidFlowEnvironmentVariables({ FLOW_PORT: '', FLOW_ENABLED: undefined }), []);
  });

  it('matches the defaults env.ts applies, so removing a line changes nothing', () => {
    /*
     * The two have to agree. The seed copies the environment into the row at
     * first boot precisely so that deleting a line later keeps the behaviour —
     * and that promise is only true if the code default underneath is the same
     * value the environment layer was supplying.
     */
    assert.equal(FLOW_DEFAULTS.enabled, false);
    assert.equal(FLOW_DEFAULTS.port, 2055);
    assert.equal(FLOW_DEFAULTS.bindAddress, '0.0.0.0');
    assert.equal(FLOW_DEFAULTS.exporters, '');
  });

  it('reports no change when a form is resubmitted unedited', () => {
    /*
     * `Object.keys(patch).length > 0` is not this check, and the difference is
     * what stops a no-op reattributing the last real change. It matters more here
     * than for the console, because the route deliberately accepts an empty patch
     * as "try binding again" — so a retry must not bump `updated_by` or append an
     * empty row to a trail that cannot be pruned.
     */
    const current = {
      id: 1,
      enabled: true,
      port: 2055,
      bindAddress: '0.0.0.0',
      exporters: '10.0.0.1',
      updatedAt: new Date(),
      updatedBy: 'someone@example.com',
    };

    assert.deepEqual(changedFlowFields(current, { port: 2055, exporters: '10.0.0.1' }), {});
    assert.deepEqual(changedFlowFields(current, { port: 4739 }), { port: 4739 });
  });

  it('counts every field on the first save, when there is no row to compare', () => {
    // `current` is undefined before anything is stored, so the whole patch is new
    // against nothing rather than silently diffing to empty.
    assert.deepEqual(changedFlowFields(undefined, { port: 2055 }), { port: 2055 });
  });
});
