import { env } from '../config/env.js';
import { assess, directionOf } from '../intel/assess.js';
import { intel } from '../intel/registry.js';
import { componentLogger } from '../logger.js';
import { BoundedMap, type Finding, SlidingWindow } from '../packet/detect/types.js';
import { describeTcpFlags, type FlowRecord, isUnansweredTcp } from './types.js';

const log = componentLogger('flow-detect');

/**
 * Reconnaissance detection from flow records.
 *
 * Deliberately a separate detector rather than an adapter that fakes a
 * `DecodedPacket` from a flow. The two observations are not interchangeable: a
 * packet's SYN flag means "this packet opens a connection", whereas a flow's SYN
 * flag means "a SYN appeared somewhere in this conversation" — true of every
 * established connection. An adapter would quietly turn the strong packet-level
 * signal into a meaningless one.
 *
 * What flow data gives up: payload, so no credential or DNS-name inspection.
 * What it gains: every conversation crossing the exporter, not just those visible
 * from one host's NIC, and a per-flow verdict on whether the connection was ever
 * answered — which is a better scan discriminator than counting SYNs ever was.
 *
 * See `isUnansweredTcp` for the core test. Everything below only counts flows
 * that pass it, which is what keeps ordinary traffic silent.
 */

/** Ports where one client legitimately contacts very many hosts. */
const CLIENT_TRAFFIC_PORTS = new Set([53, 80, 123, 443, 853, 993, 995, 8080, 8443]);

/** Minimum gap between repeat reports of the same finding. */
const REPORT_COOLDOWN_MS = 15_000;

const MAX_TRACKED_KEYS = 8192;

/** Gap between repeat indicator findings for one pairing. */
const INTEL_COOLDOWN_MS = 60_000;

export interface FlowDetectionStats {
  flowsInspected: number;
  /** Flows that looked like unanswered connection attempts. */
  unansweredFlows: number;
  findings: number;
}

export class FlowScanDetector {
  private readonly portsPerTarget: SlidingWindow<number>;
  private readonly hostsPerPort: SlidingWindow<string>;
  private readonly attempts: SlidingWindow<string>;
  private readonly lastReported = new BoundedMap<string, number>(MAX_TRACKED_KEYS);

  private flowsInspected = 0;
  private unansweredFlows = 0;
  private findingCount = 0;

  constructor() {
    const { scanWindowMs, floodWindowMs } = env.detection;
    this.portsPerTarget = new SlidingWindow<number>(scanWindowMs);
    this.hostsPerPort = new SlidingWindow<string>(scanWindowMs);
    this.attempts = new SlidingWindow<string>(floodWindowMs);
  }

