import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestAdapter } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { SettingRepo } from '../src/db/repositories/setting.repo.js';
import { createSettingsRoutes } from '../src/routes/settings.routes.js';
import { injectSettingsRepo } from '../src/config.js';
import { errorHandler } from '../src/middleware/error-handler.js';

describe('settings.routes', () => {
  let app: express.Express;
  let settingRepo: SettingRepo;

  beforeEach(async () => {
    const adapter = createTestAdapter();
    await runMigrations(adapter);
    settingRepo = new SettingRepo(adapter);
    await settingRepo.load();
    injectSettingsRepo(settingRepo);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).isAuthenticated = () => true;
      req.user = {
        id: 1,
        username: 'admin',
        role: 'admin',
        display_name: 'Admin',
      };
      next();
    });
    app.use('/settings', createSettingsRoutes(settingRepo));
    app.use(errorHandler);
  });

  it('does not expose write-only secrets', async () => {
    await settingRepo.set('OIDC_CLIENT_SECRET', 'top-secret');

    const response = await request(app).get('/settings');

    expect(response.status).toBe(200);
    expect(response.body.OIDC_CLIENT_SECRET.value).toBe('');
    expect(response.body.OIDC_CLIENT_SECRET.writeOnly).toBe(true);
    expect(response.body.OIDC_CLIENT_SECRET.hasValue).toBe(true);
  });

  it('keeps existing write-only secrets when blank values are submitted', async () => {
    await settingRepo.set('OIDC_CLIENT_SECRET', 'top-secret');
    const reloadSchedulerSpy = vi.spyOn(await import('../src/services/scheduler.service.js'), 'reloadScheduler').mockImplementation(() => undefined);

    const response = await request(app)
      .put('/settings')
      .send({ OIDC_CLIENT_SECRET: '' });

    expect(response.status).toBe(200);
    expect(await settingRepo.getAsync('OIDC_CLIENT_SECRET')).toBe('top-secret');
    reloadSchedulerSpy.mockRestore();
  });
});