import { env } from '../../config/env.js';
import type { DecodedPacket } from '../decode.js';
import { BoundedMap, type Detector, type Finding, SlidingWindow } from './types.js';

/**
 * Reconnaissance and flood detection, all keyed off the TCP SYN-without-ACK — a
 * connection attempt.
 *
 * The old rule flagged every individual SYN-without-ACK, which meant every new
 * connection any program opened. Opening one web page produced dozens of
 * "threats". A connection attempt is not interesting; an unusual *pattern* of
 * them is, so everything here is counted over a sliding window.
 *
 * Three patterns are reported:
 *
 *  1. Port scan — one source probing many different ports on one host. No normal
 *     client does this, which makes it a high-precision signal.
 *  2. Host sweep — one source probing the same port across many hosts. Filtered
 *     to non-web ports, because a browser legitimately contacts hundreds of hosts
 *     on 443 and flagging that would recreate the original false-positive problem.
 *  3. SYN flood — an implausible rate of connection attempts from one source.
 */

/** Ports where contacting many hosts is normal client behaviour, not recon. */
const CLIENT_TRAFFIC_PORTS = new Set([53, 80, 123, 443, 853, 993, 995, 8080, 8443]);

/** Minimum gap between repeat reports of the same finding, to bound allocation. */
const REPORT_COOLDOWN_MS = 15_000;

const MAX_TRACKED_SOURCES = 8192;

export class ScanDetector implements Detector {
  // `name` is the primary kind; findings below set their own kind per pattern.
  readonly name = 'port_scan' as const;

  /** source -> distinct "ip:port" pairs, for the flood//breadth counts. */
  private readonly portsPerTarget: SlidingWindow<number>;
  private readonly hostsPerPort: SlidingWindow<string>;
  private readonly synCount: SlidingWindow<string>;
  private readonly lastReported = new BoundedMap<string, number>(MAX_TRACKED_SOURCES);

  constructor() {
    const { scanWindowMs, floodWindowMs } = env.detection;
    this.portsPerTarget = new SlidingWindow<number>(scanWindowMs);
    this.hostsPerPort = new SlidingWindow<string>(scanWindowMs);
    this.synCount = new SlidingWindow<string>(floodWindowMs);
  }

