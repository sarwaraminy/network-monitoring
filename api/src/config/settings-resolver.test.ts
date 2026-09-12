import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createResolver, type FieldSpec } from './settings-resolver.js';

/**
 * The layer walk, on its own.
 *
 * Three features resolved settings this way with three hand-written copies, and
 * the rules below are the ones that were actually got wrong in at least one of
 * them at least once. They are asserted here against a made-up field table rather
 * than through any real feature, because the point of extracting this was that
 * the rule is the same rule whatever it is resolving — and a test that reaches
 * for `DELIVERY_FIELDS` to check it would be asserting the rule three times
 * again, one per caller.
 *
 * Each domain's own suite still covers its own parser and its own fields, and
 * those are what prove this did not change behaviour.
 */

interface Demo {
  enabled: boolean;
  port: number;
  label: string;
  list: string;
  secret: string;
}

const FIELDS: Record<keyof Demo, FieldSpec> = {
  enabled: { env: 'DEMO_ENABLED' },
  port: { env: 'DEMO_PORT' },
  label: { env: 'DEMO_LABEL' },
  // The exception, and the only one: a cleared list means "no filter".
  list: { env: 'DEMO_LIST', clearedValue: '' },
  secret: { env: 'DEMO_SECRET', secret: true },
};

const DEFAULTS: Demo = { enabled: false, port: 2055, label: 'default', list: 'a,b', secret: '' };

/** A deliberately plain parser: this suite is about the walk, not the parsing. */
const parse = (field: keyof Demo & string, raw: unknown): unknown => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string' && raw.trim() === '') return undefined;

  if (field === 'enabled') {
    const text = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(text)) return true;
    if (['false', '0', 'no'].includes(text)) return false;
    return undefined;
  }

  if (field === 'port') {
    const value = Number(String(raw).trim());
    return Number.isInteger(value) ? value : undefined;
  }

  return String(raw).trim();
};

const resolver = createResolver({ fields: FIELDS, defaults: DEFAULTS, parse });