  inspect(flow: FlowRecord): Finding[] {
    this.flowsInspected += 1;

    const source = flow.srcIp;
    const target = flow.dstIp;
    if (!source || !target) return [];
    if (!isUnansweredTcp(flow)) return [];

    this.unansweredFlows += 1;

    // Windows key off arrival, not the flow's own timestamps. Exporters batch and
    // delay — a flow can be reported a minute after it ended, and several
    // exporters' clocks are wrong — so flow time is unusable for windowing even
    // though it is the right thing to put in the alert.
    const now = flow.observedAt.getTime();
    const findings: Finding[] = [];
    const { portScanPorts, hostSweepHosts, synFloodAttempts, scanWindowMs, floodWindowMs } = env.detection;
    const windowSeconds = Math.round(scanWindowMs / 1000);

    // --- Many ports on one host ---
    const portKey = `${source}>${target}`;
    const distinctPorts = this.portsPerTarget.add(portKey, flow.dstPort, now);
    if (distinctPorts >= portScanPorts && this.shouldReport(`ps|${portKey}`, now)) {
      const ports = this.portsPerTarget.distinct(portKey, now).sort((a, b) => a - b);
      findings.push({
        kind: 'port_scan',
        severity: 'high',
        title: `Port scan: ${source} probed ${distinctPorts} ports on ${target}`,
        description:
          `${source} opened unanswered connections to ${distinctPorts} different ports on ${target} ` +
          `within ${windowSeconds} seconds, as reported by the flow exporter at ${flow.exporter}. ` +
          'None of those connections were acknowledged, so nothing was listening or a firewall dropped ' +
          'them — the signature of mapping which services a host exposes, which usually precedes an ' +
          'exploitation attempt.',
        dedupKey: `port_scan|${source}|${target}`,
        sourceIp: source,
        sourceMac: flow.srcMac,
        targetIp: target,
        targetMac: flow.dstMac,
        protocol: flow.protocolName,
        evidence: {
          scanner: source,
          target,
          distinctPortsProbed: distinctPorts,
          samplePorts: ports.slice(0, 40),
          windowSeconds,
          ...this.provenance(flow),
        },
        timestamp: flow.end,
      });
    }

    // --- Same port across many hosts ---
    if (!CLIENT_TRAFFIC_PORTS.has(flow.dstPort)) {
      const sweepKey = `${source}:${flow.dstPort}`;
      const distinctHosts = this.hostsPerPort.add(sweepKey, target, now);
      if (distinctHosts >= hostSweepHosts && this.shouldReport(`hs|${sweepKey}`, now)) {
        const hosts = this.hostsPerPort.distinct(sweepKey, now);
        findings.push({
          kind: 'host_sweep',
          severity: 'high',
          title: `Host sweep: ${source} probed port ${flow.dstPort} on ${distinctHosts} hosts`,
          description:
            `${source} opened unanswered connections to port ${flow.dstPort}${describePort(flow.dstPort)} on ` +
            `${distinctHosts} different hosts within ${windowSeconds} seconds. Sweeping one service across a ` +
            'subnet is how an attacker or a worm finds every machine running it, and is a strong indicator ' +
            'of lateral movement rather than ordinary client traffic.',
          dedupKey: `host_sweep|${source}|${flow.dstPort}`,
          sourceIp: source,
          sourceMac: flow.srcMac,
          protocol: flow.protocolName,
          evidence: {
            scanner: source,
            port: flow.dstPort,
            service: describePort(flow.dstPort).replace(/[()\s]/g, '') || 'unknown',
            distinctHostsProbed: distinctHosts,
            sampleHosts: hosts.slice(0, 30),
            windowSeconds,
            ...this.provenance(flow),
          },
          timestamp: flow.end,
        });
      }
    }

    // --- Attempt rate ---
    const floodKey = `sf|${source}`;
    this.attempts.add(floodKey, `${target}:${flow.dstPort}`, now);
    const total = this.attempts.total(floodKey, now);
    if (total >= synFloodAttempts && this.shouldReport(`fl|${source}`, now)) {
      const seconds = Math.max(1, Math.round(floodWindowMs / 1000));
      findings.push({
        kind: 'syn_flood',
        severity: 'high',
        title: `Connection flood: ${total} unanswered attempts from ${source} in ${seconds}s`,
        description:
          `${source} opened ${total} TCP connections in ${seconds} seconds that were never acknowledged. ` +
          'At this rate the traffic is either a denial-of-service attempt, which exhausts the ' +
          "target's connection table, or an aggressive automated scanner.",
        dedupKey: `syn_flood|${source}`,
        sourceIp: source,
        sourceMac: flow.srcMac,
        protocol: flow.protocolName,
        evidence: {
          source,
          attemptsInWindow: total,
          windowSeconds: seconds,
          distinctTargets: this.attempts.distinct(floodKey, now).length,
          ...this.provenance(flow),
        },
        timestamp: flow.end,
      });
    }

    this.findingCount += findings.length;
    return findings;
  }

  /**
   * Where the observation came from. Included in every finding because with flow
   * data the answer to "how do you know?" is a specific device and interface, and
   * that is the first thing anyone triaging will ask.
   */
  private provenance(flow: FlowRecord): Record<string, unknown> {
    return {
      observedVia: flow.protocolVersion,
      exporter: flow.exporter,
      ...(flow.ingressInterface !== null ? { exporterIngressInterface: flow.ingressInterface } : {}),
      ...(flow.tcpFlags !== null
        ? { tcpFlags: describeTcpFlags(flow.tcpFlags) }
        : { tcpFlags: 'not reported by exporter' }),
      flowPackets: flow.packets,
      flowBytes: flow.bytes,
    };
  }

  private shouldReport(key: string, now: number): boolean {
    const last = this.lastReported.get(key);
    if (last !== undefined && now - last < REPORT_COOLDOWN_MS) return false;
    this.lastReported.set(key, now);
    return true;
  }

  sweep(now: number): void {
    this.portsPerTarget.sweep(now);
    this.hostsPerPort.sweep(now);
    this.attempts.sweep(now);
  }

  stats(): FlowDetectionStats {
    return {
      flowsInspected: this.flowsInspected,
      unansweredFlows: this.unansweredFlows,
      findings: this.findingCount,
    };
  }