  inspect(packet: DecodedPacket): Finding[] {
    const tcp = packet.tcp;
    // A SYN with no ACK is a connection attempt; everything else is uninteresting here.
    if (!tcp?.syn || tcp.ack) return [];

    const source = packet.ipv4?.srcAddr ?? packet.ipv6?.srcAddr;
    const target = packet.ipv4?.dstAddr ?? packet.ipv6?.dstAddr;
    if (!source || !target) return [];

    const now = packet.timestamp.getTime();
    const findings: Finding[] = [];
    const { portScanPorts, hostSweepHosts, synFloodAttempts } = env.detection;

    // --- 1. Many ports on one host ---
    const portKey = `${source}>${target}`;
    const distinctPorts = this.portsPerTarget.add(portKey, tcp.dstPort, now);
    if (distinctPorts >= portScanPorts && this.shouldReport(`ps|${portKey}`, now)) {
      const ports = this.portsPerTarget.distinct(portKey, now).sort((a, b) => a - b);
      findings.push({
        kind: 'port_scan',
        severity: 'high',
        messageKey: 'port_scan.packet',
        messageParams: {
          source,
          target,
          count: distinctPorts,
          seconds: Math.round(env.detection.scanWindowMs / 1000),
        },
        dedupKey: `port_scan|${source}|${target}`,
        sourceIp: source,
        sourceMac: packet.ethernet?.sourceAddress ?? null,
        targetIp: target,
        targetMac: packet.ethernet?.destinationAddress ?? null,
        protocol: 'TCP',
        evidence: {
          scanner: source,
          target,
          distinctPortsProbed: distinctPorts,
          samplePorts: ports.slice(0, 40),
          windowSeconds: Math.round(env.detection.scanWindowMs / 1000),
        },
        timestamp: packet.timestamp,
      });
    }

    // --- 2. Same port across many hosts ---
    if (!CLIENT_TRAFFIC_PORTS.has(tcp.dstPort)) {
      const sweepKey = `${source}:${tcp.dstPort}`;
      const distinctHosts = this.hostsPerPort.add(sweepKey, target, now);
      if (distinctHosts >= hostSweepHosts && this.shouldReport(`hs|${sweepKey}`, now)) {
        const hosts = this.hostsPerPort.distinct(sweepKey, now);
        findings.push({
          kind: 'host_sweep',
          severity: 'high',
          messageKey: 'host_sweep.packet',
          messageParams: {
            source,
            // A string, not a number: a port is an identifier rather than a
            // quantity, and the type is what keeps it one — a bare `{port}` does
            // not localise digits, but a pattern gaining `, number` later would.
            // See ../../i18n/message.ts.
            port: String(tcp.dstPort),
            count: distinctHosts,
            seconds: Math.round(env.detection.scanWindowMs / 1000),
            service: portServiceName(tcp.dstPort),
            hasService: portServiceName(tcp.dstPort) !== null,
          },
          dedupKey: `host_sweep|${source}|${tcp.dstPort}`,
          sourceIp: source,
          sourceMac: packet.ethernet?.sourceAddress ?? null,
          protocol: 'TCP',
          // One port defines this finding, unlike the port scan above, so a
          // suppression rule may name it.
          port: tcp.dstPort,
          evidence: {
            scanner: source,
            port: tcp.dstPort,
            service: describePort(tcp.dstPort).replace(/[()\s]/g, '') || 'unknown',
            distinctHostsProbed: distinctHosts,
            sampleHosts: hosts.slice(0, 30),
            windowSeconds: Math.round(env.detection.scanWindowMs / 1000),
          },
          timestamp: packet.timestamp,
        });
      }
    }

    // --- 3. Connection attempt rate ---
    this.synCount.add(`syn|${source}`, `${target}:${tcp.dstPort}`, now);
    const attempts = this.synCount.total(`syn|${source}`, now);
    if (attempts >= synFloodAttempts && this.shouldReport(`sf|${source}`, now)) {
      const seconds = Math.max(1, Math.round(env.detection.floodWindowMs / 1000));
      findings.push({
        kind: 'syn_flood',
        severity: 'high',
        messageKey: 'syn_flood.packet',
        messageParams: { source, count: attempts, seconds },
        dedupKey: `syn_flood|${source}`,
        sourceIp: source,
        sourceMac: packet.ethernet?.sourceAddress ?? null,
        protocol: 'TCP',
        evidence: {
          source,
          attemptsInWindow: attempts,
          windowSeconds: seconds,
          distinctTargets: this.synCount.distinct(`syn|${source}`, now).length,
        },
        timestamp: packet.timestamp,
      });
    }

    return findings;
  }

  /** Rate-limits repeat findings; the alert aggregator merges what does get through. */
  private shouldReport(key: string, now: number): boolean {
    const last = this.lastReported.get(key);
    if (last !== undefined && now - last < REPORT_COOLDOWN_MS) return false;
    this.lastReported.set(key, now);
    return true;
  }

  sweep(now: number): void {
    this.portsPerTarget.sweep(now);
    this.hostsPerPort.sweep(now);
    this.synCount.sweep(now);
  }

  reset(): void {
    this.portsPerTarget.reset();
    this.hostsPerPort.reset();
    this.synCount.reset();
    this.lastReported.reset();
  }
}

/**
 * A port's usual service, or null when nothing is registered for it.
 *
 * Stays English in the alert text along with the other protocol names — an
 * operator correlating a finding with a firewall rule or an `nmap` report needs
 * the string those print. See the conventions in i18n/catalog/findings.en.ts.
 */
function portServiceName(port: number): string | null {
  const services: Record<number, string> = {
    21: 'FTP',
    22: 'SSH',
    23: 'Telnet',
    25: 'SMTP',
    110: 'POP3',
    135: 'Windows RPC',
    139: 'NetBIOS',
    143: 'IMAP',
    445: 'SMB file sharing',
    1433: 'Microsoft SQL Server',
    1521: 'Oracle',
    3306: 'MySQL',
    3389: 'Remote Desktop',
    5432: 'PostgreSQL',
    5900: 'VNC',
    6379: 'Redis',
    9200: 'Elasticsearch',
    27017: 'MongoDB',
  };
  return services[port] ?? null;
}

/**
 * Short parenthetical naming a port's usual service.
 *
 * Only `evidence.service` still reads this. The alert text takes the bare name as
 * a message parameter instead, because the parentheses are punctuation and belong
 * to the sentence rather than to the value — a right-to-left sentence puts them
 * on the other side.
 */
function describePort(port: number): string {
  const name = portServiceName(port);
  return name === null ? '' : ` (${name})`;
}
