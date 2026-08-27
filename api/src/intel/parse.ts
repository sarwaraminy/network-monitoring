import { type Indicator, type IndicatorType, ipv4ToInt, normalizeDomain, parseCidr } from './match.js';

/**
 * Feed parsing.
 *
 * Threat feeds are plain text with no agreed format. In practice they are one of
 * three things, and the shape is obvious per line rather than per file — abuse.ch
 * ships bare IPs with `#` comments, Spamhaus DROP ships `CIDR ; comment`, others
 * ship CSV with a header. So each line is classified on its own, which also means
 * a feed that mixes types parses correctly instead of being half-discarded.
 *
 * Deliberately permissive about what it skips and strict about what it accepts.
 * A junk line should be ignored; a line that is *nearly* an indicator should not
 * be guessed at, because a wrong indicator produces a confident false alarm and
 * those are what get a detector switched off.
 */

export interface ParsedFeed {
  indicators: Indicator[];
  /** Lines that were not indicators — comments, headers, blanks, junk. */
  skipped: number;
}

/** Comment markers used across the common feeds. */
const COMMENT = /^\s*(?:#|;|\/\/)/;

export function parseFeed(body: string, source: string): ParsedFeed {
  const indicators: Indicator[] = [];
  let skipped = 0;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || COMMENT.test(line)) {
      skipped += 1;
      continue;
    }

    const parsed = parseLine(line, source);
    if (parsed) indicators.push(parsed);
    else skipped += 1;
  }

  return { indicators, skipped };
}

/**
 * One line to one indicator.
 *
 * The first field is the candidate; anything after a separator is treated as the
 * feed's own note. CSV feeds put the indicator first often enough for this to
 * work, and a header row fails every type check and is skipped.
 */
function parseLine(line: string, source: string): Indicator | null {
  // Split on the separators these feeds actually use, keeping the remainder as a
  // note. Done by hand rather than with a regex: `[^\s,;|]+[\s,;|]*(.*)` is
  // ambiguous between the separator class and `.*`, which is a backtracking
  // hazard on a line of untrusted feed content.
  let cut = -1;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    if (
      character === ' ' ||
      character === '	' ||
      character === ',' ||
      character === ';' ||
      character === '|'
    ) {
      cut = index;
      break;
    }
  }

  const candidate = cut === -1 ? line : line.slice(0, cut);
  const rest =
    cut === -1
      ? ''
      : line
          .slice(cut)
          .replace(/^[\s,;|]+/, '')
          .trim();
  // Strip a trailing comment from something like `1.2.3.0/24 ; SBL123`.
  const note = rest.replace(COMMENT, '').trim() || undefined;

  const type = classify(candidate);
  if (type === null) return null;

  return { value: candidate, type, source, ...(note ? { note: note.slice(0, 200) } : {}) };
}

/** What kind of indicator a token is, or null when it is not one. */
export function classify(token: string): IndicatorType | null {
  const value = token.trim();
  if (value === '') return null;

  if (value.includes('/')) {
    return parseCidr(value) ? 'cidr' : null;
  }

  if (value.includes(':')) {
    // Crude, but enough to separate an IPv6 literal from a URL or a host:port.
    return /^[0-9a-fA-F:]+$/.test(value) && value.split(':').length >= 3 ? 'ipv6' : null;
  }

  if (ipv4ToInt(value) !== null) return 'ipv4';
  if (normalizeDomain(value) !== null) return 'domain';
  return null;
}
