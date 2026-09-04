import { useCallback, useState } from 'react';

/**
 * A boolean that survives a reload.
 *
 * Written for the sidebar's collapsed state, which is a preference rather than
 * application state: someone who works on a 13" laptop collapses it once and
 * expects it to stay collapsed, and re-expanding on every page load is the kind
 * of small betrayal that makes a tool feel unfinished.
 *
 * Deliberately NOT a general storage hook. It reads and writes one primitive and
 * treats anything it cannot parse as absent, because the failure mode of a
 * clever version — a stale JSON shape from an older release throwing inside a
 * state initialiser — is a blank screen, and no preference is worth that.
 *
 * Every access is guarded. `localStorage` is not merely empty in a private
 * window or with site data blocked; the property access itself throws, and this
 * runs during the first render of the shell.
 */
export function useStoredBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // Only the two values this hook writes count. Anything else — an older
      // format, something another script left behind — falls back rather than
      // being coerced, since `Boolean('false')` is `true`.
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch {
      // Storage unavailable. The preference is lost, the app is not.
    }
    return fallback;
  });

  /*
   * Written here rather than in an effect on `value`. An effect also fires on
   * mount, which would write the fallback back over a stored value in the one
   * case that matters — storage readable but the read having thrown — and it
   * would make the write a render-cycle behind the state it is persisting.
   */
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Same as above: the toggle still works for this session.
      }
    },
    [key],
  );

  return [value, set] as const;
}

export default useStoredBoolean;
