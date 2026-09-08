import type { FindingRef } from '../i18n/catalog/findings.js';
import type { Finding, Severity } from '../packet/detect/types.js';
import { canonicalIpv6, type IndicatorMatch, ipv4ToInt, isNonRoutableV4, isNonRoutableV6 } from './match.js';

/**
 * Turning a match into a finding.
 *
 * Shared by the packet detector and the flow detector so the two cannot drift
 * apart on the question that matters most here: **which way was the connection
 * going**.
 *
 * An inbound connection from a listed address is background noise on any
 * internet-facing network — the whole internet scans constantly, and half the
 * addresses on a blocklist are scanners. Alerting critically on it would bury
 * the operator on day one.
 *
 * An *outbound* connection to a listed C2 address is the opposite. Something
 * inside the network chose to talk to it, which means either a compromised host
 * or a user who has run something they should not have. That is the finding
 * worth waking someone for, and separating the two is what keeps this detector
 * credible.
 */

export type Direction = 'outbound' | 'inbound' | 'internal' | 'unknown';

/**
 * Which side of the conversation is local.
 *
 * Uses RFC1918 and friends rather than a configured home network. It is a
 * heuristic, and it is wrong on a network that routes public addresses
 * internally — but it is right on essentially every network this tool targets,
 * and getting it wrong only mislabels the direction, never suppresses the alert.
 */
export function isPrivateAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  // Canonicalised first, so the two spellings of loopback agree. Raw prefix
  // matching said yes to `::1` and no to `0:0:0:0:0:0:0:1`, which is the same
  // address — the v6 half of the asymmetry the v4 branch below already fixed.
  if (address.includes(':')) {
    const canonical = canonicalIpv6(address);
    return canonical !== null && isNonRoutableV6(canonical);
  }

  // Delegates to the same predicate the loader uses to refuse indicators. Two
  // definitions of "local" in one feature drift: this one previously omitted
  // CGNAT (100.64/10), 0/8 and multicast, so on a CGNAT-addressed network an
  // outbound connection to a listed address graded `high` with "direction could
  // not be determined" instead of `critical` — losing the distinction the
  // module calls the whole trick.
  const value = ipv4ToInt(address);
  return value !== null && isNonRoutableV4(value);
}

export function directionOf(sourceIp: string | null, targetIp: string | null): Direction {
  const sourceLocal = isPrivateAddress(sourceIp);
  const targetLocal = isPrivateAddress(targetIp);

  if (sourceLocal && !targetLocal) return 'outbound';
  if (!sourceLocal && targetLocal) return 'inbound';
  if (sourceLocal && targetLocal) return 'internal';
  return 'unknown';
}

export interface Assessment {
  severity: Severity;
  messageKey: Finding['messageKey'];
  messageParams: Finding['messageParams'];
  /** Stable across repeats of the same pairing, so occurrences aggregate. */
  dedupKey: string;
}

/**
 * Grades a match.
 *
 * A DNS lookup of a listed domain is treated as seriously as a connection: the
 * lookup is what a beacon does first, and it often happens even when the
 * connection itself is blocked downstream — so it is frequently the only
 * evidence available.
 */
export function assess(
  match: IndicatorMatch,
  context: {
    localIp: string | null;
    remoteIp: string | null;
    direction: Direction;
    /**
     * How the match was observed, as a reference rather than a phrase.
     *
     * "packet capture", "DNS query" and "NetFlow v9 from 10.0.0.1" are prose, and
     * the last one has a preposition in it — a German or Dari sentence does not
     * put that where an English one does, so the fragment has to be translatable
     * on its own rather than pre-joined here.
     */
    via: FindingRef;
  },
): Assessment {
  const { localIp, remoteIp, direction, via } = context;
  const attribution: FindingRef = {
    key: 'threat_intel.attribution',
    params: { source: match.source, note: match.note ?? null, hasNote: Boolean(match.note) },
  };
  const common = {
    observed: match.observed,
    indicator: match.indicator,
    attribution,
    localIp,
    hasLocalIp: localIp !== null,
    via,
  };

  if (match.type === 'domain') {
    return {
      severity: 'critical',
      messageKey: 'threat_intel.domain',
      messageParams: common,
      dedupKey: `threat_intel|domain|${match.indicator}|${localIp ?? 'unknown'}`,
    };
  }

  if (direction === 'outbound') {
    return {
      severity: 'critical',
      messageKey: 'threat_intel.outbound',
      messageParams: common,
      dedupKey: `threat_intel|outbound|${match.indicator}|${localIp ?? 'unknown'}`,
    };
  }

  if (direction === 'inbound') {
    return {
      // Deliberately not critical. The internet scans everything constantly and
      // a large share of any blocklist is scanners; grading this critical would
      // bury the operator and teach them to ignore the detector.
      severity: 'medium',
      messageKey: 'threat_intel.inbound',
      messageParams: common,
      dedupKey: `threat_intel|inbound|${match.indicator}|${localIp ?? 'unknown'}`,
    };
  }

  return {
    severity: 'high',
    messageKey: 'threat_intel.unknown',
    messageParams: { ...common, remoteIp, hasRemoteIp: remoteIp !== null },
    dedupKey: `threat_intel|${match.indicator}|${localIp ?? 'unknown'}|${remoteIp ?? 'unknown'}`,
  };
}