describe('the three-layer settings walk', () => {
  it('falls through to the code defaults when nothing is configured', () => {
    const resolution = resolver.resolve({}, {});

    assert.deepEqual(resolver.effective(resolution), DEFAULTS);
    assert.equal(resolution.port.source, 'default');
  });

  it('lets the environment win over the stored row', () => {
    const resolution = resolver.resolve({ DEMO_PORT: '4739' }, { port: 2055 });

    assert.equal(resolution.port.value, 4739);
    assert.equal(resolution.port.source, 'environment');
    assert.deepEqual(resolver.pinned(resolution), ['port']);
  });

  it('treats a blank environment variable as no opinion', () => {
    /*
     * The property every shipped deployment file depends on, and the one that
     * went wrong twice. `DEMO_PORT: ${DEMO_PORT:-}` arrives as an empty string,
     * and if that counted as a value then every Compose deployment would be
     * pinned by a file the customer cannot edit — which is the whole reason the
     * settings forms exist.
     */
    const resolution = resolver.resolve(
      { DEMO_ENABLED: '', DEMO_PORT: '   ', DEMO_LABEL: '' },
      { enabled: true, port: 4739, label: 'stored' },
    );

    assert.equal(resolution.enabled.value, true);
    assert.equal(resolution.enabled.source, 'database');
    assert.equal(resolution.port.value, 4739);
    assert.equal(resolution.label.value, 'stored');
    assert.deepEqual(resolver.pinned(resolution), []);
  });

  it('falls back rather than pinning when the environment holds nonsense', () => {
    // A value that does not parse is not a decision. Pinning the field to it
    // would disable the control and apply nothing, the worst of both.
    const resolution = resolver.resolve({ DEMO_PORT: 'two thousand' }, { port: 4739 });

    assert.equal(resolution.port.value, 4739);
    assert.equal(resolution.port.source, 'database');
    assert.deepEqual(resolver.pinned(resolution), []);
  });

  it('names a variable it had to ignore', () => {
    // The half that was missing from all three copies until each had it added:
    // falling through in silence leaves every piece of evidence pointing the
    // wrong way, because a rejected value does not pin and the form therefore
    // shows the field as editable.
    assert.deepEqual(resolver.invalidEnvironment({ DEMO_PORT: '1.5', DEMO_ENABLED: 'maybe' }).sort(), [
      'DEMO_ENABLED',
      'DEMO_PORT',
    ]);
  });

  it('says nothing about a variable that is simply unset', () => {
    assert.deepEqual(resolver.invalidEnvironment({ DEMO_PORT: '', DEMO_ENABLED: undefined }), []);
  });

  it('keeps a cleared value where blank is a decision, and only there', () => {
    /*
     * The asymmetry, and the one genuinely fiddly rule. An empty value in the
     * ROW is a choice for a field that declares a `clearedValue`; an empty one
     * in the ENVIRONMENT is an unset Compose variable, for every field including
     * that one. Same characters, opposite meanings.
     */
    const cleared = resolver.resolve({}, { list: '', label: '' });

    assert.equal(cleared.list.value, '', 'a cleared list is a decision');
    assert.equal(cleared.list.source, 'database');

    // The ordinary field goes the other way: blank in the row is still a gap.
    assert.equal(cleared.label.value, 'default');
    assert.equal(cleared.label.source, 'default');
  });

  it('still treats a blank environment value as unset for that same field', () => {
    // The half of the asymmetry that is easy to lose: the exception is about the
    // row, never about the variable.
    const resolution = resolver.resolve({ DEMO_LIST: '' }, {});

    assert.equal(resolution.list.value, 'a,b');
    assert.equal(resolution.list.source, 'default');
  });

  it('names the variables a patch would be fighting', () => {
    const resolution = resolver.resolve({ DEMO_PORT: '4739', DEMO_ENABLED: 'true' }, {});

    // Only the pinned fields the patch actually touches, as variable names —
    // because the remedy is removing a line from a file.
    assert.deepEqual(resolver.conflicts(resolution, { port: 1, label: 'x' }), ['DEMO_PORT']);
    assert.deepEqual(resolver.conflicts(resolution, { label: 'x' }), []);
  });

  it('still parses a NON-blank value on a field that can be cleared', () => {
    /*
     * The trap in the first version, which tested the flag rather than the value:
     * every stored string on such a field bypassed the parser, not just a blank
     * one. Harmless for a field whose parser only trims — which is why it did no
     * damage — and waiting for the obvious next adopter, a comma-separated list,
     * whose stored value would have resolved to the raw string instead of the
     * array. The length of that string then reads as the number of entries.
     *
     * Asserted through the spy, because the bug is about whether the parser RAN
     * rather than about what came out of it: for this demo's parser the two
     * results are identical, which is exactly the condition that hid it.
     */
    const seen: unknown[] = [];
    const spy = createResolver({
      fields: FIELDS,
      defaults: DEFAULTS,
      parse: (field, raw) => {
        if (field === 'list') seen.push(raw);
        return parse(field, raw);
      },
    });

    const resolution = spy.resolve({}, { list: ' a , b ' });

    assert.deepEqual(seen, [' a , b '], 'a non-blank stored value skipped the parser');
    assert.equal(resolution.list.value, 'a , b');
    assert.equal(resolution.list.source, 'database');
  });

  it('does not consult the parser for a cleared value', () => {
    // The other half: a blank is the declared cleared value, and the parser is
    // not asked — it would answer `undefined`, which is what falling through to
    // the environment looks like, and is the thing being prevented.
    const seen: unknown[] = [];
    const spy = createResolver({
      fields: FIELDS,
      defaults: DEFAULTS,
      parse: (field, raw) => {
        if (field === 'list') seen.push(raw);
        return parse(field, raw);
      },
    });

    assert.equal(spy.resolve({}, { list: '   ' }).list.value, '');
    assert.deepEqual(seen, []);
  });

  it('reports which fields are credentials', () => {
    assert.equal(resolver.isSecret('secret'), true);
    assert.equal(resolver.isSecret('label'), false);
  });

  it('hands every layer to the parser, so a domain rule applies everywhere', () => {
    /*
     * The parser is a parameter because the three domains disagree about blanks,
     * unrecognised booleans, integer bounds and trimming — every difference
     * deliberate and documented. What must not vary is WHERE it is consulted: a
     * value from the row gets the same treatment as one from the environment, or
     * a field could be storable and unpinnable with the same characters.
     */
    const seen: { field: string; raw: unknown }[] = [];
    const spy = createResolver({
      fields: FIELDS,
      defaults: DEFAULTS,
      parse: (field, raw) => {
        seen.push({ field, raw });
        return parse(field, raw);
      },
    });

    spy.resolve({ DEMO_PORT: '4739' }, { label: 'stored' });

    assert.ok(
      seen.some((call) => call.field === 'port' && call.raw === '4739'),
      'the environment layer was not parsed',
    );
    assert.ok(
      seen.some((call) => call.field === 'label' && call.raw === 'stored'),
      'the stored layer was not parsed',
    );
  });
});

/*
 * A field with no counterpart in the settings type must not compile.
 *
 * `@ts-expect-error` rather than a runtime assertion, because the failure this
 * guards is a type that quietly stops constraining: if `ExactFields` is ever
 * loosened, this line stops erroring and `@ts-expect-error` becomes an error
 * itself, so the repository's existing `tsc --noEmit` step fails. A runtime
 * check could not see it at all.
 *
 * `Record<keyof S, FieldSpec>` was the original spelling and accepted this
 * silently — a stray entry then resolves to `{ value: undefined }` and reaches
 * the admin form as an empty control that saves nothing. The mapped form
 * `{ [K in keyof S]: FieldSpec }` accepts it too; they are the same type.
 */
createResolver({
  // @ts-expect-error - `ghost` is not a key of Demo
  fields: { ...FIELDS, ghost: { env: 'DEMO_GHOST' } },
  defaults: DEFAULTS,
  parse,
});
