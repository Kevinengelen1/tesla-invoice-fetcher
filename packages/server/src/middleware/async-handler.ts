import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to Express error middleware via next(err).
 * Required because Express 4 does not catch async rejections.
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
