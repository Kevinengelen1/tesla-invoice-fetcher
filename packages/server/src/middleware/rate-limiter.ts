import { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DbAdapter } from '../db/adapter.js';

interface RateLimitOptions {
  prefix: string;
  windowMs: number;
  max: number;
  message: string;
}

function toSqlDatetime(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

function fromSqlDatetime(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  if (typeof value === 'string') {
    return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  }

  return new Date(NaN);
}

function getClientIdentifier(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(adapter: DbAdapter, options: RateLimitOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = `${options.prefix}:${getClientIdentifier(req)}`;
      const now = new Date();
      const windowStart = new Date(now.getTime() - options.windowMs);

      const existing = await adapter.get<{ count: number; window_start: unknown }>(
        'SELECT count, window_start FROM rate_limits WHERE limiter_key = ?',
        [key],
      );

      const existingWindowStart = existing ? fromSqlDatetime(existing.window_start) : null;
      const withinWindow = existingWindowStart !== null && existingWindowStart > windowStart;
      const nextCount = withinWindow ? existing!.count + 1 : 1;
      const effectiveWindowStart = withinWindow && existingWindowStart
        ? existingWindowStart
        : now;

      if (adapter.dialect === 'mysql') {
        await adapter.run(
          `INSERT INTO rate_limits (limiter_key, count, window_start, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE count = VALUES(count), window_start = VALUES(window_start), updated_at = VALUES(updated_at)`,
          [key, nextCount, toSqlDatetime(effectiveWindowStart), toSqlDatetime(now)],
        );
      } else {
        await adapter.run(
          `INSERT INTO rate_limits (limiter_key, count, window_start, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(limiter_key) DO UPDATE SET
             count = excluded.count,
             window_start = excluded.window_start,
             updated_at = datetime('now')`,
          [key, nextCount, toSqlDatetime(effectiveWindowStart)],
        );
      }

      if (Math.random() < 0.02) {
        const cleanupThreshold = new Date(now.getTime() - options.windowMs * 4);
        await adapter.run('DELETE FROM rate_limits WHERE updated_at < ?', [toSqlDatetime(cleanupThreshold)]);
      }

      res.setHeader('X-RateLimit-Limit', options.max.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(options.max - nextCount, 0).toString());

      if (nextCount > options.max) {
        return res.status(429).json({ error: options.message });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createApiLimiter(adapter: DbAdapter): RequestHandler {
  return createRateLimiter(adapter, {
    prefix: 'api',
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later',
  });
}

export function createAuthLimiter(adapter: DbAdapter): RequestHandler {
  return createRateLimiter(adapter, {
    prefix: 'auth',
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts, please try again later',
  });
}
