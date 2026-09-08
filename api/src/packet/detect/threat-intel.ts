import { assess, directionOf } from '../../intel/assess.js';
import type { IndicatorSet } from '../../intel/match.js';
import { intel } from '../../intel/registry.js';
import type { DecodedPacket } from '../decode.js';
import { readFirstQuestion } from './dns-tunneling.js';
import { BoundedMap, type Detector, type Finding } from './types.js';

/**
 * Matches observed addresses and DNS names against loaded threat intelligence.
 *
 * The only detector here that is not a heuristic. Every other one measures
 * behaviour against a threshold and calls the result suspicious; this one checks
 * membership of a list of things already known to be malicious. A port-scan
 * finding is an opinion about where the line sits. A hit on a current C2 address
 * is a fact about the traffic, and it is actionable without tuning.
 *
 * Three things stop it becoming noisy:
 *
 *  - Direction is graded, not ignored. Outbound contact is critical; inbound is
 *    medium, because the internet scans everything constantly and treating that
 *    as critical would bury the operator. See `intel/assess.ts`.
 *  - Repeats of the same pairing share a dedup key, so a beacon calling home
 *    every thirty seconds is one alert with a rising occurrence count.
 *  - A cooldown bounds how often the same pairing can produce a fresh finding.
 *
 * Runs only when indicators are actually loaded, so an installation with no feeds
 * configured pays a single boolean per packet.
 */

const REPORT_COOLDOWN_MS = 60_000;
const MAX_TRACKED_PAIRS = 8192;

export class ThreatIntelDetector implements Detector {
  readonly name = 'threat_intel' as const;

  private readonly lastReported = new BoundedMap<string, number>(MAX_TRACKED_PAIRS);
  private matches = 0;

  /** Injected in tests; defaults to the process-wide registry. */
  constructor(private readonly indicators: () => IndicatorSet = () => intel().indicators) {}

  inspect(packet: DecodedPacket): Finding[] {
    const set = this.indicators();
    if (set.size === 0) return [];

    const sourceIp = packet.ipv4?.srcAddr ?? packet.ipv6?.srcAddr ?? null;
    const targetIp = packet.ipv4?.dstAddr ?? packet.ipv6?.dstAddr ?? null;
    const now = packet.timestamp.getTime();

    // A DNS question is checked first. It is the earliest and often the only
    // evidence — the lookup happens even when the connection is blocked later.
    const dnsFinding = this.inspectDns(packet, set, sourceIp, targetIp, now);
    if (dnsFinding) return [dnsFinding];

    // Target first: an outbound connection to a listed address is the finding
    // that matters most, so it should win when both ends somehow match. One
    // finding per packet — both ends matching is one event, not two.
    for (const observed of [targetIp, sourceIp]) {
      const match = set.matchIp(observed);
      if (!match) continue;

      const direction = directionOf(sourceIp, targetIp);
      // The local side is whichever end is not the listed address.
      const localIp = observed === targetIp ? sourceIp : targetIp;
      const graded = assess(match, {
        localIp,
        remoteIp: observed,
        direction,
        via: { key: 'threat_intel.via.packet_capture' },
      });
      if (!this.shouldReport(graded.dedupKey, now)) continue;

      this.matches += 1;
      return [
        buildFinding(packet, graded, {
          indicator: match.indicator,
          indicatorType: match.type,
          matchedAddress: match.observed,
          feed: match.source,
          ...(match.note ? { feedNote: match.note } : {}),
          direction,
          observedVia: 'packet capture',
          ...(destinationPortOf(packet) !== null ? { destinationPort: destinationPortOf(packet) } : {}),
        }),
      ];
    }

    return [];
  }

  private inspectDns(
    packet: DecodedPacket,
    set: IndicatorSet,
    sourceIp: string | null,
    targetIp: string | null,
    now: number,
  ): Finding | null {
    // Questions travel to port 53; answers come back from it. Only the question
    // says what the host asked for.
    if (packet.udp?.dstPort !== 53 || !packet.payload) return null;

    const question = readFirstQuestion(packet.payload);
    if (question === null) return null;

    const match = set.matchDomain(question);
    if (!match) return null;

    const graded = assess(match, {
      localIp: sourceIp,
      remoteIp: targetIp,
      direction: 'outbound',
      via: { key: 'threat_intel.via.dns_query' },
    });
    if (!this.shouldReport(graded.dedupKey, now)) return null;

    this.matches += 1;
    return buildFinding(packet, graded, {
      indicator: match.indicator,
      indicatorType: 'domain',
      queriedName: match.observed,
      feed: match.source,
      ...(match.note ? { feedNote: match.note } : {}),
      resolver: targetIp,
      observedVia: 'DNS query',
    });
  }

  private shouldReport(key: string, now: number): boolean {
    const last = this.lastReported.get(key);
    if (last !== undefined && now - last < REPORT_COOLDOWN_MS) return false;
    this.lastReported.set(key, now);
    return true;
  }

  /** Matches raised since the detector was created, for status reporting. */
  get matchCount(): number {
    return this.matches;
  }

  reset(): void {
    this.lastReported.reset();
    this.matches = 0;
  }
}

/** Assembles the finding. Shared so the address and DNS paths cannot drift. */
function buildFinding(
  packet: DecodedPacket,
  graded: ReturnType<typeof assess>,
  evidence: Record<string, unknown>,
): Finding {
  return {
    kind: 'threat_intel',
    severity: graded.severity,
    messageKey: graded.messageKey,
    messageParams: graded.messageParams,
    dedupKey: graded.dedupKey,
    sourceIp: packet.ipv4?.srcAddr ?? packet.ipv6?.srcAddr ?? null,
    sourceMac: packet.ethernet?.sourceAddress ?? null,
    targetIp: packet.ipv4?.dstAddr ?? packet.ipv6?.dstAddr ?? null,
    targetMac: packet.ethernet?.destinationAddress ?? null,
    protocol: protocolOf(packet),
    evidence,
    timestamp: packet.timestamp,
  };
}

function protocolOf(packet: DecodedPacket): string | null {
  if (packet.tcp) return 'TCP';
  if (packet.udp) return 'UDP';
  return packet.ipv4?.protocolName ?? null;
}

function destinationPortOf(packet: DecodedPacket): number | null {
  return packet.tcp?.dstPort ?? packet.udp?.dstPort ?? null;
}
