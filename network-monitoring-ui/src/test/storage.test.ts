import { describe, expect, it } from 'vitest';

/**
 * The storage the suite actually runs against, whichever implementation that is.
 *
 * These do not test a shim. They test the property every other test quietly
 * relies on: that stored keys are VISIBLE to enumeration. `auth.test.tsx` proves
 * login never persists the password by inspecting `{ ...localStorage }`, and an
 * implementation whose entries are hidden turns that into an assertion that
 * cannot fail — it would pass against a login storing the password in clear.
 *
 * That is not hypothetical. The first version of `setup.ts`'s Node 25 shim held
 * its entries in a private Map, so the spread came back `{}` however much was
 * stored, and the security test was vacuous for as long as it was in place.
 *
 * On a runtime with a real `Storage` these pass against jsdom's, which is the
 * point: the same guarantee, asserted the same way, whoever is providing it.
 */
describe('localStorage exposes its contents to enumeration', () => {
  it('lists a stored key', () => {
    localStorage.setItem('visible-key', 'value');

    expect(Object.keys(localStorage)).toContain('visible-key');
    expect({ ...localStorage }).toMatchObject({ 'visible-key': 'value' });
  });

  it('stops listing a key once it is removed', () => {
    localStorage.setItem('doomed', 'value');
    localStorage.removeItem('doomed');

    expect(Object.keys(localStorage)).not.toContain('doomed');
  });

  it('lists nothing after clear', () => {
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    localStorage.clear();

    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it('does not leak its own methods into a spread of the contents', () => {
    // The other half. Entries have to be enumerable and the API must not be, or
    // the password assertion drowns in `{"getItem": ..., "setItem": ...}` and
    // stops meaning anything for the opposite reason.
    localStorage.setItem('only-entry', 'value');

    expect(Object.keys(localStorage)).toEqual(['only-entry']);
  });

  it('reports length and key() over the same entries', () => {
    localStorage.setItem('one', '1');

    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe('one');
    expect(localStorage.key(1)).toBeNull();
  });

  it('answers null for a key it never stored, including one named like a method', () => {
    // A plain property read would hand back the prototype's function here.
    expect(localStorage.getItem('getItem')).toBeNull();
    expect(localStorage.getItem('never-set')).toBeNull();
  });

  it('coerces values to strings, as the spec requires', () => {
    // The difference that hides a `Boolean('false')` bug — see useStoredBoolean.
    localStorage.setItem('n', 42 as unknown as string);

    expect(localStorage.getItem('n')).toBe('42');
  });
});
