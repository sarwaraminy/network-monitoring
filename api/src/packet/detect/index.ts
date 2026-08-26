import { env } from '../../config/env.js';
import { componentLogger } from '../../logger.js';
import type { DecodedPacket } from '../decode.js';
import { ArpSpoofDetector } from './arp-spoof.js';
import { DnsTunnelingDetector } from './dns-tunneling.js';
import { NewDeviceDetector } from './new-device.js';
import { PlaintextCredentialDetector } from './plaintext-credentials.js';
import { ScanDetector } from './scan.js';
import { ThreatIntelDetector } from './threat-intel.js';
import type { Detector, Finding } from './types.js';

const log = componentLogger('detect');

export { ArpSpoofDetector } from './arp-spoof.js';
export { DnsTunnelingDetector } from './dns-tunneling.js';
export { NewDeviceDetector } from './new-device.js';
export { PlaintextCredentialDetector } from './plaintext-credentials.js';
export { ScanDetector } from './scan.js';
export { ThreatIntelDetector } from './threat-intel.js';
export * from './types.js';

/** State expiry runs at most this often, not on every packet. */
const SWEEP_INTERVAL_MS = 10_000;

export interface DetectionEngineOptions {
  /** MAC addresses already known, so new-device detection survives a restart. */
  knownDevices?: Iterable<string>;
  /** Called when a MAC is seen for the first time, for persistence. */
  onDeviceDiscovered?: (mac: string, ip: string | null) => void;
}

/**
 * Runs every detector over each packet and returns their findings.
 *
 * One engine per capture session, so state (learned ARP bindings, scan windows,
 * the device list) belongs to that session and does not leak between captures.
 */
export class DetectionEngine {
  private readonly detectors: Detector[];
  private readonly newDevice: NewDeviceDetector;
  private lastSweep = 0;

  constructor(options: DetectionEngineOptions = {}) {
    this.newDevice = new NewDeviceDetector(env.detection.deviceLearningPeriodMs, {
      ...(options.onDeviceDiscovered ? { onDiscovered: options.onDeviceDiscovered } : {}),
    });
    if (options.knownDevices) this.newDevice.seed(options.knownDevices);

    this.detectors = [
      new ArpSpoofDetector(),
      new ScanDetector(),
      new PlaintextCredentialDetector(),
      new DnsTunnelingDetector(),
      // First among equals in confidence: everything above is a threshold, this
      // is membership of a list of things already known to be malicious. Costs a
      // single boolean per packet when no feeds are configured.
      new ThreatIntelDetector(),
      this.newDevice,
    ];
  }

  inspect(packet: DecodedPacket): Finding[] {
    const findings: Finding[] = [];

    for (const detector of this.detectors) {
      try {
        const produced = detector.inspect(packet);
        if (produced.length > 0) findings.push(...produced);
      } catch (error) {
        // One detector throwing must not stop the others or drop the packet.
        log.error({ detector: detector.name, err: error }, 'Detector threw on a packet');
      }
    }

    const now = packet.timestamp.getTime();
    if (now - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.lastSweep = now;
      for (const detector of this.detectors) detector.sweep?.(now);
    }

    return findings;
  }

  reset(): void {
    for (const detector of this.detectors) detector.reset();
    this.lastSweep = 0;
  }
}
