import { Request, Response } from 'express';
import { logStream } from '../services/log-stream.service.js';
import { ZodError } from 'zod';

export function errorHandler(err: Error, req: Request, res: Response) {
  logStream.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  const statusCode = (err as any).statusCode || 500;
  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : err.message,
  });
}
