import { Request, Response, NextFunction } from 'express';
import { logStream } from '../services/log-stream.service.js';
import { ZodError } from 'zod';

function getStatusCode(err: Error): number {
  return (err as Error & { statusCode?: number }).statusCode ?? 500;
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof ZodError ? 400 : getStatusCode(err);

  const logMeta = {
    error: err.message,
    path: req.path,
    method: req.method,
    statusCode,
  };

  if (statusCode >= 500) {
    logStream.error('Unhandled error', {
      ...logMeta,
      stack: err.stack,
    });
  } else {
    logStream.debug('Handled request error', logMeta);
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : err.message,
  });
}
