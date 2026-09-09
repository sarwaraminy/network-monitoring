import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { captureControlLimiter, lookupLimiter } from '../middleware/rate-limit.js';
import { getGeolocationData } from '../networkservices/ip-geolocation.service.js';
import { getDomainName } from '../networkservices/ip-info.service.js';
import { getWhoisData } from '../networkservices/ip-whois.service.js';
import { withoutPayload } from '../packet/mapping.js';
import { actorOf } from '../services/audit.service.js';
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

      await capture.startCapture(
        interfaceName,
        snaplength,
        timeout,
        options.requireIpFilter ? ipAddress : null,
        // Recorded with the session so an interruption notice can say whose
        // capture was cut short — see V18.
        actorOf(req.user).name,
      );
      res.json(capture.getStatus());
    }),
  );

  /** POST /stop */
  router.post(
    '/stop',
    asyncHandler(async (_req, res) => {
      await capture.stopCapture();
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

  /** GET /status — capture state, which the Java API had no way to report. */
  router.get('/status', (_req, res) => {
    res.json(capture.getStatus());
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
