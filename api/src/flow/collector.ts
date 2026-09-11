import { createSocket, type Socket } from 'node:dgram';
import { componentLogger } from '../logger.js';
import { AlertSink } from '../services/alert.service.js';
import { currentAllowedExporters, currentFlowSettings } from '../services/flow-settings.service.js';
import { FlowDetectionEngine } from './detect.js';
import { FLOW_VERSION, looksLikeSflow, parseFlowDatagram } from './parse.js';
import { TemplateCache } from './templates.js';
import type { FlowProtocol, FlowRecord } from './types.js';

const log = componentLogger('flow');

/**
 * NetFlow/IPFIX collector.
 *
 * This is the deployment story for the whole product. Packet capture needs a
 * kernel driver, administrator rights and a SPAN port; a flow collector needs a
 * UDP socket. Node's `dgram` is built in, so there is no native module, nothing to
 * compile, and it runs unprivileged in the existing container. Setup on the
 * customer side is one line of switch or firewall configuration pointed at this
 * port.
 *
 * Exposure, stated plainly: this socket accepts unauthenticated UDP, and UDP
 * source addresses are trivially spoofable. Nothing in the format carries
 * authentication — that is a property of NetFlow, not of this implementation — so
 * a reachable collector can be fed fabricated flows by anyone who can route to
 * it. Two consequences are built in below: the allow-list of exporters
 * (FLOW_EXPORTERS) and a default bind that should be a management interface, not
 * 0.0.0.0, on any network where that matters.
 */

/**
 * Per-exporter counters. Surfacing these is not cosmetic: "am I actually
 * receiving anything?" is the first question during setup, and without per-device
 * numbers a half-working estate looks identical to a working one.
 */
export interface ExporterStats {
  exporter: string;
  version: number;
  protocolVersion: FlowProtocol | null;
  datagrams: number;
  records: number;
  /** Records awaiting a template that has not been sent yet. */
  pendingTemplates: number;
  malformed: number;
  lastSeen: string;
}

/**
 * Why datagrams were dropped before anything was read out of them.
 *
 * A single `ignored` total counted three unrelated causes, which is the same
 * complaint `flow.routes.ts` makes about a single record total one level up:
 * "configured but receiving nothing" and "receiving but nothing decodes" are
 * different problems and a sum cannot tell them apart. Here the three are an
 * allowlist that does not include the device, a device configured for sFlow,
 * and a NetFlow version this collector does not implement — and every one of
 * them has a different fix, on a different box.
 *
 * Worth splitting because none of the three is visible any other way: an
 * exporter rejected by the allowlist never reaches `statsFor`, so it does not
 * appear in the per-exporter list at all. Before this, the whole of what the
 * interface could say about a mistyped `FLOW_EXPORTERS` entry was that the
 * datagram count was climbing and the record count was not.
 */
export interface IgnoredDatagrams {
  /** Sender not in `FLOW_EXPORTERS`. */
  notAllowed: number;
  /** sFlow, which this collector does not implement — see `looksLikeSflow`. */
  sflow: number;
  /** A version word we have no parser for. */
  unsupportedVersion: number;
}

export interface FlowCollectorStatus {
  enabled: boolean;
  listening: boolean;
  address: string | null;
  port: number | null;
  datagrams: number;
  records: number;
  malformed: number;
  /** Total of `ignoredReasons`, kept because it is the headline number. */
  ignored: number;
  ignoredReasons: IgnoredDatagrams;
  /**
   * The senders `FLOW_EXPORTERS` permits. Empty accepts any.
   *
   * Reported so `ignoredReasons.notAllowed` can be acted on: "412 datagrams
   * refused" is only useful beside the list they were refused against, and an
   * operator comparing a device's address to that list is the whole diagnosis.
   *
   * Not privileged. This router's reads are open to any authenticated account by
   * a deliberate decision recorded in `route-guards.test.ts` — whether the
   * collector is listening is not a secret — and the per-exporter breakdown
   * beside this already names the addresses actually sending.
   */
  allowedExporters: string[];
  templatesCached: number;
  detection: ReturnType<FlowDetectionEngine['stats']>;
  exporters: ExporterStats[];
  startedAt: string | null;
}

