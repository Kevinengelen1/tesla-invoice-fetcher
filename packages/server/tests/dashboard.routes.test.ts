import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestAdapter } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { injectSettingsRepo } from '../src/config.js';
import { createDashboardRoutes } from '../src/routes/dashboard.routes.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { SettingRepo } from '../src/db/repositories/setting.repo.js';
import { InvoiceRepo } from '../src/db/repositories/invoice.repo.js';
import { FetchRunRepo } from '../src/db/repositories/fetch-run.repo.js';
import { VehicleRepo } from '../src/db/repositories/vehicle.repo.js';
import { UserRepo } from '../src/db/repositories/user.repo.js';
import { TeslaTokenManager } from '../src/tesla/tesla-auth.js';

describe('dashboard.routes', () => {
  let app: express.Express;
  let settingRepo: SettingRepo;
  let invoiceRepo: InvoiceRepo;
  let fetchRunRepo: FetchRunRepo;
  let vehicleRepo: VehicleRepo;
  let userRepo: UserRepo;
  let tokenManager: TeslaTokenManager;

  beforeEach(async () => {
    const adapter = createTestAdapter();
    await runMigrations(adapter);

    settingRepo = new SettingRepo(adapter);
    await settingRepo.load();
    injectSettingsRepo(settingRepo);

    invoiceRepo = new InvoiceRepo(adapter);
    fetchRunRepo = new FetchRunRepo(adapter);
    vehicleRepo = new VehicleRepo(adapter);
    userRepo = new UserRepo(adapter);
    tokenManager = new TeslaTokenManager(adapter);

    await settingRepo.set('TESLA_REGION', 'EU');
    await tokenManager.createAppConfig({
      name: 'Primary EU App',
      region: 'EU',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:8080/callback',
    });

    await userRepo.create({
      username: 'admin',
      password_hash: await bcrypt.hash('admin-pass-123', 12),
      role: 'admin',
      display_name: 'Admin',
    });

    await vehicleRepo.create({ vin: '5YJ3E1EA7KF000001', name: 'Model 3', region: 'EU' });
    await vehicleRepo.create({ vin: '5YJ3E1EA7KF000002', name: 'Model Y', region: 'NA' });

    await invoiceRepo.create({
      external_id: 'sc-1',
      vin: '5YJ3E1EA7KF000001',
      vehicle_id: 1,
      invoice_type: 'supercharger',
      invoice_date: '2026-01-15',
      amount_cents: 2300,
      currency: 'EUR',
      site_name: 'Amsterdam',
      energy_kwh: 42.5,
      file_path: 'sc-1.pdf',
      file_hash: 'hash-1',
      file_size: 1024,
      original_name: 'sc-1.pdf',
      metadata: '{}',
    });

    await invoiceRepo.create({
      external_id: 'sub-1',
      vin: '5YJ3E1EA7KF000001',
      vehicle_id: 1,
      invoice_type: 'subscription',
      invoice_date: '2026-02-15',
      amount_cents: 999,
      currency: 'EUR',
      site_name: null,
      energy_kwh: null,
      file_path: 'sub-1.pdf',
      file_hash: 'hash-2',
      file_size: 2048,
      original_name: 'sub-1.pdf',
      metadata: '{}',
    });

    app = express();
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
    app.use('/dashboard', createDashboardRoutes(invoiceRepo, fetchRunRepo, vehicleRepo, tokenManager, userRepo));
    app.use(errorHandler);
  });

  it('returns readiness and token health data', async () => {
    const response = await request(app).get('/dashboard/stats');

    expect(response.status).toBe(200);
    expect(response.body.activeRegion).toBe('EU');
    expect(response.body.setup.mismatchedVehicles).toBe(1);
    expect(response.body.setup.steps.some((step: any) => step.id === 'local-fallback')).toBe(true);
    expect(response.body.tokenHealth.fleet.hasToken).toBe(false);
  });

  it('returns grouped analytics data', async () => {
    const response = await request(app)
      .get('/dashboard/analytics')
      .query({ groupBy: 'month', vin: '5YJ3E1EA7KF000001' });

    expect(response.status).toBe(200);
    expect(response.body.availableVins).toContain('5YJ3E1EA7KF000001');
    expect(response.body.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: '2026-01', invoice_type: 'supercharger', amount_cents: 2300 }),
      expect.objectContaining({ period: '2026-02', invoice_type: 'subscription', amount_cents: 999 }),
    ]));
  });
});