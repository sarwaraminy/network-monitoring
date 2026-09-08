import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';
import { HttpError } from '../middleware/error-handler.js';
import { type DecodedPacket, decodePacket, isSupportedLinkType, type LinkType } from '../packet/decode.js';
import { DetectionEngine } from '../packet/detect/index.js';
import {
  isAvailable as isPcapAvailable,
  libraryVersion,
  listDevices,
  openLive,
  PcapError,
  type PcapHandle,
  PcapUnavailableError,
} from '../packet/libpcap.js';
import { toPacketDTO } from '../packet/mapping.js';
import type { NetworkInterfaceDTO, PacketDTO } from '../types/dto.js';
import { AlertSink } from './alert.service.js';
import { loadKnownMacAddresses, recordDevice } from './device.service.js';

/**
 * Replaces PacketCaptureService and PacketCaptureServiceWithIP. Both Java classes
 * were near-identical copies differing only in their BPF filter and anomaly rule,
 * so this is one class instantiated twice (see packet-capture.registry.ts).
 *
 * Capture goes through packet/libpcap.ts, which drives the platform's pcap library
 * over FFI. The handle is non-blocking, so instead of Pcap4J's dedicated
 * `handle.loop()` thread we poll it on a timer and drain whatever is buffered.
 *
 * Other deliberate differences from the Java version:
 *  - decoded DTOs are stored once at capture time instead of re-deriving every
 *    packet on each GET (the UI polls once a second);
 *  - the packet list is a bounded ring buffer, so a long capture cannot exhaust
 *    memory the way the unbounded ArrayList<Packet> could;
 *  - a failure to open the interface propagates instead of being swallowed, which
 *    previously left the UI showing "capturing" with nothing arriving.
 */

/** Kernel-side capture buffer. Larger values tolerate bigger traffic bursts. */
const KERNEL_BUFFER_BYTES = 10 * 1024 * 1024;
/** Highest number of frames drained per poll, so one tick cannot hog the loop. */
const MAX_FRAMES_PER_TICK = 512;

export interface CaptureStatus {
  capturing: boolean;
  /** False when the pcap library could not be loaded — see packet/libpcap.ts. */
  captureAvailable: boolean;
  /** pcap library version string, or null when unavailable. */
  captureLibrary: string | null;
  interfaceName: string | null;
  filter: string | null;
  linkType: string | null;
  packetCount: number;
  droppedPackets: number;
  /** Findings raised during this capture, before deduplication. */
  findingCount: number;
  startedAt: string | null;
}

export class PacketCaptureService {
  private handle: PcapHandle | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private capturing = false;
  private interfaceName: string | null = null;
  private filter: string | null = null;
  private linkType: string | null = null;
  private startedAt: Date | null = null;

  private readonly packets: PacketDTO[] = [];
  private droppedPackets = 0;
  private findingCount = 0;
  private warnedAboutLinkType = false;

  /** Detection state belongs to a capture session, so both are created together. */
  private engine: DetectionEngine | null = null;
  private sink: AlertSink | null = null;

  /** Tagged with the session label, so the two captures are distinguishable in logs. */
  private readonly log: Logger;

  constructor(
    label: string,
    private readonly bufferSize: number = env.captureBufferSize,
  ) {
    this.log = componentLogger('capture').child({ session: label });
  }

  /** Was Pcaps.findAllDevs(). */
  getNetworkInterfaces(): NetworkInterfaceDTO[] {
    try {
      return listDevices().map((device) => ({
        name: device.name,
        description: device.description,
        addresses: device.addresses,
      }));
    } catch (error) {
      throw this.toHttpError(error, 'Could not enumerate network interfaces');
    }
  }

