import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestAdapter } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApiLimiter } from '../src/middleware/rate-limiter.js';

describe('rate-limiter', () => {
  let app: express.Express;

  beforeEach(async () => {
    const adapter = createTestAdapter();
    await runMigrations(adapter);

    app = express();
    app.set('trust proxy', true);
    app.use(createApiLimiter(adapter));
    app.get('/limited', (_req, res) => {
      res.json({ ok: true });
    });
  });

  it('blocks requests over the configured threshold', async () => {
    let blockedStatus = 200;

    for (let attempt = 0; attempt < 130; attempt += 1) {
      const response = await request(app)
        .get('/limited')
        .set('X-Forwarded-For', '203.0.113.10');

      if (response.status === 429) {
        blockedStatus = response.status;
        expect(response.body.error).toContain('Too many requests');
        break;
      }
    }

    expect(blockedStatus).toBe(429);
  });
});