/** Cap on distinct exporters tracked, so counters cannot grow on remote input. */
const MAX_TRACKED_EXPORTERS = 512;

/**
 * Receive buffer. Flow bursts arrive faster than a single-threaded event loop
 * drains them, and the kernel default (a few hundred KB) drops datagrams silently
 * under load — which looks like "detection missed it" rather than "the socket
 * overflowed".
 */
const RECEIVE_BUFFER_BYTES = 4 * 1024 * 1024;

export class FlowCollector {
  private socket: Socket | null = null;
  private readonly templates = new TemplateCache();
  private readonly engine = new FlowDetectionEngine();
  private sink: AlertSink | null = null;
  private startedAt: Date | null = null;

  private datagrams = 0;
  private records = 0;
  private malformed = 0;
  private readonly ignoredReasons: IgnoredDatagrams = {
    notAllowed: 0,
    sflow: 0,
    unsupportedVersion: 0,
  };
  private readonly exporters = new Map<string, ExporterStats>();
  private warnedAboutSflow = false;

  /** Starts listening. Resolves once bound, rejects if the port is unusable. */
  async start(): Promise<void> {
    if (this.socket) return;

    /*
     * The resolved settings, not `env.flow`.
     *
     * These are three-layer since V19 — environment → stored row → default — so
     * an administrator can change them from the browser. Read at bind time
     * rather than held, because `restart()` below reopens the socket after a
     * save and has to pick up what was just written.
     */
    const { port, bindAddress } = currentFlowSettings();
    // reuseAddr so a restart does not fail while the old socket lingers.
    const socket = createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (datagram, remote) => {
      this.handleDatagram(datagram, remote.address);
    });

    socket.on('error', (error) => {
      log.error({ err: error }, 'Flow socket error; closing');
      this.stop().catch(() => {
        /* already tearing down */
      });
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, bindAddress, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });

    try {
      socket.setRecvBufferSize(RECEIVE_BUFFER_BYTES);
    } catch (error) {
      // Not fatal: the OS may cap it below what we asked for (net.core.rmem_max).
      log.warn({ err: error }, 'Could not enlarge the flow receive buffer');
    }

    // The collector alone should not hold the process open.
    socket.unref();

    this.socket = socket;
    this.sink = new AlertSink();
    this.startedAt = new Date();

    const address = socket.address();
    log.info(
      {
        address: address.address,
        port: address.port,
        allowedExporters: this.allowedExporters().length > 0 ? [...this.allowedExporters()] : 'any',
        receiveBufferBytes: safeRecvBufferSize(socket),
      },
      `Flow collector listening on ${address.address}:${address.port} (NetFlow v5/v9, IPFIX)`,
    );
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = null;

    if (socket) {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      log.info({ datagrams: this.datagrams, records: this.records }, 'Flow collector stopped');
    }

    this.startedAt = null;

