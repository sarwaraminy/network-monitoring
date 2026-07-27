import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { componentLogger } from '../logger.js';

const log = componentLogger('http');

/** Thrown by route handlers to produce a specific status code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ message: `No route for ${req.method} ${req.path}` });
}

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  // express.json() rejects a malformed body with a raw SyntaxError, whose message
  // ("Unexpected token ...") is meaningless to an API client.
  if (isBodyParseError(error)) {
    res.status(400).json({ message: 'Request body is not valid JSON' });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  log.error({ err: error }, 'Unhandled error while serving a request');
  res.status(500).json({
    message: env.isProduction ? 'Internal server error' : message,
  });
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