  reset(): void {
    this.portsPerTarget.reset();
    this.hostsPerPort.reset();
    this.attempts.reset();
    this.lastReported.reset();
    this.flowsInspected = 0;
    this.unansweredFlows = 0;
    this.findingCount = 0;
  }
}

/** State expiry runs on a timer, not per flow. */
const SWEEP_INTERVAL_MS = 10_000;

/**
 * Runs the flow detectors over each record.
 *
 * One engine for the whole collector, unlike the per-session packet engine: flow
 * export is continuous infrastructure, not something a user starts and stops, so
 * there is no session boundary at which state should be discarded.
 */
export class FlowDetectionEngine {
  private readonly scan = new FlowScanDetector();
  /** Same pairing will not re-alert inside this window; repeats aggregate instead. */
  private readonly intelReported = new BoundedMap<string, number>(MAX_TRACKED_KEYS);
  private lastSweep = 0;

  inspect(flow: FlowRecord): Finding[] {
    try {
      const findings = [...this.intelFindings(flow), ...this.scan.inspect(flow)];
      const now = flow.observedAt.getTime();
      if (now - this.lastSweep >= SWEEP_INTERVAL_MS) {
        this.lastSweep = now;
        this.scan.sweep(now);
      }
      return findings;
    } catch (error) {
      // A detector fault must not take down the collector: the socket keeps
      // receiving whether or not we can make sense of one record.
      log.error({ err: error }, 'Flow detector threw');
      return [];
    }
  }

  /**
   * Indicator matching over flow records.
   *
   * Flow data is the ideal carrier for this: it covers every conversation
   * crossing the exporter rather than one host's own traffic, and matching an
   * address needs no payload at all. A hit here is the highest-confidence finding
   * this tool produces from flow alone.
   */
  private intelFindings(flow: FlowRecord): Finding[] {
    const set = intel().indicators;
    if (set.size === 0) return [];

    for (const [observed, peer] of [
      [flow.dstIp, flow.srcIp],
      [flow.srcIp, flow.dstIp],
    ] as const) {
      const match = set.matchIp(observed);
      if (!match) continue;

      const direction = directionOf(flow.srcIp, flow.dstIp);
      const graded = assess(match, {
        localIp: peer,
        remoteIp: observed,
        direction,
        via: `${flow.protocolVersion} from ${flow.exporter}`,
      });

      const now = flow.observedAt.getTime();
      if (!this.shouldReportIntel(graded.dedupKey, now)) return [];

      return [
        {
          kind: 'threat_intel',
          severity: graded.severity,
          title: graded.title,
          description: graded.description,
          dedupKey: graded.dedupKey,
          sourceIp: flow.srcIp,
          sourceMac: flow.srcMac,
          targetIp: flow.dstIp,
          targetMac: flow.dstMac,
          protocol: flow.protocolName,
          evidence: {
            indicator: match.indicator,
            indicatorType: match.type,
            matchedAddress: match.observed,
            feed: match.source,
            ...(match.note ? { feedNote: match.note } : {}),
            direction,
            observedVia: flow.protocolVersion,
            exporter: flow.exporter,
            destinationPort: flow.dstPort,
            flowPackets: flow.packets,
            flowBytes: flow.bytes,
          },
          timestamp: flow.end,
        },
      ];
    }

    return [];
  }

  private shouldReportIntel(key: string, now: number): boolean {
    const last = this.intelReported.get(key);
    if (last !== undefined && now - last < INTEL_COOLDOWN_MS) return false;
    this.intelReported.set(key, now);
    return true;
  }

  stats(): FlowDetectionStats {
    return this.scan.stats();
  }

  reset(): void {
    this.scan.reset();
    this.intelReported.reset();
    this.lastSweep = 0;
  }
}

/** Short parenthetical naming a port's usual service, for the alert text. */
function describePort(port: number): string {
  const services: Record<number, string> = {
    21: ' (FTP)',
    22: ' (SSH)',
    23: ' (Telnet)',
    25: ' (SMTP)',
    110: ' (POP3)',
    135: ' (Windows RPC)',
    139: ' (NetBIOS)',
    143: ' (IMAP)',
    445: ' (SMB file sharing)',
    1433: ' (Microsoft SQL Server)',
    1521: ' (Oracle)',
    3306: ' (MySQL)',
    3389: ' (Remote Desktop)',
    5432: ' (PostgreSQL)',
    5900: ' (VNC)',
    6379: ' (Redis)',
    9200: ' (Elasticsearch)',
    27017: ' (MongoDB)',
  };
  return services[port] ?? '';
}
