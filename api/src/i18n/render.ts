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

/**
 * The shape this file needs from an ICU node, and no more.
 *
 * Structural rather than `any`: the parser's own types are not exported through
 * `intl-messageformat`, and these three fields are the whole of what identifies
 * an argument and its role. The same shape, for the same reason, as the one in
 * catalog/placeholder-parity.test.ts.
 */
interface IcuNode {
  type: number;
  value?: unknown;
  options?: Record<string, { value?: unknown }>;
  children?: unknown;
}

/** Literal text, a `select`, and the `#` inside a plural. */
const LITERAL = 0;
const SELECT = 5;
const POUND = 7;

/**
 * Arguments a pattern compares but never puts on the page.
 *
 * ICU evaluates `select` by matching the resolved value against the option
 * names, so a value wrapped for display no longer matches anything: in an RTL
 * locale `⁨true⁩` is not `true`, and the pattern falls silently to `other`. That
 * shipped once — an enabled suppression rule announced itself as "Enable rule N"
 * in Dari and only in Dari, because the isolation is only applied there.
 *
 * The isolation is for text a reader sees, and a select operand is not that, so
 * it is skipped for arguments used as an operand and nowhere else. An argument
 * that is compared *and* displayed keeps its isolation: the display is the use
 * that needs it, and a pattern like that would have to compare against the
 * isolated form anyway.
 *
 * Doing this here rather than at the call sites is what makes the class go away.
 * A call site can pass the right type today and be changed tomorrow, and neither
 * `tsc` nor the parity checks can see it — the argument is present and correctly
 * named, and only its type is wrong.
 */
function comparedOnly(ast: readonly IcuNode[]): ReadonlySet<string> {
  const compared = new Set<string>();
  const displayed = new Set<string>();

  const walk = (nodes: readonly IcuNode[]): void => {
    for (const node of nodes) {
      if (typeof node.value === 'string') {
        if (node.type === SELECT) compared.add(node.value);
        // A plural counts as displayed: its operand reappears as `#`. Numbers are
        // never isolated anyway, so this costs nothing and keeps the rule simple.
        else if (node.type !== LITERAL && node.type !== POUND) displayed.add(node.value);
      }
      if (node.options) {
        for (const option of Object.values(node.options)) {
          if (Array.isArray(option.value)) walk(option.value as IcuNode[]);
        }
      }
      if (Array.isArray(node.children)) walk(node.children as IcuNode[]);
    }
  };

  walk(ast);
  for (const name of displayed) compared.delete(name);
  return compared;
}

/** A parsed pattern, with the arguments its rendering must not isolate. */
interface Compiled {
  readonly formatter: IntlMessageFormat;
  readonly compared: ReadonlySet<string>;
}

export function createRenderer(catalogs: Catalogs): Renderer {
  const formatters = new Map<string, Compiled | null>();
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

  function formatterFor(key: string, locale: Locale): Compiled | null {
    const cacheKey = `${locale} ${key}`;
    const cached = formatters.get(cacheKey);
    if (cached !== undefined) return cached;

    const found = pattern(key, locale);
    let compiled: Compiled | null = null;
    if (found) {
      try {
        const formatter = new IntlMessageFormat(found.text, found.locale);
        // Walked once per key per locale, alongside the parse it is already
        // paying for, and cached with it.
        compiled = { formatter, compared: comparedOnly(formatter.getAst() as unknown as IcuNode[]) };
      } catch {
        // A malformed pattern is a bug in the catalogue, not in the traffic.
        // Cached as null so a broken key costs one parse attempt rather than one
        // per alert per poll.
        compiled = null;
      }
    }
    formatters.set(cacheKey, compiled);
    return compiled;
  }

  function listFor(locale: Locale): Intl.ListFormat {
    let list = lists.get(locale);
    if (!list) {
      list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
      lists.set(locale, list);
    }
    return list;
  }

  function resolve(value: MessageValue, locale: Locale, isolate: boolean): string | number | boolean {
    if (value === null) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return isolate && isRtl(locale) ? `${FSI}${value}${PDI}` : value;
    }
    if (Array.isArray(value)) {
      return listFor(locale).format(value.map((ref) => render(ref, locale)));
    }
    return render(value as MessageRef, locale);
  }

  function resolveAll(
    params: MessageParams | undefined,
    locale: Locale,
    compared: ReadonlySet<string>,
  ): Record<string, unknown> {
    if (!params) return {};
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params)) {
      out[name] = resolve(value, locale, !compared.has(name));
    }
    return out;
  }

  function render(ref: MessageRef, locale: Locale): string {
    const compiled = formatterFor(ref.key, locale);
    // Last resort. Shows the key, which is at least greppable and names the
    // catalogue entry somebody has to add.
    if (!compiled) return ref.key;
    try {
      const rendered = compiled.formatter.format(resolveAll(ref.params, locale, compiled.compared));
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
