import type { DecodedPacket } from '../decode.js';
import { BoundedMap, type Detector, type Finding } from './types.js';

/**
 * A MAC address never seen on this network before.
 *
 * Useful for the small-network case this tool suits best: an unexpected device on
 * the LAN is worth a look, and it is the precursor to most other LAN attacks.
 *
 * Two things keep this from being noise:
 *   - a learning period at the start of each capture, during which addresses are
 *     recorded silently. Without it every device on the network would alert the
 *     moment a capture began.
 *   - the known-device list is persisted (see known_devices), so restarting the
 *     server does not re-alert on the whole network. The capture service supplies
 *     the persisted set through `seed()`.
 */

const MAX_TRACKED_DEVICES = 8192;

/** Locally administered / multicast MACs that are not real device identities. */
function isStructuralAddress(mac: string): boolean {
  if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') return true;
  const firstOctet = Number.parseInt(mac.slice(0, 2), 16);
  if (Number.isNaN(firstOctet)) return true;
  // Bit 0 of the first octet set means a multicast/broadcast group address.
  return (firstOctet & 0x01) === 1;
}

export class NewDeviceDetector implements Detector {
  readonly name = 'new_device' as const;

  private readonly seen = new BoundedMap<string, { firstIp: string | null }>(MAX_TRACKED_DEVICES);
  private learningUntil: number | null = null;
  private readonly onDiscovered?: (mac: string, ip: string | null) => void;

  constructor(
    private readonly learningPeriodMs: number,
    options: { onDiscovered?: (mac: string, ip: string | null) => void } = {},
  ) {
    this.onDiscovered = options.onDiscovered;
  }

  /** Pre-loads addresses already known from previous runs. */
  seed(macAddresses: Iterable<string>): void {
    for (const mac of macAddresses) {
      this.seen.set(mac.toLowerCase(), { firstIp: null });
    }
  }

  inspect(packet: DecodedPacket): Finding[] {
    const mac = packet.ethernet?.sourceAddress?.toLowerCase();
    if (!mac || isStructuralAddress(mac)) return [];

    const now = packet.timestamp.getTime();
    // The clock starts at the first packet, not at construction, so the learning
    // period tracks capture time rather than wall time.
    this.learningUntil ??= now + this.learningPeriodMs;

    if (this.seen.has(mac)) return [];

    const ip = packet.ipv4?.srcAddr ?? packet.ipv6?.srcAddr ?? packet.arp?.srcProtocolAddr ?? null;
    this.seen.set(mac, { firstIp: ip });
    this.onDiscovered?.(mac, ip);

    // Still learning what "normal" looks like: record, do not report.
    if (now < this.learningUntil) return [];

    return [
      {
        kind: this.name,
        severity: 'medium',
        title: `New device on the network: ${mac}${ip ? ` (${ip})` : ''}`,
        description:
          `${mac} has not been seen on this network before` +
          `${ip ? `, and is currently using ${ip}` : ''}. ` +
          'An unrecognised device may be a visitor, a newly provisioned machine, or an unauthorised ' +
          `connection. The vendor prefix is ${mac.slice(0, 8)}, which can help identify the hardware.`,
        dedupKey: `new_device|${mac}`,
        sourceIp: ip,
        sourceMac: mac,
        evidence: {
          macAddress: mac,
          ipAddress: ip,
          vendorPrefix: mac.slice(0, 8),
          knownDevicesBefore: this.seen.size - 1,
        },
        timestamp: packet.timestamp,
      },
    ];
  }

  reset(): void {
    this.seen.reset();
    this.learningUntil = null;
  }
}
