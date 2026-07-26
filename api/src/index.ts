import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { componentLogger, logger } from './logger.js';
import { libraryVersion } from './packet/libpcap.js';
import { stopAllCaptures } from './services/packet-capture.registry.js';

const log = componentLogger('server');

/** How long shutdown may take before the process is killed anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  if (env.dbAutoMigrate) {
    await runMigrations();
  }

  const server = createApp().listen(env.port, () => {
    log.info(
      {
        port: env.port,
        env: env.nodeEnv,
        corsOrigins: env.corsOrigins,
        captureLibrary: libraryVersion(),
      },
      `Network Monitoring API listening on http://localhost:${env.port}`,
    );
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    // A second Ctrl+C should not restart the sequence.
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Shutting down');

    // Hard deadline, in case a socket or the database refuses to let go.
    const deadline = setTimeout(() => {
      log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown timed out; exiting anyway');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    deadline.unref();

    try {
      // Order matters: stopping a capture flushes buffered findings, and that
      // write needs the pool. Closing the database first would lose them.
      await stopAllCaptures();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
      log.info('Shutdown complete');
    } catch (error) {
      log.error({ err: error }, 'Error during shutdown');
    } finally {
      clearTimeout(deadline);
      // Flush any buffered log output before the process goes away.
      logger.flush?.();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // An unhandled rejection leaves the process in an unknown state; log it loudly
  // rather than letting Node's default terminate silently.
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'Uncaught exception; exiting');
    logger.flush?.();
    process.exit(1);
  });
}

// Top-level await: this is an ES module, so there is no need for a promise chain.
try {
  await main();
} catch (error) {
  log.fatal({ err: error }, 'Failed to start');
  logger.flush?.();
  process.exit(1);
}
