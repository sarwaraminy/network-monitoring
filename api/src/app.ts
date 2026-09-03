import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { pool } from './db/index.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiLimiter, authLimiter } from './middleware/rate-limit.js';
import { alertsRouter } from './routes/alerts.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { flowRouter } from './routes/flow.routes.js';
import { intelRouter } from './routes/intel.routes.js';
import { logsRouter } from './routes/logs.routes.js';
import { notifyRouter } from './routes/notify.routes.js';
import { createPacketRouter } from './routes/packets.routes.js';
import { suppressionsRouter } from './routes/suppressions.routes.js';
import { filteredIpCapture, interfaceCapture } from './services/packet-capture.registry.js';

/** Replaces NetworkMonitoringApplication + WebMvcConfig + SecurityConfig. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  /*
   * Opt-in, because trusting a header nobody sets is worse than not trusting it.
   *
   * express-rate-limit keys on `req.ip`, and with `trust proxy` on that is taken
   * from `X-Forwarded-For`. Enabled unconditionally — as it was — an API reached
   * directly, which is exactly what the host-install path in the README
   * produces, let any caller send a fresh `X-Forwarded-For` per request and never
   * trip the auth limiter. That turns the bcrypt login route into an unthrottled
   * password oracle, the precise risk the limiter exists to prevent.
   *
   * Set TRUST_PROXY=true only when something in front of the API is actually
   * appending the header.
   */
  if (env.trustProxy) app.set('trust proxy', 1);

  // --- Security headers ---
  app.use(
    helmet({
      // This process serves JSON only; the UI is a separate static bundle. A
      // restrictive policy costs nothing here.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      // Only meaningful over HTTPS; harmless otherwise, and correct once deployed.
      hsts: env.isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
  );

  // --- Request logging with a correlation id ---
  app.use(
    pinoHttp({
      logger: logger.child({ component: 'http' }),
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      // Health checks would otherwise dominate the log.
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    cors({
      // Was hardcoded to http://localhost:3000 in WebMvcConfig.
      origin: env.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['Authorization', 'x-request-id'],
      maxAge: 86_400,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // --- Probes, unauthenticated and unlogged ---
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  /** Readiness: reports whether the database is actually reachable. */
  app.get('/ready', (_req, res) => {
    pool
      .query('SELECT 1')
      .then(() => res.json({ status: 'ready', database: 'up' }))
      .catch((error: unknown) => {
        res.status(503).json({
          status: 'not-ready',
          database: 'down',
          message: error instanceof Error ? error.message : 'unknown error',
        });
      });
  });

  app.use('/auth', authLimiter, authRouter);
  app.use('/api', apiLimiter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/flow', flowRouter);
  app.use('/api/intel', intelRouter);
  app.use('/api/notify', notifyRouter);
  app.use('/api/suppressions', suppressionsRouter);
  app.use('/api/packets', createPacketRouter(interfaceCapture, { requireIpFilter: false }));
  app.use('/api/ip/packets', createPacketRouter(filteredIpCapture, { requireIpFilter: true }));
  // Legacy: the per-packet anomaly log that `alerts` supersedes. Kept so existing
  // history stays reachable; nothing writes to it any more.
  app.use('/api', logsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