    // Flush before dropping the sink, or the last window of findings is lost.
    const sink = this.sink;
    this.sink = null;
    if (sink) {
      try {
        await sink.close();
      } catch (error) {
        log.error({ err: error }, 'Could not flush flow alerts');
      }
    }
  }

  /**
   * Handles one datagram. Never throws: an exception escaping a `message` handler
   * would reach the process-level uncaughtException handler and kill the API over
   * a single malformed packet from the network.
   */
  private handleDatagram(datagram: Buffer, exporter: string): void {
    try {
      this.datagrams += 1;

      if (!this.isAllowed(exporter)) {
        this.ignoredReasons.notAllowed += 1;
        return;
      }

      if (looksLikeSflow(datagram)) {
        this.ignoredReasons.sflow += 1;
        if (!this.warnedAboutSflow) {
          this.warnedAboutSflow = true;
          log.warn(
            { exporter },
            'Received sFlow, which is not supported; configure the device for NetFlow or IPFIX',
          );
        }
        return;
      }

      const observedAt = new Date();
      const result = parseFlowDatagram(datagram, exporter, observedAt, this.templates);

      // From the version word, not from the records: a template-only message is
      // perfectly valid IPFIX and carries no records to read it off.
      const stats = this.statsFor(exporter, result.version, protocolForVersion(result.version));
      stats.datagrams += 1;
      stats.records += result.records.length;
      stats.pendingTemplates += result.pendingTemplates;
      stats.malformed += result.malformed;
      stats.lastSeen = observedAt.toISOString();

      this.records += result.records.length;
      this.malformed += result.malformed;

      if (result.unsupported) {
        this.ignoredReasons.unsupportedVersion += 1;
        log.warn({ exporter, version: result.unsupported }, 'Unsupported flow version');
        return;
      }

      for (const record of result.records) {
        this.inspect(record);
      }
    } catch (error) {
      this.malformed += 1;
      log.error({ err: error, exporter, bytes: datagram.length }, 'Failed to handle a flow datagram');
    }
  }

  private inspect(record: FlowRecord): void {
    const findings = this.engine.inspect(record);
    if (findings.length > 0) this.sink?.record(findings);
  }

  /**
   * An empty allow-list accepts any source, which is the right default for a first
   * run — otherwise nothing arrives and there is no way to discover the exporter's
   * address. Setting FLOW_EXPORTERS once the devices are known is the hardening
   * step, and it is the only defence the format permits.
   */
  /**
   * The permitted senders, from the live settings, already parsed.
   *
   * Read per datagram rather than captured at bind time, and that is the point of
   * the whole feature: the allowlist is the one flow setting that changes in
   * ordinary operation, as devices are added, and it applies the moment it is
   * saved. Nothing is rebound and nothing in flight is lost.
   *
   * **Parsed once per settings change, not once per datagram.** The first version
   * of this called `exporterList(currentFlowSettings())` here, which split and
   * trimmed a string on the hot path — ahead of the cheap reject that is supposed
   * to make an unlisted exporter free to ignore, on the one code path whose
   * reason for existing is volume. `flow-settings.service.ts` caches the array
   * and refreshes it in `loadFlowSettings`, which is the only place that
   * re-resolves.
   */
  private allowedExporters(): readonly string[] {
    return currentAllowedExporters();
  }

  private isAllowed(exporter: string): boolean {
    const allowed = this.allowedExporters();
    return allowed.length === 0 || allowed.includes(exporter);
  }

  private statsFor(exporter: string, version: number, protocolVersion: FlowProtocol | null): ExporterStats {
    const existing = this.exporters.get(exporter);
    if (existing) {
      // Only overwrite the version with one we actually recognise. A single
      // stray datagram would otherwise leave a working IPFIX exporter displaying
      // "version 65535", which reads as a broken device during setup.
      if (protocolVersion) {
        existing.version = version;
        existing.protocolVersion = protocolVersion;
      } else if (existing.protocolVersion === null) {
        existing.version = version;
      }
      return existing;
    }

    if (this.exporters.size >= MAX_TRACKED_EXPORTERS) {
      // Reuse the oldest slot rather than growing. Losing per-device counters for
      // an implausible number of exporters is better than unbounded memory.
      const oldest = this.exporters.keys().next();
      if (!oldest.done) this.exporters.delete(oldest.value);
    }

    const created: ExporterStats = {
      exporter,
      version,
      protocolVersion,
      datagrams: 0,
      records: 0,
      pendingTemplates: 0,
      malformed: 0,
      lastSeen: new Date().toISOString(),
    };
    this.exporters.set(exporter, created);
    return created;
  }

  getStatus(): FlowCollectorStatus {
    const address = this.socket?.address();
    return {
      enabled: currentFlowSettings().enabled,
      listening: this.socket !== null,
      address: address?.address ?? null,
      port: address?.port ?? null,
      datagrams: this.datagrams,
      records: this.records,
      malformed: this.malformed,
      // Summed rather than counted separately, so the total and the breakdown
      // cannot drift — the failure a second counter would eventually produce.
      ignored:
        this.ignoredReasons.notAllowed + this.ignoredReasons.sflow + this.ignoredReasons.unsupportedVersion,
      ignoredReasons: { ...this.ignoredReasons },
      allowedExporters: [...this.allowedExporters()],
      templatesCached: this.templates.size,
      detection: this.engine.stats(),
      // Busiest first: on a real network one exporter dominates and that is the
      // one worth looking at.
      exporters: [...this.exporters.values()].sort((a, b) => b.records - a.records),
      startedAt: this.startedAt?.toISOString() ?? null,
    };
  }

  /** Flushes buffered findings without stopping. Used by the shutdown path. */
  async flush(): Promise<void> {
    await this.sink?.flush();
  }
}

