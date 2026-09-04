import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStoredBoolean } from './useStoredBoolean';

/**
 * The sidebar's remembered collapse state.
 *
 * The failure that matters is not "the preference was lost" — it is a throw
 * inside a state initialiser, which renders the whole shell as a blank page.
 * Half of these tests are about storage being hostile rather than about storage
 * working.
 */

const KEY = 'test.flag';

describe('useStoredBoolean', () => {
  it('falls back when nothing is stored', () => {
    const { result } = renderHook(() => useStoredBoolean(KEY, true));
    expect(result.current[0]).toBe(true);
  });

  it('reads a stored value in preference to the fallback', () => {
    localStorage.setItem(KEY, 'true');
    const { result } = renderHook(() => useStoredBoolean(KEY, false));
    expect(result.current[0]).toBe(true);
  });

  it('reads a stored false rather than treating it as absent', () => {
    // The one that a naive `stored ?? fallback` plus `Boolean(...)` gets wrong,
    // and the more common state of the two for this preference.
    localStorage.setItem(KEY, 'false');
    const { result } = renderHook(() => useStoredBoolean(KEY, true));
    expect(result.current[0]).toBe(false);
  });

  it('ignores a value it did not write', () => {
    localStorage.setItem(KEY, '{"collapsed":true}');
    const { result } = renderHook(() => useStoredBoolean(KEY, false));
    expect(result.current[0]).toBe(false);
  });

  it('persists a change immediately, not a render later', () => {
    const { result } = renderHook(() => useStoredBoolean(KEY, false));
    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('does not write the fallback over a stored value on mount', () => {
    localStorage.setItem(KEY, 'true');
    renderHook(() => useStoredBoolean(KEY, false));
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('survives storage that throws on read', () => {
    // A private window, or a browser set to block site data: the access itself
    // throws, during the first render of the shell.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const { result } = renderHook(() => useStoredBoolean(KEY, true));
    expect(result.current[0]).toBe(true);

    getItem.mockRestore();
  });

  it('survives storage that throws on write, and still toggles', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = renderHook(() => useStoredBoolean(KEY, false));
    act(() => result.current[1](true));
    // The preference is lost for the next session; it must not be lost for this one.
    expect(result.current[0]).toBe(true);

    setItem.mockRestore();
  });
});
