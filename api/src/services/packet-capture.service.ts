import type { Logger } from 'pino';
import { env } from '../config/env.js';
import type { ErrorMessageKey } from '../i18n/catalog/errors.js';
import type { MessageParams } from '../i18n/message.js';
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
import {
  findInterruptedCapture,
  type InterruptedCapture,
  recordCaptureStarted,
  recordCaptureStopped,
} from './capture-session.service.js';
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
  /**
   * A capture the previous process was running and did not stop cleanly.
   *
   * Present until this process starts a capture of its own. Without it "Idle" is
   * the only thing the interface can say after a restart, and it means both
   * "nobody ever started one" and "this host was capturing until 03:14" — the
   * second being a gap in monitoring that nothing reports.
   */
  interrupted: InterruptedCapture | null;
}

/**
 * Why a capture ended, which is what decides whether it counts as interrupted.
 *
 * The record's question is not "did `stopCapture` run" — it always does — but
 * "did the operator ask for this". Only `operator` stamps the session finished.
 *
 * `shutdown` is the case the whole feature is for. `stopAllCaptures()` runs from
 * the SIGINT/SIGTERM handler, so a `docker compose restart`, a `systemctl
 * restart`, a machine reboot and Ctrl+C all reach `stopCapture` cleanly — and the
 * first version stamped every one of them stopped. That left the banner firing
 * only on SIGKILL, while V18, the README and the user guide all promised it for
 * "a container restart, a machine reboot", which deliver SIGTERM first. The
 * documented cases were exactly the ones it could not report.
 *
 * `read-error` is the pcap handle failing mid-run. An unattended capture dying on
 * its own is as worth reporting as one a reboot ended, and it was recording itself
 * as a clean stop too.
 */
