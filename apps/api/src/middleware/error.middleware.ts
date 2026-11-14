import type { Request, Response, NextFunction } from 'express';
import type { ApiErrorResponse } from '@360events/types';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/** Shape of errors that carry an explicit HTTP status (e.g. checkOwnershipOrNotFound). */
interface HttpError extends Error {
  status?: number;
  code?: string;
  expose?: boolean;
}

export const notFoundHandler = (req: Request, res: Response): void => {
  const body: ApiErrorResponse = {
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      requestId: req.id as string,
    },
  };
  res.status(404).json(body);
};

export const errorHandler = (
  err: HttpError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  // Malformed JSON from express.json() -> 400, not 500.
  const isBodyParseError = err.name === 'SyntaxError' && 'body' in err;
  const status = err.status ?? (isBodyParseError ? 400 : 500);

  // 5xx: log full error. 4xx: log at warn without stack noise.
  if (status >= 500) {
    logger.error({ err, reqId: req.id }, 'Unhandled request error');
  } else {
    logger.warn({ code: err.code, reqId: req.id, status }, 'Request rejected');
  }

  // P2-T02: transition conflicts
  if (err.name === 'InvalidTransitionError') {
    res.status(409).json({
      error: { code: 'INVALID_TRANSITION', message: err.message, requestId: req.id as string },
    } satisfies ApiErrorResponse);
    return;
  }

  // Explicit HttpError with a 4xx status (404/403/409/...).
  if (err.status !== undefined && err.status >= 400 && err.status < 600) {
    res.status(err.status).json({
      error: {
        code: err.code ?? defaultCodeForStatus(err.status),
        message: err.expose === false ? 'Request could not be processed.' : err.message,
        requestId: req.id as string,
      },
    } satisfies ApiErrorResponse);
    return;
  }

  // Unknown -> 500, never leak internals in production.
  const isProduction = env.NODE_ENV === 'production';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction ? 'An unexpected internal error occurred.' : err.message,
      requestId: req.id as string,
    },
  } satisfies ApiErrorResponse);
};

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMIT_EXCEEDED';
    default:  return 'ERROR';
  }
}