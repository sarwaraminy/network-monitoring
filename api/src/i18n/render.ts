import IntlMessageFormat from 'intl-messageformat';
import { DEFAULT_LOCALE, isRtl, type Locale } from './locales.js';
import type { MessageParams, MessageRef, MessageValue } from './message.js';

/**
 * Renders a `MessageRef` into a string, in one locale.
 *
 * Shared by every server-side consumer of a finding's text — the alert DTO, the
 * email body, the Teams card. The syslog and CEF exports deliberately do not use
 * the caller's locale; see notify/syslog.ts.
 */

/** Keys may be absent: a locale is only as complete as its translator has made it. */
export type Catalog = Readonly<Partial<Record<string, string>>>;
export type Catalogs = Readonly<Record<Locale, Catalog>>;

/**
 * First-strong isolate / pop directional isolate.
 *
 * Wrapped around interpolated strings when the surrounding sentence is
 * right-to-left. Without them the bidirectional algorithm reorders a value's own
 * runs against the paragraph direction, and `192.168.1.10` can be displayed with
 * its octets in a different order than it was written — which for a network tool
 * is not cosmetic, because the operator then reads an address that is not the one
 * in the finding. U+2068/U+2069 rather than `<bdi>` because the same rendered
 * string is used for plain-text mail as well as for HTML.
 */
const FSI = '⁨';
const PDI = '⁩';

export interface Renderer {
  render(ref: MessageRef, locale: Locale): string;
  /** True when `key` exists in the English catalogue. */
  has(key: string): boolean;
}

export function createRenderer(catalogs: Catalogs): Renderer {
  const formatters = new Map<string, IntlMessageFormat | null>();
  const lists = new Map<Locale, Intl.ListFormat>();

  function pattern(key: string, locale: Locale): { text: string; locale: Locale } | null {
    const own = catalogs[locale][key];
    if (own !== undefined) return { text: own, locale };
    // A key the translator has not reached yet falls back to English rather than
    // to the key itself: an operator reading an English sentence in a German
    // interface has lost nothing but consistency, whereas one reading
    // `arp_spoofing.sprawl.title` has lost the finding.
    const english = catalogs[DEFAULT_LOCALE][key];
    return english === undefined ? null : { text: english, locale: DEFAULT_LOCALE };
  }

  function formatterFor(key: string, locale: Locale): IntlMessageFormat | null {
    const cacheKey = `${locale} ${key}`;
    const cached = formatters.get(cacheKey);
    if (cached !== undefined) return cached;

    const found = pattern(key, locale);
    let formatter: IntlMessageFormat | null = null;
    if (found) {
      try {
        formatter = new IntlMessageFormat(found.text, found.locale);
      } catch {
        // A malformed pattern is a bug in the catalogue, not in the traffic.
        // Cached as null so a broken key costs one parse attempt rather than one
        // per alert per poll.
        formatter = null;
      }
    }
    formatters.set(cacheKey, formatter);
    return formatter;
  }

  function listFor(locale: Locale): Intl.ListFormat {
    let list = lists.get(locale);
    if (!list) {
      list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
      lists.set(locale, list);
    }
    return list;
  }

  function resolve(value: MessageValue, locale: Locale): string | number | boolean {
    if (value === null) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return isRtl(locale) ? `${FSI}${value}${PDI}` : value;
    if (Array.isArray(value)) {
      return listFor(locale).format(value.map((ref) => render(ref, locale)));
    }
    return render(value as MessageRef, locale);
  }

  function resolveAll(params: MessageParams | undefined, locale: Locale): Record<string, unknown> {
    if (!params) return {};
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params)) out[name] = resolve(value, locale);
    return out;
  }

  function render(ref: MessageRef, locale: Locale): string {
    const formatter = formatterFor(ref.key, locale);
    // Last resort. Shows the key, which is at least greppable and names the
    // catalogue entry somebody has to add.
    if (!formatter) return ref.key;
    try {
      const rendered = formatter.format(resolveAll(ref.params, locale));
      return typeof rendered === 'string' ? rendered : String(rendered);
    } catch {
      // Reached when the row's params do not satisfy the pattern — a sensor on an
      // older version writing into a shared database, which V16 made a supported
      // deployment. Never throws outward: one stale row must not cost the list.
      return ref.key;
    }
  }

  return {
    render,
    has: (key) => catalogs[DEFAULT_LOCALE][key] !== undefined,
  };
}
