import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveFlowSettings,
  exporterList,
  FLOW_DEFAULTS,
  flowPinnedFields,
  parseFlowField,
  resolveFlowSettings,
} from './flow-settings.js';

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
});