  /**
   * @param snapshotLength Bytes captured per frame.
   * @param timeoutMs pcap read timeout, passed through to pcap_set_timeout.
   * @param filterIpAddress When set, applies the BPF filter `host <ip>`.
   */
  async startCapture(
    interfaceName: string,
    snapshotLength: number,
    timeoutMs: number,
    filterIpAddress?: string | null,
  ): Promise<void> {
    if (this.capturing) return;

    if (!interfaceName || interfaceName.trim() === '') {
      throw HttpError.of(400, 'error.interface_required');
    }

    const available = this.getNetworkInterfaces();
    if (!available.some((device) => device.name === interfaceName)) {
      throw HttpError.of(404, 'error.interface_not_found', { name: interfaceName });
    }

    const filter = buildFilter(filterIpAddress);
    let handle: PcapHandle;

    try {
      handle = openLive({
        device: interfaceName,
        snapshotLength: clampSnapshotLength(snapshotLength),
        timeoutMs: clampTimeout(timeoutMs),
        bufferSize: KERNEL_BUFFER_BYTES,
        promiscuous: true,
      });
    } catch (error) {
      throw this.toHttpError(error, `Could not open ${interfaceName}`);
    }

    try {
      if (filter !== '') handle.setFilter(filter);
    } catch (error) {
      handle.close();
      throw this.toHttpError(error, 'Could not apply the capture filter');
    }

    // Devices already on record, so a restart does not re-alert on the whole
    // network. A failure here degrades detection quality but must not stop capture.
    let knownDevices: string[] = [];
    try {
      knownDevices = await loadKnownMacAddresses();
    } catch (error) {
      this.log.warn({ err: error }, 'Could not load known devices; new-device detection may re-alert');
    }

    this.sink = new AlertSink();
    this.engine = new DetectionEngine({
      knownDevices,
      onDeviceDiscovered: (mac, ip) => {
        void recordDevice(mac, ip).catch((error: unknown) => {
          this.log.warn({ mac, err: error }, 'Could not record device');
        });
      },
      // Same upsert, taken for a device already known: it refreshes `last_seen`,
      // which is what retention prunes on. Warned rather than ignored, because
      // touches that fail silently are how a device present all along becomes
      // stale enough to forget.
      onDeviceSeen: (mac, ip) => {
        void recordDevice(mac, ip).catch((error: unknown) => {
          this.log.warn({ mac, err: error }, 'Could not refresh when a known device was last seen');
        });
      },
    });

    this.handle = handle;
    this.capturing = true;
    this.interfaceName = interfaceName;
    this.filter = filter === '' ? null : filter;
    this.linkType = handle.linkType;
    this.startedAt = new Date();
    this.warnedAboutLinkType = false;
    this.findingCount = 0;

    this.pollTimer = setInterval(() => this.poll(), env.capturePollIntervalMs);
    // Don't let the poll timer alone keep the process alive.
    this.pollTimer.unref();

    this.log.info(
      {
        interface: interfaceName,
        linkType: this.linkType,
        snaplen: clampSnapshotLength(snapshotLength),
        timeoutMs: clampTimeout(timeoutMs),
        filter: this.filter,
        knownDevices: knownDevices.length,
      },
      'Capture started',
    );
  }

  async stopCapture(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.handle) {
      // One last read so nothing buffered at the moment of stopping is lost.
      try {
        this.consume(this.handle.drain(MAX_FRAMES_PER_TICK));
      } catch {
        // The handle is going away regardless.
      }
      try {
        this.handle.close();
      } catch (error) {
        this.log.warn({ err: error }, 'Closing the capture handle failed');
      }
      this.handle = null;
    }

    if (this.capturing) {
      this.log.info({ bufferedPackets: this.packets.length, findings: this.findingCount }, 'Capture stopped');
    }
    this.capturing = false;
    this.startedAt = null;

