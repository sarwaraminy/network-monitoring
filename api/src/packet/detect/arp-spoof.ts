import { env } from '../../config/env.js';
import type { DecodedPacket } from '../decode.js';
import { BoundedMap, type Detector, type Finding } from './types.js';

/**
 * ARP spoofing / ARP cache poisoning — the mechanism behind most LAN
 * man-in-the-middle attacks.
 *
 * How this differs from the previous implementation, which never fired: bindings
 * are learned from live traffic rather than read from a hardcoded list of two
 * addresses. ARP is used as the only source of truth because it is inherently
 * link-local; learning IP-to-MAC pairs from routed IPv4 traffic would flag every
 * router, since a router's MAC legitimately fronts thousands of remote IPs.
 *
 * Two signals are reported:
 *
 *  1. An IP that a settled MAC already owns is suddenly claimed by a different
 *     MAC. Rapid alternation between two MACs (a "gratuitous ARP war") is the
 *     classic signature and raises confidence.
 *  2. One MAC claiming an implausible number of distinct IPs, which is what a
 *     poisoner answering for the whole subnet looks like.
 */

/** Times a binding must be seen before a change is treated as suspicious. */
const OBSERVATIONS_BEFORE_TRUSTED = 3;
/** Distinct IPs one MAC may claim before that itself is a finding. */
const MAX_IPS_PER_MAC = 5;
/** Alternations between MACs within this window count as a flip-flop. */
const FLIP_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 4096;
const MAX_TRACKED_MACS = 4096;

interface Binding {
  mac: string;
  observations: number;
  firstSeen: number;
  lastSeen: number;
  /** MACs previously seen for this IP, with the last time each was seen. */
  history: Map<string, number>;
  flips: number;
}

export class ArpSpoofDetector implements Detector {
  readonly name = 'arp_spoofing' as const;

  private readonly bindings = new BoundedMap<string, Binding>(MAX_TRACKED_IPS);
  private readonly ipsPerMac = new BoundedMap<string, Set<string>>(MAX_TRACKED_MACS);
  private readonly reportedMacSprawl = new Set<string>();

  inspect(packet: DecodedPacket): Finding[] {
    const arp = packet.arp;
    if (!arp) return [];

    // Sender fields of an ARP request or reply are the claim being made.
    const ip = arp.srcProtocolAddr;
    const mac = arp.srcHardwareAddr.toLowerCase();
    const now = packet.timestamp.getTime();

    // 0.0.0.0 is used by DHCP probes and duplicate-address detection.
    if (ip === '0.0.0.0' || mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') return [];

    const findings: Finding[] = [];
    const configured = env.arpTrustedMappings.get(ip);

    if (configured !== undefined && configured.toLowerCase() !== mac) {
      // An explicitly configured binding is authoritative, so this needs no
      // learning period and is reported immediately.
      findings.push({
        kind: this.name,
        severity: 'critical',
        title: `ARP spoofing: ${ip} claimed by ${mac}`,
        description:
          `${mac} sent an ARP ${arp.operationName} claiming ${ip}, but that address is configured ` +
          `to ${configured}. A host on the network is impersonating ${ip}, which lets it intercept ` +
          'traffic intended for that address.',
        dedupKey: `arp_spoofing|configured|${ip}`,
        sourceIp: ip,
        sourceMac: mac,
        protocol: 'ARP',
        evidence: {
          claimedIp: ip,
          claimingMac: mac,
          configuredMac: configured,
          arpOperation: arp.operationName,
          source: 'ARP_TRUSTED_MAPPINGS',
        },
        timestamp: packet.timestamp,
      });
    }

    const existing = this.bindings.get(ip);

    if (!existing) {
      this.bindings.set(ip, {
        mac,
        observations: 1,
        firstSeen: now,
        lastSeen: now,
        history: new Map([[mac, now]]),
        flips: 0,
      });
    } else if (existing.mac === mac) {
      existing.observations += 1;
      existing.lastSeen = now;
      existing.history.set(mac, now);
    } else {
      const previousMac = existing.mac;
      const previousObservations = existing.observations;
      const seenBefore = existing.history.get(mac);
      const returningWithinWindow = seenBefore !== undefined && now - seenBefore < FLIP_WINDOW_MS;
      if (returningWithinWindow) existing.flips += 1;

      // Move the binding over, so a genuine device swap settles rather than
      // alerting forever.
      existing.mac = mac;
      existing.observations = 1;
      existing.lastSeen = now;
      existing.history.set(mac, now);

      // Below the trust threshold this is more likely DHCP churn or a device
      // being replaced than an attack.
      if (previousObservations >= OBSERVATIONS_BEFORE_TRUSTED && configured === undefined) {
        const flipping = existing.flips > 0;
        findings.push({
          kind: this.name,
          severity: flipping ? 'critical' : 'high',
          title: `ARP spoofing: ${ip} moved from ${previousMac} to ${mac}`,
          description:
            `${ip} was consistently answered by ${previousMac} (${previousObservations} observations) ` +
            `and is now claimed by ${mac}. ` +
            (flipping
              ? 'The two addresses are alternating, which is the signature of an active ARP poisoning ' +
                "attack: the attacker repeatedly overwrites the victim's ARP cache to keep traffic " +
                'flowing through itself.'
              : 'This can be a replaced device or a DHCP change, but it is also how a ' +
                'man-in-the-middle inserts itself. Confirm the new address belongs to expected hardware.'),
          dedupKey: `arp_spoofing|conflict|${ip}`,
          sourceIp: ip,
          sourceMac: mac,
          protocol: 'ARP',
          evidence: {
            claimedIp: ip,
            previousMac,
            currentMac: mac,
            previousMacObservations: previousObservations,
            alternations: existing.flips,
            arpOperation: arp.operationName,
            knownMacsForIp: [...existing.history.keys()],
          },
          timestamp: packet.timestamp,
        });
      }
    }

    // A single MAC answering for many addresses is itself suspicious.
    let claimed = this.ipsPerMac.get(mac);
    if (!claimed) {
      claimed = new Set();
      this.ipsPerMac.set(mac, claimed);
    }
    claimed.add(ip);

    if (claimed.size > MAX_IPS_PER_MAC && !this.reportedMacSprawl.has(mac)) {
      this.reportedMacSprawl.add(mac);
      findings.push({
        kind: this.name,
        severity: 'high',
        title: `${mac} is claiming ${claimed.size} different IP addresses`,
        description:
          `${mac} has sent ARP messages claiming ${claimed.size} distinct addresses. A normal host ` +
          'answers for its own address only. Answering for many is how an attacker poisons the ARP ' +
          'caches of an entire subnet at once.',
        dedupKey: `arp_spoofing|sprawl|${mac}`,
        sourceMac: mac,
        protocol: 'ARP',
        evidence: {
          mac,
          claimedIpCount: claimed.size,
          claimedIps: [...claimed].slice(0, 20),
        },
        timestamp: packet.timestamp,
      });
    }

    return findings;
  }

  sweep(now: number): void {
    // Forget flip history that has aged out, so counts reflect recent activity.
    for (const [, binding] of this.bindings.entries()) {
      for (const [mac, seenAt] of binding.history) {
        if (now - seenAt > FLIP_WINDOW_MS * 10 && mac !== binding.mac) binding.history.delete(mac);
      }
    }
  }

  reset(): void {
    this.bindings.reset();
    this.ipsPerMac.reset();
    this.reportedMacSprawl.clear();
  }
}
