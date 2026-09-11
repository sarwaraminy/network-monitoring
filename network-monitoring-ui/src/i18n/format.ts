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
  /**
   * A count shortened for a chart axis — "2.8M", "475K".
   *
   * A tick label has about four characters of room before the axis starts eating
   * the plot, and a findings count over a five-year window reaches six figures.
   * The shortening is `Intl`'s rather than hand-rolled, so the suffix belongs to
   * the reader: German gives "2,8 Mio." and Dari "۲٫۸ میلیون".
   *
   * A quantity, so it is digit-shaped like `number` and unlike an identifier —
   * see the note on `MessagePrimitive` in the generated message module.
   *
   * **Shortened only where shortening is real.** In a language whose abbreviation
   * is longer than the number it replaces — Dari spells "هزار" where English
   * writes "K" — this is `number`, because an axis that takes more room to say
   * less is worse than no abbreviation at all.
   */
  compact(value: number): string;
  /**
   * "3 minutes ago", in the reader's language.
   *
   * Two pages had a hand-rolled copy of this that returned English units — `just
   * now`, `5m ago`, `2d ago` — with a bare `toLocaleString()` for the
   * out-of-range fallback. So the freshness line was English in a German
   * interface, and the one date it did print followed the browser rather than the
   * app. `Intl.RelativeTimeFormat` is the whole fix: it has the units, the plural
   * rules and the "yesterday"/"gestern" special cases for every locale here.
   *
   * A future timestamp falls back to the absolute form rather than rendering "in
   * 3 minutes", which for a *last seen* column would be a claim about the future
   * that the data cannot support. An unreadable one renders `UNREADABLE_DATE` —
   * see `safely`.
   */
  relativeTime(value: string | number | Date): string;
}

function asDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** What an unreadable timestamp renders as. Matches the dash used for a null. */
const UNREADABLE_DATE = '\u2014';

/**
 * Guards every date formatter against a value that will not parse.
 *
 * This is not defensive padding, it is a repair. These call sites used to be
 * `toLocaleString()`, which RETURNS the string "Invalid Date" for a bad value.
 * `Intl.DateTimeFormat.prototype.format` THROWS `RangeError: Invalid time value`
 * on the same input — so moving to the app locale quietly converted a wrong-looking
 * cell into an exception.
 *
 * That exception is worse than it sounds. These run inside column renderers, so
 * it does not spoil one cell: it escapes to the error boundary and takes the
 * whole grid with it, on a page whose job is to show findings. Anything that puts
 * a non-timestamp in a timestamp field reaches it — a null serialised oddly, a
 * truncated value from an older row.
 */
function safely(at: Date, render: (valid: Date) => string): string {
  return Number.isNaN(at.getTime()) ? UNREADABLE_DATE : render(at);
}