    // Write out whatever the detectors found before the sink is discarded.
    const sink = this.sink;
    this.sink = null;
    this.engine = null;
    if (sink) {
      try {
        await sink.close();
      } catch (error) {
        this.log.error({ err: error }, 'Could not flush alerts');
      }
    }
  }

  getCapturedPackets(): PacketDTO[] {
    return this.packets;
  }

  clearCapturedPackets(): void {
    this.packets.length = 0;
    this.droppedPackets = 0;
  }

  getStatus(): CaptureStatus {
    return {
      capturing: this.capturing,
      captureAvailable: isPcapAvailable(),
      captureLibrary: libraryVersion(),
      interfaceName: this.interfaceName,
      filter: this.filter,
      linkType: this.linkType,
      packetCount: this.packets.length,
      droppedPackets: this.droppedPackets,
      findingCount: this.findingCount,
      startedAt: this.startedAt?.toISOString() ?? null,
    };
  }

  private poll(): void {
    const handle = this.handle;
    if (!handle || handle.closed) return;

    try {
      this.consume(handle.drain(MAX_FRAMES_PER_TICK));
    } catch (error) {
      // A read error means the handle is unusable; stop rather than log per tick.
      this.log.error({ err: error }, 'Read failed; stopping capture');
      void this.stopCapture();
    }
  }

  private consume(frames: ReturnType<PcapHandle['drain']>): void {
    // Ethernet, loopback (NULL/LOOP) and RAW are decodable; anything else — 802.11
    // radiotap, for instance — would need its own link-layer parser.
    if (!isSupportedLinkType(this.linkType)) {
      if (frames.length > 0 && !this.warnedAboutLinkType) {
        this.warnedAboutLinkType = true;
        this.log.warn(
          { linkType: this.linkType },
          'Link type is not supported; packets are captured but not decoded',
        );
      }
      return;
    }
    const linkType: LinkType = this.linkType;

    for (const frame of frames) {
      let packet: DecodedPacket;
      try {
        packet = decodePacket(frame.data, frame.timestamp, linkType);
      } catch (error) {
        this.log.warn({ err: error }, 'Decode failed for a frame');
        continue;
      }

      // Ring buffer: the oldest packet is evicted once the cap is reached.
      if (this.packets.length >= this.bufferSize) {
        this.packets.shift();
        this.droppedPackets += 1;
      }
      this.packets.push(toPacketDTO(packet, { redactPayload: env.redactPacketPayload }));

      // Detection runs on the decoded packet, never on the DTO, so redaction
      // cannot blind the detectors.
      const findings = this.engine?.inspect(packet) ?? [];
      if (findings.length > 0) {
        this.findingCount += findings.length;
        this.sink?.record(findings);
      }
    }
  }

  /** 503 when the library is missing, 500 for anything else pcap reports. */
  private toHttpError(error: unknown, context: string): HttpError {
    if (error instanceof HttpError) return error;
    if (error instanceof PcapUnavailableError)
      return HttpError.of(503, 'error.capture_unavailable', { detail: error.message });
    if (error instanceof PcapError)
      return HttpError.of(500, 'error.capture_failed', { context, detail: error.message });
    return HttpError.of(500, 'error.capture_failed', { context, detail: (error as Error).message });
  }
}

function clampSnapshotLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 65_536;
  // Below the Ethernet header nothing can be decoded; above 262144 wastes memory.
  return Math.min(Math.max(Math.trunc(value), 64), 262_144);
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 10;
  return Math.min(Math.trunc(value), 10_000);
}

function buildFilter(ipAddress: string | null | undefined): string {
  if (!ipAddress || ipAddress.trim() === '') return '';
  const candidate = ipAddress.trim();
  // The value goes into a BPF expression, so accept only IPv4/IPv6 literals.
  if (!isIpLiteral(candidate)) {
    throw HttpError.of(400, 'error.invalid_ip', { value: ipAddress });
  }
  return `host ${candidate}`;
}

function isIpLiteral(value: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4) {
    return ipv4.slice(1).every((octet) => Number(octet) <= 255);
  }
  // Permissive IPv6 check: hex groups and at most one '::'.
  return /^[0-9a-fA-F:]+$/.test(value) && (value.match(/::/g) ?? []).length <= 1 && value.includes(':');
}
