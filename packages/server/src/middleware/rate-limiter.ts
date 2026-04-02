import type { Request, RequestHandler } from 'express';
import { rateLimit, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import type { DbAdapter } from '../db/adapter.js';

interface RateLimitOptions {
  prefix: string;
  windowMs: number;
  max: number;
  message: string;
}

class DatabaseRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;

  constructor(
    private readonly adapter: DbAdapter,
    prefix: string,
  ) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<IncrementResponse | undefined> {
    const record = await this.adapter.get<{ count: number; window_start: unknown }>(
      'SELECT count, window_start FROM rate_limits WHERE limiter_key = ?',
      [this.keyFor(key)],
    );

    if (!record) {
      return undefined;
    }

    const windowStart = fromSqlDatetime(record.window_start);
    if (Number.isNaN(windowStart.getTime())) {
      await this.resetKey(key);
      return undefined;
    }

    const resetTime = new Date(windowStart.getTime() + this.windowMs);
    if (resetTime <= new Date()) {
      await this.resetKey(key);
      return undefined;
    }

    return {
      totalHits: record.count,
      resetTime,
    };
  }

  async increment(key: string): Promise<IncrementResponse> {
    const storeKey = this.keyFor(key);
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.windowMs);

    const existing = await this.adapter.get<{ count: number; window_start: unknown }>(
      'SELECT count, window_start FROM rate_limits WHERE limiter_key = ?',
      [storeKey],
    );

    const existingWindowStart = existing ? fromSqlDatetime(existing.window_start) : null;
    const withinWindow = existingWindowStart !== null && existingWindowStart > windowStart;
    const totalHits = withinWindow ? existing!.count + 1 : 1;
    const effectiveWindowStart = withinWindow && existingWindowStart
      ? existingWindowStart
      : now;

    if (this.adapter.dialect === 'mysql') {
      await this.adapter.run(
        `INSERT INTO rate_limits (limiter_key, count, window_start, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE count = VALUES(count), window_start = VALUES(window_start), updated_at = VALUES(updated_at)`,
        [storeKey, totalHits, toSqlDatetime(effectiveWindowStart), toSqlDatetime(now)],
      );
    } else {
      await this.adapter.run(
        `INSERT INTO rate_limits (limiter_key, count, window_start, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(limiter_key) DO UPDATE SET
           count = excluded.count,
           window_start = excluded.window_start,
           updated_at = datetime('now')`,
        [storeKey, totalHits, toSqlDatetime(effectiveWindowStart)],
      );
    }

    if (Math.random() < 0.02) {
      const cleanupThreshold = new Date(now.getTime() - this.windowMs * 4);
      await this.adapter.run('DELETE FROM rate_limits WHERE updated_at < ?', [toSqlDatetime(cleanupThreshold)]);
    }

    return {
      totalHits,
      resetTime: new Date(effectiveWindowStart.getTime() + this.windowMs),
    };
  }

  async decrement(key: string): Promise<void> {
    const current = await this.get(key);
    if (!current) {
      return;
    }

    const nextHits = Math.max(current.totalHits - 1, 0);
    if (nextHits === 0) {
      await this.resetKey(key);
      return;
    }

    await this.adapter.run(
      'UPDATE rate_limits SET count = ?, updated_at = ? WHERE limiter_key = ?',
      [nextHits, toSqlDatetime(new Date()), this.keyFor(key)],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.adapter.run('DELETE FROM rate_limits WHERE limiter_key = ?', [this.keyFor(key)]);
  }

  private keyFor(key: string): string {
    return `${this.prefix}${key}`;
  }
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
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    message: { error: options.message },
    standardHeaders: 'draft-7',
    legacyHeaders: true,
    keyGenerator: (req) => getClientIdentifier(req),
    store: new DatabaseRateLimitStore(adapter, options.prefix),
    validate: {
      trustProxy: false,
    },
  });
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
