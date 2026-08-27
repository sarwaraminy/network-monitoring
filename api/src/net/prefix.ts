import { canonicalIpv6, ipv4ToInt, parseCidr } from '../intel/match.js';

/**
 * IP prefixes, for matching an observed address against an operator-written range.
 *
 * intel/match.ts already parses CIDRs, but for a different job: it holds hundreds
 * of thousands of feed entries and answers "is this address in ANY of them" with
 * one binary search over merged ranges. Suppression asks the opposite question of
 * a handful of prefixes — "is this address in THIS one" — and needs three things
 * that the indicator path deliberately does not have:
 *
 *  - IPv6 prefixes. `parseCidr` is v4-only, because no feed this reads ships v6
 *    ranges. An operator writing "ignore the scanner in fd00:…/64" is not exotic.
 *  - A bare address as a full-length prefix, so `10.0.0.7` means `10.0.0.7/32`
 *    and nobody has to know to write the `/32`.
 *  - A normalised text form, so what is stored and shown is the range that will
 *    actually be matched. `10.0.0.7/24` is a legal way to write the whole /24,
 *    and a rule that displays the address the operator typed while matching 256
 *    of them is the sort of comment-versus-code mismatch that gets a security
 *    tool distrusted.
 *
 * The v4 half still calls `parseCidr`, so masking behaviour cannot drift between
 * indicator matching and suppression matching.
 */

export type Prefix =
  | { family: 4; bits: number; start: number; end: number; text: string }
  | { family: 6; bits: number; start: bigint; end: bigint; text: string };

/**
 * Prefix length, rejecting a zero-length one.
 *
 * `/0` is refused rather than accepted as "everything". A suppression rule needs
 * at least one criterion precisely so that no single rule silently swallows every
 * finding, and `0.0.0.0/0` satisfies that check while defeating what it is for.
 * "Any source" already has a spelling — leave the field empty — so the only thing
 * accepting `/0` could add is a way to write a match-everything rule that does
 * not look like one.
 */
function parseBits(text: string, max: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const bits = Number(text);
  if (!Number.isInteger(bits) || bits < 1 || bits > max) return null;
  return bits;
}

/** Canonical IPv6 text (`2001:db8:0:0:0:0:0:1`) to its 128-bit value. */
function ipv6ToBigInt(canonical: string): bigint {
  let value = 0n;
  for (const group of canonical.split(':')) {
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

/** The inverse, in the same canonical form `canonicalIpv6` produces. */
function bigIntToIpv6(value: bigint): string {
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((value >> shift) & 0xffffn).toString(16));
  }
  return groups.join(':');
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

/**
 * `10.0.0.0/8`, `2001:db8::/32`, or a bare address meaning a single host.
 *
 * Null for anything that is not unambiguously one of those. Guessing is not an
 * option here: a prefix that parses to something other than what was written is
 * a suppression rule that hides findings its author never meant to hide.
 *
 * IPv6 inherits `canonicalIpv6`'s two refusals — an embedded-IPv4 tail such as
 * `::ffff:1.2.3.4`, and a zone index such as `fe80::1%eth0`. Both are rejected
 * rather than interpreted, and both are rejected on the *observed* address too,
 * so the two sides cannot disagree about what an address means.
 */
export function parsePrefix(value: string): Prefix | null {
  const text = value.trim();
  if (text === '') return null;

  const slash = text.indexOf('/');
  const address = slash === -1 ? text : text.slice(0, slash);
  const bitsText = slash === -1 ? null : text.slice(slash + 1);

  if (address.includes(':')) {
    const canonical = canonicalIpv6(address);
    if (canonical === null) return null;

    const bits = bitsText === null ? 128 : parseBits(bitsText, 128);
    if (bits === null) return null;

    // Clearing the host bits by division rather than by a mask: BigInt has no
    // fixed width, so `~mask` would be an infinitely long run of ones.
    const size = 1n << BigInt(128 - bits);
    const start = (ipv6ToBigInt(canonical) / size) * size;
    return { family: 6, bits, start, end: start + size - 1n, text: `${bigIntToIpv6(start)}/${bits}` };
  }

  const bits = bitsText === null ? 32 : parseBits(bitsText, 32);
  if (bits === null) return null;

  // Delegated, so v4 masking has exactly one implementation in this codebase.
  const range = parseCidr(`${address}/${bits}`);
  if (!range) return null;

  return { family: 4, bits, start: range.start, end: range.end, text: `${intToIpv4(range.start)}/${bits}` };
}

/**
 * Whether `address` falls inside `prefix`.
 *
 * A family mismatch is false, not an error: a rule written for a v4 range must
 * not match a v6 address, and vice versa. So is an address that fails to parse —
 * an unparseable address is not evidence that a suppression should apply, and
 * treating it as a match would hide findings whose addresses this code failed to
 * understand.
 */
export function prefixContains(prefix: Prefix, address: string | null | undefined): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  if (trimmed === '') return false;

  if (prefix.family === 4) {
    if (trimmed.includes(':')) return false;
    const value = ipv4ToInt(trimmed);
    return value !== null && value >= prefix.start && value <= prefix.end;
  }

  if (!trimmed.includes(':')) return false;
  const canonical = canonicalIpv6(trimmed);
  if (canonical === null) return false;
  const value = ipv6ToBigInt(canonical);
  return value >= prefix.start && value <= prefix.end;
}
