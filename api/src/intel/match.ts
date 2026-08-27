/**
 * Indicator matching.
 *
 * Every other detector in this codebase answers "does this traffic look unusual?"
 * — a threshold, a rate, a breadth. Useful, but heuristic: a port scan finding is
 * a judgement, and reasonable networks disagree about where the line sits.
 *
 * This one answers a different question: "is this address or name on a list of
 * things known to be malicious?" That is not a judgement. If a host on the network
 * opens a connection to a current Feodo C2 address, something is wrong, and it is
 * wrong regardless of how the thresholds are tuned. It is the first detector here
 * that produces findings a security person would call high-confidence.
 *
 * The honest limits, stated because they matter when triaging:
 *
 *  - Feeds go stale. An address that hosted C2 last month may be an innocent VPS
 *    today, so the feed name travels with every match and `/api/intel/status`
 *    reports when each was last loaded.
 *  - Feeds contain mistakes, including occasional private ranges, which is why
 *    non-routable addresses are refused at load time rather than trusted.
 *  - A match is evidence, not proof. It says "this is worth looking at now",
 *    which is far more than any threshold here can say.
 *  - IPv6 is canonicalised before comparison, but an embedded-IPv4 form such as
 *    `::ffff:1.2.3.4` is refused rather than folded to its v4 equivalent.
 *
 * Lookups run per flow and per packet, so everything is O(1) or O(log n): a hash
 * set for exact addresses, merged sorted ranges with a binary search for CIDRs,
 * and a suffix walk for domains.
 */

export const INDICATOR_TYPES = ['ipv4', 'ipv6', 'cidr', 'domain'] as const;
export type IndicatorType = (typeof INDICATOR_TYPES)[number];

export interface Indicator {
  value: string;
  type: IndicatorType;
  /** Which feed supplied it, for the alert evidence. */
  source: string;
  /** Free text from the feed, e.g. a malware family. */
  note?: string;
}

export interface IndicatorMatch {
  /** What was observed — the address or name seen on the network. */
  observed: string;
  /** The entry that matched. For a CIDR this is the prefix, not the address. */
  indicator: string;
  type: IndicatorType;
  source: string;
  note: string | null;
}

/** Per-source counts, so status can show a feed silently returning nothing. */
export interface IndicatorStats {
  total: number;
  ipv4: number;
  ipv6: number;
  cidr: number;
  domain: number;
  rejected: number;
  bySource: Record<string, number>;
}

interface Range {
  start: number;
  end: number;
  source: string;
  note: string | null;
  prefix: string;
}

/**
 * Never treated as an indicator, whatever a feed says.
 *
 * Public blocklists do occasionally contain RFC1918 or loopback entries — a
 * mis-parsed line, or a sinkhole address someone forgot to strip. Accepting one
 * would light up every alert on the network at once and destroy trust in the
 * detector permanently. Refusing them costs nothing: an indicator for 10.0.0.0/8
 * is never actionable intelligence.
 *
 * It has a second caller with a *different* question. assess.ts asks "is this
 * address on my network?", and reuses this deliberately so the two definitions
 * of local cannot drift apart again. They are not the same set: multicast,
 * broadcast and 0/8 are non-routable without being local, so a conversation with
 * 224.0.0.251 grades `internal` rather than `outbound`. That costs nothing in
 * practice — such an address can never be a loaded indicator, so no assessment
 * is ever produced for it — but the name describes the first job, not the second.
 */
