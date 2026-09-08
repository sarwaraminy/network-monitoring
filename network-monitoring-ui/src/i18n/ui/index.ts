import { useMemo } from 'react';
import { useLocale } from '../../contexts/LocaleContext';
import type { Locale } from '../generated/locales';
import type { MessageParams } from '../generated/message';
import { createRenderer } from '../generated/render';
import { UI_DE } from './de';
import { UI_EN, type UiMessageKey } from './en';
import { UI_FA_AF } from './fa-AF';

/**
 * The interface's own strings.
 *
 * UI-owned rather than mirrored from the API, because the flow is one-directional
 * and these never leave the browser: a button label is not something a detector
 * emits or a syslog collector parses. The finding and error catalogues come the
 * other way, from `../generated`, because their text is authored next to the code
 * that raises it.
 *
 * The renderer is the same one, so plurals, `select` and bidi isolation behave
 * identically in all three catalogues — and identifiers interpolated into a label
 * are isolated here exactly as they are inside a finding.
 */
export type { UiMessageKey };

const CATALOGS: Readonly<Record<Locale, Readonly<Partial<Record<UiMessageKey, string>>>>> = {
  en: UI_EN,
  de: UI_DE,
  'fa-AF': UI_FA_AF,
};

const messages = createRenderer(CATALOGS);

/** Renders one interface string. Exported for the few places outside a component. */
export function translate(locale: Locale, key: UiMessageKey, params?: MessageParams): string {
  return messages.render(params === undefined ? { key } : { key, params }, locale);
}

export type Translate = (key: UiMessageKey, params?: MessageParams) => string;

/**
 * The hook every component uses.
 *
 * Named `t` at the call site by convention — it appears hundreds of times, and a
 * longer name would wrap every label onto its own line.
 */
export function useT(): Translate {
  const { locale } = useLocale();
  return useMemo(() => (key, params) => translate(locale, key, params), [locale]);
}

/**
 * Each language's name in itself — "Deutsch", not "German".
 *
 * The one part of the interface deliberately *not* translated: someone who has
 * landed in a language they cannot read finds their own by its own name, which is
 * the single word they can be relied on to recognise.
 *
 * Shared by the account menu's switch and the sign-up form's language field so
 * the two cannot offer different sets. They did: the form offered English, Dari
 * and Pashto — a language this application has no catalogue for — and not German,
 * which it does. That was harmless while nothing read `users.lang_code`, and
 * became a bug the moment it started choosing the interface language.
 */
export const ENDONYMS: Readonly<Record<Locale, string>> = {
  en: 'English',
  de: 'Deutsch',
  'fa-AF': 'دری',
};
