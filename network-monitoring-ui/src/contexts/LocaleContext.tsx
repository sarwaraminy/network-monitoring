import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { setErrorLocale } from '../api/client';
import { DEFAULT_LOCALE, isLocale, isRtl, type Locale, resolveLocale } from '../i18n/generated/locales';
import { useAuth } from './AuthContext';

/**
 * Which language this browser reads the application in.
 *
 * Three sources, most specific first:
 *
 *  1. **An explicit choice**, kept in `localStorage`. A preference rather than
 *     application state, like the sidebar's collapsed width — and per browser
 *     rather than per account on purpose, because the person who switches to
 *     German to check a translation is usually signed in as themselves.
 *  2. **The signed-in account's `lang_code`**, which is what finally gives that
 *     column a meaning. It has existed since V1, is `NOT NULL`, defaults to `en`,
 *     is written by sign-up and by the user CLI, and until now nothing read it.
 *  3. **The browser's own languages**, so a first visit to the sign-in page — where
 *     there is no account yet — is already in the right language if we have it.
 *
 * `dir` rides along because every consumer that needs one needs the other: the
 * MUI theme, the `dir` attribute on the document, and any component deciding which
 * side a chevron points at.
 */

interface LocaleContextValue {
  locale: Locale;
  /** `null` restores the automatic choice rather than pinning English. */
  setLocale: (locale: Locale | null) => void;
  /** True when the current locale is written right to left. */
  rtl: boolean;
  dir: 'ltr' | 'rtl';
  /** True when the locale came from an explicit choice rather than being inferred. */
  isPinned: boolean;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

const STORAGE_KEY = 'nm.locale';

/**
 * The stored choice, or null.
 *
 * Guarded for the reason `useStoredBoolean` documents: in a private window or with
 * site data blocked the property access itself throws, and this runs during the
 * first render of the shell. Anything unrecognised — a locale we used to ship, a
 * value another script left behind — is treated as absent rather than coerced.
 */
function storedLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The best locale the browser itself asks for.
 *
 * `navigator.languages` in order, so `['de-CH', 'de', 'en']` reaches German
 * through the region-stripping in `resolveLocale` rather than falling to English
 * because the exact tag is not one of ours. Returns null when nothing matches, so
 * the caller can tell "the browser wants English" from "the browser wants
 * something we do not have".
 */
function browserLocale(): Locale | null {
  const tags = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of tags) {
    if (!tag) continue;
    const resolved = resolveLocale(tag);
    // `resolveLocale` falls back to English, so a match is only real if the tag
    // was actually English or actually resolved to something else.
    if (resolved !== DEFAULT_LOCALE || tag.toLowerCase().startsWith('en')) return resolved;
  }
  return null;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pinned, setPinned] = useState<Locale | null>(storedLocale);

  const locale = useMemo<Locale>(() => {
    if (pinned) return pinned;
    if (user?.langCode) return resolveLocale(user.langCode);
    return browserLocale() ?? DEFAULT_LOCALE;
  }, [pinned, user?.langCode]);

  const setLocale = useCallback((next: Locale | null) => {
    setPinned(next);
    try {
      if (next === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still holds for this session; only its persistence is lost.
    }
  }, []);

  /*
   * `describeError` is a plain module function called from about forty catch
   * blocks, so it cannot read this context. Pushing the locale to it here keeps
   * those forty call sites unchanged — see api/client.ts.
   *
   * Set during render rather than in an effect: an error thrown by a query that
   * settles in the same commit would otherwise be described in the previous
   * language. Assigning module state during render is safe because nothing reads
   * it during render.
   */
  setErrorLocale(locale);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      rtl: isRtl(locale),
      dir: isRtl(locale) ? 'rtl' : 'ltr',
      isPinned: pinned !== null,
    }),
    [locale, setLocale, pinned],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Falls back to English rather than throwing when there is no provider above.
 *
 * Deliberately unlike `useAuth`, which throws — and the difference is whether a
 * sane default exists. A component with no signed-in user genuinely cannot do its
 * job, so failing loudly is right. A component with no locale can: it renders in
 * English, left to right, which is what every installation saw before this
 * existed.
 *
 * The practical half is that almost every component now reads this, directly or
 * through `useT`, so throwing would mean no component could be rendered on its
 * own — in a unit test, or under an error boundary mounted above the provider —
 * without first being handed a language it has no opinion about.
 */
const FALLBACK: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  rtl: false,
  dir: 'ltr',
  isPinned: false,
};

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext) ?? FALLBACK;
}
