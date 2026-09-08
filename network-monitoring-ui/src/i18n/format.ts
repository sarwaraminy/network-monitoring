import { useMemo } from 'react';
import { useLocale } from '../contexts/LocaleContext';
import type { Locale } from './generated/locales';

/**
 * Dates and numbers, formatted in the language the application is being read in.
 *
 * Every one of these call sites used to be a bare `toLocaleString()`, which takes
 * the *browser's* locale rather than the application's. That is invisible while
 * the two agree and wrong the moment they do not: an operator who switches the
 * interface to German gets German prose around American dates, and one reading it
 * in Dari gets Gregorian.
 *
 * **The Solar Hijri calendar comes for free.** Afghanistan uses it, and `fa-AF`
 * already selects it in CLDR — with the Afghan month names (سنبله) rather than the
 * Iranian ones (شهریور), which is the distinction that would have made a generic
 * Persian adapter subtly wrong. So there is no calendar adapter and no extra
 * dependency here: passing the application's locale to `Intl` is the whole of it.
 *
 * What is *not* formatted this way is anything an operator has to match against
 * something outside this application — a port, an address, a byte count in a
 * filter expression. Those are identifiers; see `Identifier`.
 */

export interface Formatters {
  /** A timestamp with both halves, for "last seen" and audit rows. */
  dateTime(value: string | number | Date): string;
  /** Just the day, for a chart axis covering more than one. */
  day(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string;
  /** Just the clock, for a chart axis covering less than one day. */
  time(value: string | number | Date): string;
  /** A count. Grouped and digit-shaped per locale, which for a count is correct. */
  number(value: number): string;
}

function asDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function createFormatters(locale: Locale): Formatters {
  // Built once per locale rather than per cell: these tables render hundreds of
  // rows and `Intl.DateTimeFormat` is the expensive part of doing this at all.
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const number = new Intl.NumberFormat(locale);

  return {
    dateTime: (value) => dateTime.format(asDate(value)),
    day: (value, options) =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        // UTC, matching the buckets the server groups by. A day boundary drawn in
        // the reader's timezone would not line up with the one the rollup used.
        timeZone: 'UTC',
        ...options,
      }).format(asDate(value)),
    time: (value) => time.format(asDate(value)),
    number: (value) => number.format(value),
  };
}

export function useFormatters(): Formatters {
  const { locale } = useLocale();
  return useMemo(() => createFormatters(locale), [locale]);
}