export type CaptureStopReason = 'operator' | 'shutdown' | 'read-error';

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
  /**
   * A session the previous process left running, until this one starts its own.
   * Held in memory rather than re-read: the row is stamped stopped as soon as it
   * is discovered, so it is reportable exactly once, by the process that found it.
   */
  private interrupted: InterruptedCapture | null = null;
  private warnedAboutLinkType = false;

  /** Detection state belongs to a capture session, so both are created together. */
  private engine: DetectionEngine | null = null;
  private sink: AlertSink | null = null;

  /** Tagged with the session label, so the two captures are distinguishable in logs. */
  private readonly log: Logger;

  constructor(
    /** Also the session's key half in `capture_session` — see V18. */
    private readonly label: string,
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
      throw this.toHttpError(error, 'error.capture_enumerate');
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
    startedBy = 'unknown',
  ): Promise<void> {
    if (this.capturing) return;

    if (!interfaceName || interfaceName.trim() === '') {
      throw HttpError.of(400, 'error.interface_required');
    }

    const available = this.getNetworkInterfaces();
    if (!available.some((device) => device.name === interfaceName)) {
      // 400, not 404. The interface name arrives in the request body, so this is
      // "the value you sent is not one of the valid ones" — the same class as the
      // empty-name check above it. A 404 says the endpoint does not exist, which
      // sends any client that branches on status looking for a routing problem.
      // It was 400 before the message-key conversion and the change to 404 came
      // along with that mechanical edit rather than as a decision.
      throw HttpError.of(400, 'error.interface_not_found', { name: interfaceName });
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
      throw this.toHttpError(error, 'error.capture_open', { name: interfaceName });
    }

    try {
      if (filter !== '') handle.setFilter(filter);
    } catch (error) {
      handle.close();
      throw this.toHttpError(error, 'error.capture_filter');
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

    /*
     * The interruption notice is this process's to show, and it is answered the
     * moment a capture is running again. Cleared before the record is written so
     * the two cannot disagree if the write fails.
     */
    this.interrupted = null;

    // Recorded as the operator asked for it, not as the clamps left it — see V18.
    // Awaited, but it cannot throw: a bookkeeping failure warns and returns.
    await recordCaptureStarted(this.label, {
      interfaceName,
      snapshotLength,
      timeoutMs,
      filterIp: filterIpAddress ?? null,
      startedAt: this.startedAt,
      startedBy,
    });

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

  async stopCapture(reason: CaptureStopReason = 'operator'): Promise<void> {
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

    const wasCapturing = this.capturing;
    if (wasCapturing) {
      this.log.info({ bufferedPackets: this.packets.length, findings: this.findingCount }, 'Capture stopped');
    }
    this.capturing = false;
    this.startedAt = null;

    /*
     * Only for a capture that was actually running, and only when the operator
     * ended it. Stamping unconditionally would mark a session stopped that this
     * process never started — including the interrupted one it is meant to be
     * reporting — and stamping on shutdown would make every restart look like a
     * clean stop, which is the one thing this record exists to distinguish.
     */
    if (wasCapturing && reason === 'operator') await recordCaptureStopped(this.label);
    if (wasCapturing && reason !== 'operator') {
      this.log.warn({ reason }, 'Capture ended without being stopped; it will be reported as interrupted');
    }

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
      interrupted: this.interrupted,
    };
  }

  /**
   * Reads the last session at boot and decides what to do about it.
   *
   * Three outcomes, and the middle one is the whole point:
   *
   *  - nothing recorded, or it stopped cleanly — nothing to say.
   *  - it was still running and `CAPTURE_RESUME_ON_START` is off — remember it so
   *    the interface can report it, and stamp the row stopped so the *next* boot
   *    does not repeat a notice about an interruption already seen.
   *  - it was still running and resuming is on — start it again, which replaces
   *    the row and needs no notice.
   *
   * Never throws. A capture host that cannot reach its database must still be
   * able to capture, and this is bookkeeping about capture rather than capture.
   */
  /**
   * Reads the last session and remembers it, so the interface can report it.
   *
   * Split from resuming, which happens later in boot: reading the record depends
   * on nothing, while running a capture depends on the suppression rules and
   * indicator feeds being loaded. See `packet-capture.registry.ts`.
   *
   * The row is stamped stopped here whether or not it will be resumed, so the
   * notice belongs to the process that found it and a second restart does not
   * repeat a report about an interruption already seen. A resume replaces the row
   * anyway.
   *
   * Never throws. A capture host that cannot reach its database must still be
   * able to capture, and this is bookkeeping about capture rather than capture.
   */
  async reportInterruptedCapture(): Promise<void> {
    const previous = await findInterruptedCapture(this.label);
    if (!previous) return;

    this.interrupted = previous;
    this.log.warn(
      { interface: previous.interfaceName, startedAt: previous.startedAt },
      env.captureResumeOnStart
        ? 'A capture was interrupted by a restart; it will be resumed once detection is ready'
        : 'A capture was interrupted by a restart; it is NOT running. Set CAPTURE_RESUME_ON_START=true to resume automatically',
    );
    await recordCaptureStopped(this.label);
  }

  /**
   * Runs the interrupted capture again, if the installation asked for that.
   *
   * A no-op unless `reportInterruptedCapture` found one and
   * `CAPTURE_RESUME_ON_START` is set. Called after the suppression rules and
   * indicator feeds are loaded, so the first packets it decodes are matched
   * against what an operator actually configured.
   */
  async resumeInterruptedCapture(): Promise<void> {
    const previous = this.interrupted;
    if (!previous || !env.captureResumeOnStart || this.capturing) return;

    try {
      await this.startCapture(
        previous.interfaceName,
        previous.snapshotLength,
        previous.timeoutMs,
        previous.filterIp,
        previous.startedBy,
      );
      this.log.warn(
        { interface: previous.interfaceName },
        'Resumed the capture that was interrupted by a restart (CAPTURE_RESUME_ON_START)',
      );
    } catch (error) {
      /*
       * The interface may be gone — a renamed adapter, a container without the
       * host's network — so this is an ordinary outcome rather than a bug. The
       * notice stays on screen, which is what the operator needs either way.
       */
      this.log.warn(
        { err: error, interface: previous.interfaceName },
        'Could not resume the interrupted capture; reporting it instead',
      );
    }
  }

  private poll(): void {
    const handle = this.handle;
    if (!handle || handle.closed) return;

    try {
      this.consume(handle.drain(MAX_FRAMES_PER_TICK));
    } catch (error) {
      // A read error means the handle is unusable; stop rather than log per tick.
      this.log.error({ err: error }, 'Read failed; stopping capture');
      // Not an operator stop: a capture that died on its own is worth reporting.
      void this.stopCapture('read-error');
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
  /**
   * The failure, as a whole sentence the browser can translate.
   *
   * `context` used to be an English phrase interpolated into
   * `error.capture_failed: '{context}: {detail}'` — a pattern with no words of
   * its own, so the code looked converted while the entire rendered sentence was
   * whatever English was passed in. Each caller now names its own key and the
   * driver's message is the only parameter, which is the half that genuinely
   * cannot be translated: libpcap wrote it.
   */
  private toHttpError(error: unknown, contextKey: ErrorMessageKey, params: MessageParams = {}): HttpError {
    if (error instanceof HttpError) return error;
    if (error instanceof PcapUnavailableError) {
      // Which library to install is prose we write, so it is in the catalogue and
      // the platform picks the key. `detail` is the loader's own message, kept
      // verbatim for whoever has to search for it.
      return HttpError.of(
        503,
        process.platform === 'win32' ? 'error.capture_install_npcap' : 'error.capture_install_libpcap',
        { detail: error.detail },
      );
    }

    const detail = error instanceof PcapError ? error.message : (error as Error).message;
    return HttpError.of(500, contextKey, { ...params, detail });
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
