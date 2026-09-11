import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { captureControlLimiter, lookupLimiter } from '../middleware/rate-limit.js';
import { getGeolocationData } from '../networkservices/ip-geolocation.service.js';
import { getDomainName } from '../networkservices/ip-info.service.js';
import { getWhoisData } from '../networkservices/ip-whois.service.js';
import { withoutPayload } from '../packet/mapping.js';
import { actorOf } from '../services/audit.service.js';
import { auditCaptureStarted, auditCaptureStopped } from '../services/capture-audit.js';
import type { PacketCaptureService } from '../services/packet-capture.service.js';
import type { IpInfoResponse } from '../types/dto.js';
import { captureStartSchema, ipAddressSchema } from './validation.js';

/**
 * Replaces PacketCaptureController and PacketCaptureControllerWithIP, which were
 * duplicates apart from the extra `ipAddress` parameter on /start.
 *
 * Unlike the Java controllers these routes require a token: they can start
 * promiscuous capture on the host, which should not be open to anonymous callers.
 */

export interface PacketRouterOptions {
  /** True for the /api/ip/packets variant, where `ipAddress` becomes a BPF filter. */
  requireIpFilter: boolean;
}

export function createPacketRouter(capture: PacketCaptureService, options: PacketRouterOptions): Router {
  const router = Router();
  router.use(requireAuth);

  // Starting a capture is expensive (promiscuous mode, 10 MB kernel buffer) and
  // ip-info fans out to three external services, so both are limited separately
  // from ordinary reads.
  /*
   * SECURITY: starting a capture is an administrator's action.
   *
   * `requireAuth` alone left any authenticated USER able to put an interface
   * into promiscuous mode and then read `dataHexStream` — the entire raw frame,
   * hex-encoded — for every packet in the ring. That is a self-service network
   * tap, and under the documented capture deployment the process holds NET_RAW
   * and NET_ADMIN in the host network namespace.
   *
   * The earlier fix here stopped at "not anonymous" and never reached least
   * privilege; the comment above still said capture "should not be open to
   * anonymous callers", which was true and insufficient.
   */
  router.use(['/start', '/stop', '/clear'], requireRole('ADMIN'), captureControlLimiter);
  router.use('/ip-info', lookupLimiter);

  /** POST /start?interfaceName=&snaplength=&timeout=[&ipAddress=] */
  router.post(
    '/start',
    asyncHandler(async (req, res) => {
      const parsed = captureStartSchema.safeParse({ ...(req.body as object), ...req.query });
      if (!parsed.success) {
        throw HttpError.of(400, 'error.validation', {
          detail: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
      }
      const { interfaceName, snaplength, timeout, ipAddress } = parsed.data;

      if (options.requireIpFilter && !ipAddress) {
        throw HttpError.of(400, 'error.ip_required');
      }

      const started = await capture.startCapture(
        interfaceName,
        snaplength,
        timeout,
        options.requireIpFilter ? ipAddress : null,
        // Recorded with the session so an interruption notice can say whose
        // capture was cut short — see V18.
        actorOf(req.user).name,
      );

      /*
       * Each outcome gets its own answer, and only one of the three is an error.
       *
       * `starting` is a race worth telling the caller about: with
       * `CAPTURE_RESUME_ON_START=true` the banner and its Resume button go live
       * before the auto-resume fires, so an operator pressing it can lose.
       * Answering 200 with `capturing: false` sent the interface to Idle — and
       * `usePacketCapture` only polls while capturing is true, so it stayed there,
       * showing an interruption banner while a capture was in fact running.
       *
       * `running` is not an error at all. A client retry after a slow response, a
       * second administrator on the Capture screen, or a script that starts
       * idempotently all reach it, and the capture they asked for *is* running —
       * so they get the live status, as they did before any of this. Telling them
       * to wait for a start to settle would be advice about something that has
       * already settled.
       */
      if (started === 'starting') throw HttpError.of(409, 'error.capture_already_starting');

      /*
       * Audited only when this call started something.
       *
       * `running` answers 200 with the live status because the caller already has
       * what it asked for — a retry after a slow response, a second administrator
       * on the Capture screen, a script that starts idempotently. None of those
       * started a capture, and a trail that recorded them would show a row of
       * starts for one capture and give an operator no way to tell which was the
       * real one.
       *
       * The parsed values, not the clamped ones, matching what `capture_session`
       * records: the trail says what was asked for, and `capture-limits.ts` says
       * what the service will honour.
       */
      await auditCaptureStarted(actorOf(req.user), interfaceName, {
        scope: capture.scope,
        snapshotLength: snaplength,
        timeoutMs: timeout,
        filterIp: options.requireIpFilter ? (ipAddress ?? null) : null,
      });

      res.json(capture.getStatus());
    }),
  );

  /** POST /stop */
  router.post(
    '/stop',
    asyncHandler(async (req, res) => {
      /*
       * The interface is read before the stop, because the stop clears it.
       *
       * `getStatus().interfaceName` is null by the time `stopCapture` resolves, and
       * an audit row saying a capture was stopped without saying which one is the
       * half-record this action was added to avoid.
       */
      const stopping = capture.getStatus().interfaceName;
      const stopped = await capture.stopCapture();

      // Only a stop that ended a running capture. Pressing Stop on an idle screen
      // is not an event — see `stopCapture`, which is why it reports this.
      if (stopped) {
        await auditCaptureStopped(actorOf(req.user), stopping, { scope: capture.scope });
      }

      res.json(capture.getStatus());
    }),
  );

  /**
   * GET / — every packet currently in the buffer.
   *
   * Frame bytes are for administrators. Gating `/start` was only half the fix:
   * a USER could not begin a capture but could still read one an admin had
   * begun, and `REDACT_PACKET_PAYLOAD` is a single global flag with no setting
   * that gives frames to admins without giving them to everyone.
   *
   * A USER still gets the page — addresses, protocol, frame length, the decoded
   * headers — which is what makes the capture view useful. What they do not get
   * is the wire.
   */
  router.get('/', (req, res) => {
    const packets = capture.getCapturedPackets();
    const isAdmin = req.user?.role.toLowerCase() === 'admin';
    res.json(isAdmin ? packets : packets.map(withoutPayload));
  });

  /** POST /clear */
  router.post('/clear', (_req, res) => {
    capture.clearCapturedPackets();
    res.status(204).send();
  });

  /** GET /nif — available capture interfaces. */
  router.get('/nif', (_req, res) => {
    res.json(capture.getNetworkInterfaces());
  });

  /**
   * GET /status — capture state, which the Java API had no way to report.
   *
   * `interrupted.startedBy` is an administrator's email address, and this route is
   * behind `requireAuth` rather than `requireRole('ADMIN')` — that gate covers only
   * `/start`, `/stop` and `/clear`. So a USER polling status learned which
   * administrator had started the capture. The same decision two routes up strips
   * packet payloads for a non-admin; this is the same class and the same shape.
   *
   * The rest of the notice is kept: a USER seeing that capture stopped when the
   * service restarted is the point of the feature, and *who* started it is the only
   * part that is not theirs to know. `startCapture` is what records it — see V18 —
   * and `capture.start` in the audit trail now records it too, which is the proper
   * home for the answer and behind an ADMIN-only read, exactly as this redaction
   * wants it.
   */
  router.get('/status', (req, res) => {
    const status = capture.getStatus();
    const isAdmin = req.user?.role.toLowerCase() === 'admin';
    if (isAdmin || !status.interrupted) {
      res.json(status);
      return;
    }
    const { startedBy: _startedBy, ...interrupted } = status.interrupted;
    res.json({ ...status, interrupted });
  });

  /** GET /ip-info?ipAddress= — reverse DNS + WHOIS + geolocation. */
  router.get(
    '/ip-info',
    asyncHandler(async (req, res) => {
      const parsed = ipAddressSchema.safeParse(req.query);
      if (!parsed.success) {
        throw HttpError.of(400, 'error.validation', {
          detail: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
      }
      const { ipAddress } = parsed.data;

      // The Java version ran these three lookups one after another; in parallel the
      // response is as slow as the slowest rather than the sum.
      const [domainName, whoisData, geoData] = await Promise.all([
        getDomainName(ipAddress),
        getWhoisData(ipAddress),
        getGeolocationData(ipAddress),
      ]);

      const body: IpInfoResponse = { ipAddress, domainName, whoisData, geoData };
      res.json(body);
    }),
  );

  return router;
}
