import { pino } from 'pino';

/**
 * Structured logging.
 *
 * Replaces scattered `console.log` calls. JSON in production so a log shipper can
 * index the fields; pretty-printed in development so it stays readable. Log lines
 * carry a `component` so capture, detection and HTTP output can be told apart.
 *
 * The level resolves as: LOG_LEVEL, else silent under the test runner (so test
 * output is not buried), else info.
 */

const isTestRun =
  process.env.NODE_ENV === 'test' ||
  process.argv.includes('--test') ||
  process.argv.some((argument) => argument.endsWith('.test.ts'));

function resolveLevel(): string {
  const configured = process.env.LOG_LEVEL?.trim();
  if (configured) return configured;
  return isTestRun ? 'silent' : 'info';
}

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: resolveLevel(),
  // Pretty output is a development convenience only; production stays as JSON.
  ...(isProduction || isTestRun
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
  redact: {
    // Defence in depth: even if a token or password reached a log call, it would
    // not be written out.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      '*.password',
      '*.token',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  base: undefined, // Drop pid/hostname; the container or host already knows them.
});

/** A child logger tagged with the subsystem it belongs to. */
export function componentLogger(component: string) {
  return logger.child({ component });
}