/** Null for a version we do not implement, which keeps it out of the status. */
function protocolForVersion(version: number): FlowProtocol | null {
  switch (version) {
    case FLOW_VERSION.NETFLOW_V5:
      return 'netflow5';
    case FLOW_VERSION.NETFLOW_V9:
      return 'netflow9';
    case FLOW_VERSION.IPFIX:
      return 'ipfix';
    default:
      return null;
  }
}

function safeRecvBufferSize(socket: Socket): number | null {
  try {
    return socket.getRecvBufferSize();
  } catch {
    return null;
  }
}

/** One collector per process, since it owns a fixed UDP port. */
let collector: FlowCollector | null = null;

export function flowCollector(): FlowCollector {
  collector ??= new FlowCollector();
  return collector;
}

/** Starts the collector when configured. Never rejects: the API must still boot. */
export async function startFlowCollector(): Promise<void> {
  const settings = currentFlowSettings();
  if (!settings.enabled) {
    log.info('Flow collector disabled (switch it on in Administration settings, or set FLOW_ENABLED)');
    return;
  }
  try {
    await flowCollector().start();
  } catch (error) {
    // A busy port or a bad bind address should not stop the HTTP API from serving.
    log.error({ err: error, port: settings.port }, 'Could not start the flow collector');
  }
}

export async function stopFlowCollector(): Promise<void> {
  if (collector) await collector.stop();
}

/**
 * Closes the socket and opens it again on whatever the settings now say.
 *
 * For the three fields that are properties of a bound socket — `enabled`, `port`,
 * `bindAddress` — which cannot be changed on one. `exporters` never comes here:
 * it is a filter test per datagram and applies as soon as the cache is refreshed,
 * so rebinding for it would drop whatever is in flight to no purpose.
 *
 * **Stop first, unconditionally, and only then decide whether to start.** The
 * ordering hazards `PUT /api/adhoc/settings` took three review rounds to get
 * right are the same ones here, and this is the shape that avoids most of them:
 * there is one socket, the stop is idempotent, and switching off is simply the
 * case where nothing follows the stop.
 *
 * **Serialised, because within one call is not the same as between two.** The
 * stop and the start are ordered by the `await` between them, and that says
 * nothing about a second restart arriving in the middle. Two administrators
 * saving at once — or one double-submitting — interleave like this: A stops and
 * begins its start; B's stop runs before A has assigned `this.socket`, so it
 * finds nothing to close; A's assignment lands; B's start hits the
 * `if (this.socket) return` guard and returns without binding. The socket is
 * left on A's port while B is told it is listening on theirs.
 *
 * Each restart therefore chains onto the one before it. Low likelihood — it needs
 * two savers inside one bind — but the previous comment claimed the stronger
 * property, and the next person to add a caller would have read it as covering
 * them.
 *
 * Never throws. A save that leaves the collector unable to bind — the port is
 * taken, or the address is not on this host — is a real outcome an operator has
 * to be told about, and the way they are told is `listening: false` on the status
 * the form shows straight afterwards. Turning it into a failed request would say
 * the *save* failed, which is untrue: the row was written and is what the next
 * boot will use.
 */
let restartInFlight: Promise<void> = Promise.resolve();

export function restartFlowCollector(): Promise<void> {
  /*
   * Queued behind whatever restart is already running, and `catch` on the tail so
   * one failure does not poison every restart after it — `rebind` never rejects
   * anyway, and a chain that could is a chain that stops working silently.
   */
  restartInFlight = restartInFlight.then(rebind, rebind);
  return restartInFlight;
}

async function rebind(): Promise<void> {
  await stopFlowCollector();

  const settings = currentFlowSettings();
  if (!settings.enabled) {
    log.info('Flow collector switched off; the socket is closed');
    return;
  }

  try {
    await flowCollector().start();
    log.info({ port: settings.port, bindAddress: settings.bindAddress }, 'Flow collector rebound');
  } catch (error) {
    log.error(
      { err: error, port: settings.port, bindAddress: settings.bindAddress },
      'Could not rebind the flow collector after a settings change; it is not listening',
    );
  }
}
