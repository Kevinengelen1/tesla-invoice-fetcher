import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestAdapter } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { injectSettingsRepo } from '../src/config.js';
import { SettingRepo } from '../src/db/repositories/setting.repo.js';
import { VehicleRepo } from '../src/db/repositories/vehicle.repo.js';
import { TeslaTokenManager } from '../src/tesla/tesla-auth.js';
import { createVehicleRoutes } from '../src/routes/vehicle.routes.js';
import { createTeslaAuthRoutes } from '../src/routes/tesla-auth.routes.js';
import { errorHandler } from '../src/middleware/error-handler.js';

describe('single-region enforcement', () => {
  let app: express.Express;

  beforeEach(async () => {
    const adapter = createTestAdapter();
    await runMigrations(adapter);

    const settingRepo = new SettingRepo(adapter);
    await settingRepo.load();
    await settingRepo.set('TESLA_REGION', 'EU');
    injectSettingsRepo(settingRepo);

    const vehicleRepo = new VehicleRepo(adapter);
    const tokenManager = new TeslaTokenManager(adapter);

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
      req.session = {} as any;
      next();
    });
    app.use('/vehicles', createVehicleRoutes(vehicleRepo));
    app.use('/tesla-auth', createTeslaAuthRoutes(tokenManager));
    app.use(errorHandler);
  });

  it('rejects vehicles outside the configured region', async () => {
    const response = await request(app)
      .post('/vehicles')
      .send({ vin: '5YJ3E1EA7KF000011', name: 'Other Region', region: 'NA' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('configured region EU');
  });

  it('rejects Tesla auth initiation outside the configured region', async () => {
    const response = await request(app)
      .post('/tesla-auth/initiate')
      .send({ region: 'NA', accountId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Configure and use EU instead');
  });
});