export function createFormatters(locale: Locale): Formatters {
  // Built once per locale rather than per cell: these tables render hundreds of
  // rows and `Intl.DateTimeFormat` is the expensive part of doing this at all.
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const number = new Intl.NumberFormat(locale);
  /*
   * `useGrouping: 'always'` is not decoration. `notation: 'compact'` silently
   * resolves grouping to `'min2'` — separators only from five digits up — so
   * German `compact(8221)` rendered `"8221"` while `number(8221)` rendered
   * `"8.221"`, and both appear on one chart: the axis goes through `compact`, the
   * bar label and tooltip through `number`. The same magnitude, formatted two ways
   * side by side, and a regression against the plain `toLocaleString()` this
   * replaced.
   */
  const compactFormat = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
    useGrouping: 'always',
  });

  /*
   * Whether abbreviating actually shortens anything *in this language*.
   *
   * The point of a compact axis is a short tick. Measured against ICU, that is not
   * a property of the notation — it is a property of the locale:
   *
   *  - English wins everywhere: `1.2M` against `1,200,000`.
   *  - German wins above a million and ties below it; it does not abbreviate
   *    `10.000` or `100.000` at all, so those ticks are byte-identical.
   *  - **Dari loses at every magnitude.** `۸٫۲ هزار` is longer than `۸٬۲۲۱`, and
   *    `۱٫۲ میلیون` longer than `۱٬۲۰۰٬۰۰۰`: spelling the unit out costs more than
   *    the digits it replaces.
   *
   * That was invisible while the axis had a fixed width. With `width: 'auto'` the
   * axis takes exactly the room its labels need, so abbreviating in Dari would
   * hand that locale a *narrower plot* than it had before any of this — the
   * opposite of the stated goal, in the language with the longest labels.
   *
   * Decided once per locale rather than per value, so one axis cannot mix
   * notations. Probed across the magnitudes a findings count actually reaches.
   *
   * The test is "never longer", not "sometimes shorter", and the difference is
   * Dari: it abbreviates usefully at twelve million (۱۲ میلیون against
   * ۱۲٬۰۰۰٬۰۰۰) and badly everywhere below, so `some` let it through on the one
   * magnitude a findings count rarely reaches while it lost on all the ones it
   * does.
   */
  const lengths = [8_221, 100_000, 1_200_000, 12_000_000].map(
    (probe) => [compactFormat.format(probe).length, number.format(probe).length] as const,
  );
  const abbreviates =
    lengths.every(([short, plain]) => short <= plain) && lengths.some(([short, plain]) => short < plain);
  const compact = abbreviates ? compactFormat : number;
  // `numeric: 'auto'` is what produces "yesterday" rather than "1 day ago", and
  // the equivalent in each other language.
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  /*
   * `day` takes options, so it cannot be a single instance like the four above —
   * but it was building a new `Intl.DateTimeFormat` on EVERY call, directly under
   * the comment saying that is the expensive thing not to do. The dashboard's
   * five-year period is one constructor per trend bucket, up to 1825 per render,
   * on exactly the path that comment was written about.
   *
   * Keyed on the serialised options so the signature is unchanged and the common
   * call — no options at all — hits the same entry every time.
   *
   * The key includes explicitly-undefined fields, which `JSON.stringify` drops.
   * That matters because `undefined` is how a caller *removes* an option: the
   * month bucket asks for `{ year, month, day: undefined }` to unset the base's
   * `day: 'numeric'`, and stringified that is byte-identical to a plain
   * `{ year, month }` — a different formatter sharing one cache entry, so
   * whichever call arrived first would decide the format for both. There is only
   * one such caller today; a cache whose key cannot distinguish its entries is
   * not a thing to leave until there are two.
   */
  const days = new Map<string, Intl.DateTimeFormat>();
  const dayFormat = (options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
    const key = JSON.stringify(
      Object.entries(options ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        // `String(value)` rather than the value, so `undefined` survives as a key
        // component instead of being dropped by `JSON.stringify`. Sorted so two
        // callers writing the same options in a different order share an entry.
        .map(([name, value]) => [name, String(value)]),
    );
    let format = days.get(key);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        // UTC, matching the buckets the server groups by. A day boundary drawn in
        // the reader's timezone would not line up with the one the rollup used.
        timeZone: 'UTC',
        ...options,
      });
      days.set(key, format);
    }
    return format;
  };

  return {
    dateTime: (value) => safely(asDate(value), (at) => dateTime.format(at)),
    day: (value, options) => safely(asDate(value), (at) => dayFormat(options).format(at)),
    time: (value) => safely(asDate(value), (at) => time.format(at)),
    number: (value) => (Number.isFinite(value) ? number.format(value) : UNREADABLE_DATE),
    compact: (value) => (Number.isFinite(value) ? compact.format(value) : UNREADABLE_DATE),
    relativeTime: (value) =>
      safely(asDate(value), (at) => {
        const elapsed = Date.now() - at.getTime();
        // A future timestamp is a valid date, so the absolute form is safe here —
        // the unreadable case never reaches this callback.
        if (elapsed < 0) return dateTime.format(at);

        const minutes = Math.floor(elapsed / 60_000);
        if (minutes < 60) return relative.format(-minutes, 'minute');
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return relative.format(-hours, 'hour');
        return relative.format(-Math.floor(hours / 24), 'day');
      }),
  };
}

export function useFormatters(): Formatters {
  const { locale } = useLocale();
  return useMemo(() => createFormatters(locale), [locale]);
}