export function isNonRoutableV4(ip: number): boolean {
  const a = (ip >>> 24) & 0xff;
  const b = (ip >>> 16) & 0xff;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * The v6 counterpart, with the same two jobs and the same caveat.
 *
 * It takes a *canonical* string, which is the whole point. The predicate this
 * replaces ran `startsWith` on whatever the feed or the capture happened to
 * spell, so `::1` was recognised as loopback and its equally valid expansion
 * `0:0:0:0:0:0:0:1` was not — the v6 half of an asymmetry whose v4 half was
 * already closed, with the canonicaliser sitting in the same module.
 */
export function isNonRoutableV6(canonical: string): boolean {
  // The unspecified address. A feed line of `::` names no host at all.
  if (canonical === '0:0:0:0:0:0:0:0') return true;
  if (canonical === '0:0:0:0:0:0:0:1') return true;

  const first = Number.parseInt(canonical.split(':')[0] ?? '', 16);
  if (Number.isNaN(first)) return false;
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

export function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (part.length === 0 || part.length > 3 || !/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  // `>>> 0` keeps it unsigned; a bare shift would make 255.255.255.255 negative.
  return value >>> 0;
}

/**
 * Canonical IPv6, so the two spellings of one address meet.
 *
 * Without this, `add` and `matchIp` both did `trim().toLowerCase()` and nothing
 * more, so a feed listing `2001:0db8:0000:0000:0000:0000:0000:0001` never
 * matched an observed `2001:db8::1`. Silent false negatives — the failure mode
 * this module's own docblock calls the one that matters most, and the only
 * limitation the "honest limits" list above had failed to mention.
 *
 * Expands `::`, strips leading zeroes, and re-joins. Returns null for anything
 * that is not a plausible IPv6 literal rather than guessing at it.
 */
export function canonicalIpv6(address: string): string | null {
  const value = address.trim().toLowerCase();
  if (value === '' || !value.includes(':')) return null;
  // An embedded IPv4 tail or a zone index is beyond what these feeds carry.
  if (value.includes('.') || value.includes('%')) return null;
  if (!/^[0-9a-f:]+$/.test(value)) return null;

  const halves = value.split('::');
  if (halves.length > 2) return null;

  // An empty group is legal only as the elision itself. Filtering empties
  // unconditionally — as this did — silently rewrote a stray colon into a
  // different, perfectly valid address: `:1:2:3:4:5:6:7:8` came back as
  // `1:2:3:4:5:6:7:8`, so one malformed feed line became a confident indicator
  // for an address the line never named. The same class of bug as the
  // `999.999.999.999` case normalizeDomain catches below, and the same rule
  // parse.ts states: a line that is nearly an indicator is not guessed at.
  const splitHalf = (half: string): string[] | null => {
    if (half === '') return [];
    const groups = half.split(':');
    return groups.some((group) => group === '') ? null : groups;
  };

  const head = splitHalf(halves[0] ?? '');
  const tail = halves.length === 2 ? splitHalf(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const normalized: string[] = [];
  for (const group of groups) {
    if (group.length === 0 || group.length > 4) return null;
    normalized.push(group.replace(/^0+/, '') || '0');
  }

  return normalized.join(':');
}

/** Lowercased, with a trailing dot and any port stripped. */
export function normalizeDomain(name: string): string | null {
  const trimmed = name.trim().toLowerCase().replace(/\.$/, '');
  if (trimmed === '' || trimmed.length > 253) return null;
  if (!trimmed.includes('.')) return null;
  if (!/^[a-z0-9._-]+$/.test(trimmed)) return null;

  // The final label must start with a letter. Without this an invalid address
  // like `999.999.999.999` fails the IPv4 check and then falls through to being
  // accepted as a domain — turning one malformed feed line into a bogus
  // indicator. Every real TLD is alphabetic, punycode `xn--` included.
  const tld = trimmed.split('.').at(-1) ?? '';
  if (!/^[a-z][a-z0-9-]*$/.test(tld)) return null;

  return trimmed;
}

export class IndicatorSet {
  private readonly ipv4 = new Map<number, { source: string; note: string | null }>();
  private readonly ipv6 = new Map<string, { source: string; note: string | null }>();
  private readonly domains = new Map<string, { source: string; note: string | null }>();
  /** Merged and sorted at build time, so a lookup is one binary search. */
  private ranges: Range[] = [];
  private pendingRanges: Range[] = [];
  private rejected = 0;
  private readonly bySource = new Map<string, number>();

  /** Highest number of indicators held, so a runaway feed cannot exhaust memory. */
  constructor(private readonly maxIndicators = 500_000) {}

  get size(): number {
    return this.ipv4.size + this.ipv6.size + this.domains.size + this.ranges.length;
  }

  /** Returns false when the entry was refused. */
  add(indicator: Indicator): boolean {
    if (this.size + this.pendingRanges.length >= this.maxIndicators) {
      this.rejected += 1;
      return false;
    }

    const note = indicator.note?.trim() || null;
    const meta = { source: indicator.source, note };

    switch (indicator.type) {
      case 'ipv4': {
        const value = ipv4ToInt(indicator.value);
        if (value === null || isNonRoutableV4(value)) break;
        this.ipv4.set(value, meta);
        this.count(indicator.source);
        return true;
      }
      case 'cidr': {
        const range = parseCidr(indicator.value);
        if (!range) break;
        // A prefix covering private space is the same failure as a private host.
        if (isNonRoutableV4(range.start) || isNonRoutableV4(range.end)) break;
        this.pendingRanges.push({ ...range, ...meta, prefix: indicator.value });
        this.count(indicator.source);
        return true;
      }
      case 'ipv6': {
        const value = canonicalIpv6(indicator.value);
        if (value === null) break;
        if (isNonRoutableV6(value)) break;
        this.ipv6.set(value, meta);
        this.count(indicator.source);
        return true;
      }
      case 'domain': {
        const value = normalizeDomain(indicator.value);
        if (value === null) break;
        this.domains.set(value, meta);
        this.count(indicator.source);
        return true;
      }
    }

    this.rejected += 1;
    return false;
  }

  /**
   * Sorts and merges CIDR ranges. Must be called once after loading.
   *
   * Merging matters for correctness, not just speed: the binary search finds the
   * last range whose start is at or below the address, which is only a valid test
   * if ranges do not overlap. Feeds routinely overlap — a /16 and a /24 inside it.
   */
  seal(): void {
    if (this.pendingRanges.length === 0) return;

    const sorted = [...this.ranges, ...this.pendingRanges].sort((a, b) => a.start - b.start);
    const merged: Range[] = [];

    for (const range of sorted) {
      const last = merged.at(-1);
      if (last && range.start <= last.end + 1) {
        // Keep the earlier entry's attribution; extend the coverage.
        last.end = Math.max(last.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }

    this.ranges = merged;
    this.pendingRanges = [];
  }

  /** Match an IP address, exact first then by prefix. Null when clean. */
  matchIp(address: string | null | undefined): IndicatorMatch | null {
    if (!address) return null;

    if (address.includes(':')) {
      const canonical = canonicalIpv6(address);
      if (canonical === null) return null;
      const hit = this.ipv6.get(canonical);
      return hit ? { observed: address, indicator: canonical, type: 'ipv6', ...hit } : null;
    }

    const value = ipv4ToInt(address);
    if (value === null) return null;

    const exact = this.ipv4.get(value);
    if (exact) return { observed: address, indicator: address, type: 'ipv4', ...exact };

    const range = this.findRange(value);
    return range
      ? {
          observed: address,
          indicator: range.prefix,
          type: 'cidr',
          source: range.source,
          note: range.note,
        }
      : null;
  }

  /**
   * Match a domain, and every parent of it.
   *
   * `evil.example.com` matches an indicator for `example.com`, because listing a
   * domain means the domain and what it delegates. The public suffix is not
   * consulted — a feed listing `co.uk` would be broken data, and the load-time
   * checks are the wrong place to fix bad intelligence.
   */
  matchDomain(name: string | null | undefined): IndicatorMatch | null {
    if (!name) return null;
    const normalized = normalizeDomain(name);
    if (normalized === null) return null;

    const labels = normalized.split('.');
    for (let index = 0; index < labels.length - 1; index += 1) {
      const candidate = labels.slice(index).join('.');
      const hit = this.domains.get(candidate);
      if (hit) return { observed: normalized, indicator: candidate, type: 'domain', ...hit };
    }
    return null;
  }

  stats(): IndicatorStats {
    return {
      total: this.size,
      ipv4: this.ipv4.size,
      ipv6: this.ipv6.size,
      cidr: this.ranges.length,
      domain: this.domains.size,
      rejected: this.rejected,
      bySource: Object.fromEntries(this.bySource),
    };
  }

  private count(source: string): void {
    this.bySource.set(source, (this.bySource.get(source) ?? 0) + 1);
  }

  /** Last range starting at or below `value`, then a containment check. */
  private findRange(value: number): Range | null {
    let low = 0;
    let high = this.ranges.length - 1;
    let found: Range | null = null;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const range = this.ranges[mid];
      if (!range) break;
      if (range.start <= value) {
        found = range;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return found && value <= found.end ? found : null;
  }
}

/** `1.2.3.0/24` to an inclusive uint32 range. Null when malformed. */
export function parseCidr(cidr: string): { start: number; end: number } | null {
  const [network, bitsRaw] = cidr.trim().split('/');
  // `bitsRaw === ''` matters as much as undefined: `Number('')` is 0, so a
  // malformed `1.2.3.0/` would otherwise parse as /0 and match the entire
  // internet. An indicator that matches everything is the worst possible
  // outcome for a detector whose value is that a hit means something.
  if (!network || !bitsRaw || !/^\d+$/.test(bitsRaw)) return null;

  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;

  const base = ipv4ToInt(network);
  if (base === null) return null;

  // A /0 shifted by 32 is undefined in JS (shifts are mod 32), so special-case it.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const start = (base & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end };
}
