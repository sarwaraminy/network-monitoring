import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { startFlowCollector, stopFlowCollector } from './flow/collector.js';
import { startIntel, stopIntel } from './intel/registry.js';
import { componentLogger, logger } from './logger.js';
import { reloadNotifier } from './notify/notifier.js';
import { loadDeliverySettings, seedFromEnvironment } from './notify/settings.service.js';
import { libraryVersion } from './packet/libpcap.js';
import { stopAllCaptures } from './services/packet-capture.registry.js';
import { startRetention, stopRetention } from './services/retention.service.js';
import { flushSuppressionCounters, refreshSuppressions } from './services/suppression.service.js';

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

  // After listen(), so a flow port that is already in use cannot stop the API
  // from serving. startFlowCollector logs and returns rather than rejecting.
  await startFlowCollector();

  /*
   * Delivery settings, before anything can raise a finding.
   *
   * Seeding first, then loading. The order matters on the boot after an upgrade: an
   * operator who has been running with NOTIFY_MIN_SEVERITY=critical in api/.env for
   * a year should keep that setting when they eventually delete the line, rather
   * than silently reverting to the code default and getting alerts they had
   * deliberately switched off. Seeding writes what the environment currently says
   * into any field the row has no opinion about; it never overwrites a value saved
   * through the UI.
   *
   * Both fail soft — see notify/settings.service.ts. A database that cannot be read
   * leaves delivery exactly as the environment describes it, which is what this
   * process did before the table existed.
   */
  const seeded = await seedFromEnvironment();
  if (seeded.length > 0) log.info({ fields: seeded.length }, 'Delivery settings seeded from the environment');
  await loadDeliverySettings();

  // listen() and startFlowCollector() above can already have built the notifier
  // singleton against pre-DB settings (env and code defaults only), and nothing else
  // ever rebuilds it. Without this, a request or an early finding landing in that
  // window freezes the notifier there for the process's lifetime, silently ignoring
  // every stored delivery setting until an admin happens to resave the form.
  await reloadNotifier();

  // Before any capture can be started, so the first findings of the process are
  // filtered by the rules an operator already wrote. It fails open — see
  // services/suppression.service.ts — so a failure here costs noise, not alerts.
  const rules = await refreshSuppressions();
  log.info({ rules: rules.size }, 'Suppression rules loaded');

  // Also after listen(): loading feeds can take seconds and may reach the
  // network, and neither should delay the API becoming available.
  await startIntel();

  // Schedules the first sweep a minute out rather than running one now. Startup is
  // already doing migrations, feeds and sockets, and nothing expires in that minute
  // which would not still be expired afterwards.
  startRetention();

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
      // Order matters: stopping a capture or the flow collector flushes buffered
      // findings, and that write needs the pool. Closing the database first would
      // lose them.
      await stopAllCaptures();
      await stopFlowCollector();
      // Both of those flush their own sinks, which flushes suppression counts
      // with them. This catches the counts of a process that suppressed
      // findings without ever storing one — the case where a rule is doing all
      // of the work and its match count is the only evidence of it.
      await flushSuppressionCounters();
      stopRetention();
      stopIntel();
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
