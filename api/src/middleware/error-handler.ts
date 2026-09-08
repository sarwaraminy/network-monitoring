import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { type ErrorMessageKey, renderError } from '../i18n/catalog/errors.js';
import { DEFAULT_LOCALE } from '../i18n/locales.js';
import type { MessageParams } from '../i18n/message.js';
import { componentLogger } from '../logger.js';

const log = componentLogger('http');

/** Thrown by route handlers to produce a specific status code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * The catalogue entry this error is, when it has one.
     *
     * Null for the errors assembled at runtime out of something that is already
     * prose — a zod aggregation, a driver's own message — where there is no fixed
     * sentence to name. Those reach the interface as English, which is what they
     * were before.
     */
    readonly code: ErrorMessageKey | null = null,
    readonly params: MessageParams = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /**
   * The normal way to raise one: name the message, pass what it interpolates.
   *
   * `message` is rendered here, in English, from the same key and params the
   * response carries — so the two cannot drift, and the English sentence stays
   * available to every client that has never heard of codes, to `grep`, and to the
   * server log. Translating happens in the browser; see errors.en.ts for why not
   * here.
   */
  static of(status: number, code: ErrorMessageKey, params: MessageParams = {}): HttpError {
    return new HttpError(status, renderError(code, params, DEFAULT_LOCALE), code, params);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  send(res, HttpError.of(404, 'error.no_route', { method: req.method, path: req.path }));
}

/**
 * Writes an error as the body every client reads.
 *
 * `message` is always present and always English — no existing client changes —
 * and `code`/`params` ride alongside for the interface to translate. Omitted
 * entirely rather than sent as null when there is no code, so "this error has no
 * catalogue entry" and "this client is old" look the same to the reader, which
 * they should: both fall back to the message.
 */
function send(res: Response, error: HttpError): void {
  res.status(error.status).json({
    message: error.message,
    ...(error.code ? { code: error.code, params: error.params } : {}),
  });
}

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    send(res, error);
    return;
  }

  // express.json() rejects a malformed body with a raw SyntaxError, whose message
  // ("Unexpected token ...") is meaningless to an API client.
  if (isBodyParseError(error)) {
    send(res, HttpError.of(400, 'error.body_not_json'));
    return;
  }

  log.error({ err: error }, 'Unhandled error while serving a request');
  // In production the detail is withheld and the message is a fixed sentence, so
  // it has a code. Outside production it is whatever was thrown — prose with no
  // catalogue entry, which is the case `code: null` exists for.
  if (env.isProduction) {
    send(res, HttpError.of(500, 'error.internal'));
    return;
  }
  send(res, new HttpError(500, error instanceof Error ? error.message : 'Unexpected error'));
}

/** Identifies the SyntaxError body-parser throws for an unparseable JSON body. */
function isBodyParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) return false;
  const candidate = error as SyntaxError & { type?: string; status?: number; body?: unknown };
  return candidate.type === 'entity.parse.failed' || (candidate.status === 400 && 'body' in candidate);
}

/** Wraps an async handler so rejected promises reach errorHandler. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
