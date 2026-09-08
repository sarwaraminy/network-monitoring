/**
 * The languages this installation speaks.
 *
 * `fa-AF` rather than `fa` or `prs`: Dari is the Afghan variety of Persian, and
 * BCP 47 spells that as the region subtag on `fa`. `prs` exists but is far less
 * widely recognised — `Intl.ListFormat`, `Intl.NumberFormat` and the browser's
 * own locale negotiation all resolve `fa-AF` and none of them resolve `prs`,
 * which would silently fall back to English number and list formatting.
 */
export const LOCALES = ['en', 'de', 'fa-AF'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The language every fallback lands on.
 *
 * Also the language the catalogue is authored in: `en` is the only locale whose
 * completeness is enforced by the type system, because the key union is derived
 * from it. See catalog/findings.ts.
 */
export const DEFAULT_LOCALE: Locale = 'en';

/** Locales written right to left. Drives `dir` on the document and MUI's theme. */
const RTL: ReadonlySet<Locale> = new Set<Locale>(['fa-AF']);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return RTL.has(locale);
}

/**
 * Best supported locale for a stored `users.lang_code` or an `Accept-Language`
 * tag, falling back to English.
 *
 * Matches on the language subtag, so `de-CH` and `de-AT` reach `de`, and plain
 * `fa` reaches `fa-AF` — an Iranian Persian tag is far closer to Dari than
 * English is, and this is the only Persian catalogue there is. Exact matches are
 * tried first so a future `fa-IR` catalogue would win over this fallback without
 * the rule changing.
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const normalised = tag.trim().toLowerCase();
  if (!normalised) return DEFAULT_LOCALE;

  const exact = LOCALES.find((locale) => locale.toLowerCase() === normalised);
  if (exact) return exact;

  const language = normalised.split(/[-_]/)[0];
  if (!language) return DEFAULT_LOCALE;
  const byLanguage = LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === language);
  return byLanguage ?? DEFAULT_LOCALE;
}
