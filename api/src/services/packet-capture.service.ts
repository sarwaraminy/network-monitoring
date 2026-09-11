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
import { AUTO_RESUME_ACTOR, MAX_CAPTURE_TIMEOUT_MS, MAX_SNAPSHOT_LENGTH } from './capture-limits.js';
import {
  type CaptureSessionRecord,
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
   * True while this process still intends to resume the interruption below by
   * itself.
   *
   * The interface polls on it, and needs it because `interrupted` alone does not
   * say whether anything is going to happen: with `CAPTURE_RESUME_ON_START` on
   * the server is about to start a capture and the page must keep asking to see
   * it, and with the flag off — the default — nothing will clear the notice until
   * a person acts, so asking again changes nothing.
   *
   * False once the attempt has been made, whether it worked or not. A resume that
   * failed leaves the notice standing and the row open for the next boot, but
   * nothing further will happen in *this* process, so there is nothing left to
   * wait for.
   */
  resumePending: boolean;
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

/**
 * What a `startCapture` call did.
 *
 * Three outcomes rather than a boolean, because the two failures want different
 * answers from the route: `starting` is a race worth retrying, and `running`
 * means the caller already has what it asked for.
 */
export type StartOutcome = 'started' | 'starting' | 'running';

export class PacketCaptureService {
  private handle: PcapHandle | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private capturing = false;
  /**
   * A start that has claimed the instance but not yet finished.
   *
   * Distinct from `capturing`, which describes a capture that is actually
   * running: this one exists to keep a second caller out during the awaits
   * between the two. See `startCapture`.
   */
  private starting = false;
  /**
   * The in-flight write recording that this capture started.
   *
   * Held so `stopCapture` can wait for it: the capture becomes stoppable before
   * the insert commits, and a stop that runs first would find no row to close.
   */
  private sessionWrite: Promise<void> | null = null;
  /**
   * The start currently running, so a stop can wait for it rather than act
   * before it. See `stopCapture`.
   */
  private startInFlight: Promise<void> | null = null;
  /**
   * Whether the automatic resume has already had its turn in this process.
   *
   * Set whether it started a capture or not: what it records is that nothing
   * further is coming without a person, which is what `resumePending` reports.
   */
  private resumeAttempted = false;
  private interfaceName: string | null = null;
  private filter: string | null = null;
  private linkType: string | null = null;
  private startedAt: Date | null = null;

  private readonly packets: PacketDTO[] = [];
  private droppedPackets = 0;
  private findingCount = 0;
  /**
   * An interruption this process has to report: either one the previous process
   * left behind, or one that happened here — see `stopCapture`.
   *
   * Held in memory rather than re-read. With resuming off the row is stamped as
   * soon as it is found, so it is reportable exactly once, by the process that
   * found it; with resuming on it stays open until a resume succeeds, and this
   * field is what keeps the notice on screen meanwhile.
   */
  private interrupted: InterruptedCapture | null = null;
  /**
   * What this process is capturing, kept so a capture that ends on its own can
   * report itself.
   *
   * The individual fields above cover what `/status` shows while a capture runs;
   * this is the whole session record, which is what an interruption notice needs
   * — the interface, who started it, and when. Held rather than re-read, because
   * the moment it is wanted is the moment the handle has just failed, and a
   * database round trip is the wrong thing to depend on then.
   */
  private session: CaptureSessionRecord | null = null;
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
   * Starts a capture, and claims the right to do so before yielding.
   *
   * `capturing` is only true once the handle is open and the session recorded,
   * which is several awaits in — so it cannot be the thing that keeps two callers
   * out. `starting` is set synchronously, before the first `await`, which is what
   * makes the claim atomic with respect to other callers on this instance.
   *
   * There are two callers now, and the gap between them is wide and inviting:
   * with `CAPTURE_RESUME_ON_START=true` the banner and its Resume button go live
   * early in boot, while the auto-resume waits for `startIntel()`, which can take
   * seconds. An operator who sees the banner and presses Resume in that gap is
   * doing the obvious thing at the obvious moment — and without this both starts
   * would proceed, leaving two `openLive()` handles and two poll timers on one
   * instance, the first of each never released. The process would then leak a pcap
   * handle and double-count every packet until it restarted.
   *
   * The hole predates the second caller; it is the second caller that makes it
   * reachable.
   *
   * Returns *why* it did or did not start, not merely whether it did.
   *
   * Declining is a real outcome now that two callers exist, and a caller that
   * assumes "returned, therefore started" reports something that did not happen —
   * see `resumeInterruptedCapture`. The two ways of declining are not the same
   * answer either: a caller racing a start in flight should try again in a
   * moment, and a caller asking for a capture that is already running has already
   * got what it asked for.
   *
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
  ): Promise<StartOutcome> {
    if (this.capturing) return 'running';
    if (this.starting) return 'starting';

    this.starting = true;
    /*
     * Held so `stopCapture` can wait for it. The flag alone tells a second
     * *start* to stand down; a stop needs the thing itself, because it has to act
     * once the start has finished rather than decline.
     */
    this.startInFlight = this.openCapture(
      interfaceName,
      snapshotLength,
      timeoutMs,
      filterIpAddress,
      startedBy,
    );
    try {
      await this.startInFlight;
      return 'started';
    } finally {
      // Cleared on the way out either way: a failed start must not leave the
      // instance refusing every later attempt.
      this.starting = false;
      this.startInFlight = null;
    }
  }

  /**
   * The body of a start, once the right to run it has been claimed.
   *
   * Separate only so `startCapture` can hold `starting` across the whole of it
   * without this being indented inside a `try`.
   */
  private async openCapture(
    interfaceName: string,
    snapshotLength: number,
    timeoutMs: number,
    filterIpAddress?: string | null,
    startedBy = 'unknown',
  ): Promise<void> {
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
    this.session = {
      interfaceName,
      snapshotLength,
      timeoutMs,
      filterIp: filterIpAddress ?? null,
      startedAt: this.startedAt,
      startedBy,
    };
    /*
     * Kept as a promise, because a stop has to wait for it and a start does not.
     *
     * The capture is live and stoppable several lines above this — the handle is
     * open and the poll timer running — so a `POST /stop` can arrive before the
     * insert has committed. Its update is scoped to `started_at`, which is the
     * right fix for the previous round and is what makes the ordering matter now:
     * it matches nothing, returns, and then this insert lands *unstamped*. A
     * capture the operator stopped cleanly is then recorded as still running —
     * reported as interrupted at the next boot and, with resuming on, started
     * again by itself. The feature doing the wrong thing confidently.
     *
     * Making the start wait instead would let bookkeeping delay capture, which
     * this record is explicitly not allowed to do. The stop is the operation whose
     * correctness depends on the write, so the stop is what waits.
     */
    this.sessionWrite = recordCaptureStarted(this.label, this.session);

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
    /*
     * Wait for a start that has claimed the instance but not finished.
     *
     * `startCapture` fences a competing *start* with `starting`; this is the other
     * side of the same flag, and without it a stop landing inside the start window
     * did nothing at all: `pollTimer` and `handle` are still null, `capturing` is
     * still false, so it closed nothing, stamped nothing and answered
     * `capturing: false`. The start then completed — opening the handle, starting
     * the timer and writing an *open* session row — so the interface showed Idle
     * and never corrected itself (`usePacketCapture` polls only while capturing),
     * the next boot reported an interruption that never happened, and with
     * resuming on it restarted the capture the operator had explicitly stopped.
     *
     * Waiting rather than refusing: the operator asked for the capture to stop,
     * and a stop that arrives a moment early should still stop it.
     *
     * Cannot reject in a way that matters here — a failed start leaves `capturing`
     * false and everything below is a no-op.
     */
    if (this.startInFlight) await this.startInFlight.catch(() => {});

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
    const session = this.session;
    this.session = null;
    /*
     * Cleared here rather than after the awaits, with everything else this stop
     * is giving up.
     *
     * It used to outlive the teardown it describes — the handle closed and the
     * poll timer cleared above, `session` already detached, and `capturing` still
     * true across both awaits. Two things went wrong in that gap, and both are
     * this asymmetry rather than two bugs:
     *
     *  - A second stop entering read `wasCapturing === true` with `session` already
     *    null, so it fell to the unscoped `recordCaptureStopped(label, {})` — no
     *    `started_at` and no `stopped_at IS NULL` — and stamped whatever row was
     *    there. A `read-error` stop deliberately leaves its row open so the next
     *    boot can report it; an operator stop racing one closed it, and the next
     *    boot then found nothing, reported nothing and never resumed. The capture
     *    that died on its own, silently forgotten.
     *  - A `POST /start` landing there was told `'running'` about a capture whose
     *    handle was already closed, so the start was dropped and answered 200. A
     *    moment later the stop finished and the interface went Idle with no error
     *    and nothing to retry against — the mirror of the start-side race this
     *    branch already fixed.
     */
    this.capturing = false;
    this.startedAt = null;

    /*
     * Detaching everything this stop is responsible for, before it yields.
     *
     * `this.capturing` goes false above and this function then awaits twice —
     * `sessionWrite` and `recordCaptureStopped` — with no claim held. A
     * `POST /start` landing in that gap passes every guard and installs a fresh
     * handle, poll timer, sink and engine. Reading `this.sink` and `this.engine`
     * *after* those awaits therefore picked up the new capture's objects, and the
     * stop nulled them and closed the new sink.
     *
     * What that leaves is the worst shape this feature has: a capture genuinely
     * running, reporting `capturing: true`, with a live handle and a poll timer
     * feeding a null engine. No findings, no alerts, no device recording, for the
     * whole life of that capture — and nothing on screen different from a working
     * one, because the packet count still climbs.
     *
     * The window is this branch's own: before the stop was made to wait for the
     * record it closes, nothing was awaited between clearing `capturing` and
     * reading the sink, so the two could not interleave. Same treatment as
     * `session` above, and for the same reason.
     */
    const sink = this.sink;
    this.sink = null;
    this.engine = null;

    /*
     * Let the start's own record land before deciding anything about it.
     *
     * Cannot reject — `recordCaptureStarted` warns and returns on failure — so
     * this only ever costs the wait, and only when a stop lands inside the window
     * where a capture is running but its row is not yet written.
     */
    /*
     * Only retire the handle actually awaited.
     *
     * `capturing` is cleared synchronously above, which is what lets a
     * `POST /start` pass every guard while this await is in flight — and that
     * start assigns its own promise to `this.sessionWrite`. Nulling the field
     * unconditionally threw that one away, and the damage landed on the *next*
     * stop: it found `sessionWrite === null`, skipped the wait, and ran its
     * scoped `recordCaptureStopped` before the start's insert had committed. The
     * update matched nothing, the insert landed afterwards with `stopped_at`
     * still null, and a capture the operator stopped cleanly was reported as
     * interrupted at the next boot — and with resuming on, started again by
     * itself. The same end state this branch has already closed twice by other
     * routes.
     */
    const pending = this.sessionWrite;
    if (pending) {
      await pending;
      if (this.sessionWrite === pending) this.sessionWrite = null;
    }
    if (wasCapturing) {
      this.log.info({ bufferedPackets: this.packets.length, findings: this.findingCount }, 'Capture stopped');
    }

    /*
     * Only for a capture that was actually running, and only when the operator
     * ended it. Stamping unconditionally would mark a session stopped that this
     * process never started — including the interrupted one it is meant to be
     * reporting — and stamping on shutdown would make every restart look like a
     * clean stop, which is the one thing this record exists to distinguish.
     */
    /*
     * Scoped to the session this process started, so a stop cannot close a row
     * that belongs to somebody else's capture — see `recordCaptureStopped`.
     */
    if (wasCapturing && reason === 'operator') {
      await recordCaptureStopped(this.label, session ? { startedAt: session.startedAt } : {});
    }
    if (wasCapturing && reason !== 'operator') {
      this.log.warn({ reason }, 'Capture ended without being stopped; it will be reported as interrupted');
      /*
       * Reported here as well as at the next boot, and the difference matters.
       *
       * Leaving the row open is what lets the *next* process say something. It
       * says nothing about this one — and `read-error` happens while this process
       * goes on running and serving `/status`, which showed a bare "Idle" for a
       * capture that had just died under it. Two things followed: an operator who
       * started a new capture overwrote the row and erased the incident with no
       * record anywhere, and one who did not was told at the next restart that a
       * restart had ended it, which was false.
       *
       * Built from the session this process started rather than re-read, so it
       * holds even when the database is what failed.
       *
       * `!this.capturing` because this runs after the awaits above: a start that
       * took over in the meantime has already cleared the notice, and putting the
       * old session back would leave a stale interruption attached to a capture
       * that is running. Found while fixing the sink, and the same shape — a write
       * to an instance field the concurrent start now owns.
       */
      if (session && !this.capturing) {
        this.interrupted = {
          interfaceName: session.interfaceName,
          filterIp: session.filterIp,
          snapshotLength: session.snapshotLength,
          timeoutMs: session.timeoutMs,
          startedAt: session.startedAt.toISOString(),
          startedBy: session.startedBy,
        };
      }
    }

    // Write out whatever the detectors found before the sink is discarded.
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
      resumePending: env.captureResumeOnStart && this.interrupted !== null && !this.resumeAttempted,
    };
  }

  /**
   * Reads the last session and remembers it, so the interface can report it.
   *
   * Split from resuming, which happens later in boot: reading the record depends
   * on nothing, while running a capture depends on the suppression rules and
   * indicator feeds being loaded. See `packet-capture.registry.ts`.
   *
   * **Whether the row is stamped stopped here depends on whether a resume will be
   * attempted**, and that is the whole of the difference between reporting an
   * interruption once and losing it. With resuming off, the row is stamped: the
   * notice belongs to the process that found it, and a second restart should not
   * repeat a report about an interruption already seen. With resuming on, the row
   * is left open until the resume actually succeeds — a successful one replaces it
   * anyway, and a failed one needs it to still be there.
   *
   * Never throws. A capture host that cannot reach its database must still be
   * able to capture, and this is bookkeeping about capture rather than capture.
   */
  async reportInterruptedCapture(): Promise<void> {
    /*
     * Nothing to report if this process is already capturing — the open row is
     * then its own.
     *
     * `index.ts` calls this after `listen()`, so the API is accepting requests
     * before it runs: an operator or a retrying client can start a capture in that
     * window, and without this guard the row that capture just wrote is read back
     * as an interruption and stamped stopped underneath it. The capture goes on
     * running with no open session, so the interruption that ends it later leaves
     * nothing for the next boot to find — the failure is silent and lands exactly
     * where the feature was supposed to speak up.
     *
     * This does not cover two processes sharing a `SENSOR_ID` — a rolling
     * redeploy, or a scaled-out API — where the booting process stamps the other
     * one's live capture stopped with no race at all. That wants the row keyed to
     * the process that owns it, which is a schema change and a separate piece of
     * work; it is written down in the roadmap's known gaps.
     */
    if (this.capturing) return;

    const previous = await findInterruptedCapture(this.label);
    if (!previous) return;

    /*
     * Checked again, because the read above yields.
     *
     * The check before it is not enough on its own: a capture that starts while
     * the query is in flight is invisible to it, and the row that capture just
     * wrote is what comes back as `previous`. From there the sequence is the one
     * the guard exists to prevent — the notice is set while a capture is running,
     * and with resuming off the stamp below closes the live session, so the
     * capture continues with nothing open and the next boot finds nothing to
     * report.
     *
     * One query's width rather than five awaited startup steps, so it is narrow;
     * it also fails in the direction that destroys the evidence, which is the
     * direction worth spending a second comparison on.
     */
    if (this.capturing) return;

    this.interrupted = previous;
    this.log.warn(
      { interface: previous.interfaceName, startedAt: previous.startedAt },
      env.captureResumeOnStart
        ? 'A capture did not stop cleanly; it will be resumed once detection is ready'
        : 'A capture did not stop cleanly; it is NOT running. Set CAPTURE_RESUME_ON_START=true to resume automatically',
    );
    /*
     * Stamped only when nothing is going to try to bring it back.
     *
     * Stamping unconditionally, before the resume, made the ordinary failure
     * permanent: with `CAPTURE_RESUME_ON_START=true` the host reboots, the
     * interface is not up yet when the resume runs, the resume fails — and the
     * only surviving trace is a notice in the memory of a process nobody is
     * watching. The next boot finds no interrupted session and does not try again,
     * so unattended capture is off for good, reached through the switch that
     * exists to prevent exactly that. The more failure-prone the host, the more
     * likely it was.
     */
    /*
     * Scoped to the row that was actually read.
     *
     * The two `this.capturing` checks above cover the decision; this covers the
     * write, which is the half they cannot reach. A start that is mid-flight has
     * already written its own open row while its flag is still false, so without
     * the scope this closes that row instead of the one `previous` came from.
     */
    if (!env.captureResumeOnStart) {
      await recordCaptureStopped(this.label, { startedAt: new Date(previous.startedAt) });
    }
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

    // Its turn is taken from here, however it goes: `resumePending` is about
    // whether anything more will happen on its own, not about success.
    this.resumeAttempted = true;

    /*
     * The row is still open at this point — `reportInterruptedCapture` leaves it
     * that way when resuming is on. A successful `startCapture` replaces it; a
     * failed one leaves it open on purpose, so the next boot finds the session
     * again and tries again.
     */

    try {
      const started = await this.startCapture(
        previous.interfaceName,
        previous.snapshotLength,
        previous.timeoutMs,
        previous.filterIp,
        /*
         * Not `previous.startedBy`. Nobody started this one — the service did,
         * unattended, at boot — and `startedBy` is the column V18 and the README
         * describe as the record of who started a capture, redacted from
         * non-admin `/status` precisely because it names a person. Inheriting it
         * would file a machine's action against somebody who was not there, and
         * the better the auto-resume works the more of those accumulate.
         *
         * The original operator is not lost: they stay on the interruption notice,
         * which carries `previous.startedBy` for exactly that purpose.
         */
        AUTO_RESUME_ACTOR,
      );
      /*
       * Only when this call is what started it. `startCapture` declines if
       * another caller holds the instance — an operator pressing Resume in the
       * gap before this runs — and logging regardless said the interruption had
       * been handled when it had not. On an unattended host the log is the only
       * thing anybody reads, so a false claim there is the expensive kind.
       */
      if (started !== 'started') return;
      this.log.warn(
        { interface: previous.interfaceName },
        'Resumed the capture that did not stop cleanly (CAPTURE_RESUME_ON_START)',
      );
    } catch (error) {
      /*
       * The interface may be gone — a renamed adapter, a container without the
       * host's network — so this is an ordinary outcome rather than a bug. The
       * notice stays on screen, which is what the operator needs either way.
       */
      this.log.warn(
        { err: error, interface: previous.interfaceName },
        'Could not resume the interrupted capture; reporting it, and the next restart will try again',
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

/*
 * Still clamped, even though `captureStartSchema` now refuses anything past these
 * ceilings. The schema guards the HTTP route; these guard the function, which is
 * also called by the auto-resume from a stored row — and a row written before the
 * bound existed can hold a value the schema would now reject.
 */
function clampSnapshotLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 65_536;
  // Below the Ethernet header nothing can be decoded; above the ceiling wastes memory.
  return Math.min(Math.max(Math.trunc(value), 64), MAX_SNAPSHOT_LENGTH);
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 10;
  return Math.min(Math.trunc(value), MAX_CAPTURE_TIMEOUT_MS);
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
