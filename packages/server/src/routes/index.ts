import { Router } from 'express';
import { createAuthRoutes } from './auth.routes.js';
import { createTeslaAuthRoutes } from './tesla-auth.routes.js';
import { createVehicleRoutes } from './vehicle.routes.js';
import { createInvoiceRoutes } from './invoice.routes.js';
import { createFetchRunRoutes } from './fetch-run.routes.js';
import { createSettingsRoutes } from './settings.routes.js';
import { createLogRoutes } from './log.routes.js';
import { createDashboardRoutes } from './dashboard.routes.js';
import { createUserRoutes } from './users.routes.js';
import { createDiagnosticsRoutes } from './diagnostics.routes.js';
import { UserRepo } from '../db/repositories/user.repo.js';
import { VehicleRepo } from '../db/repositories/vehicle.repo.js';
import { InvoiceRepo } from '../db/repositories/invoice.repo.js';
import { FetchRunRepo } from '../db/repositories/fetch-run.repo.js';
import { SettingRepo } from '../db/repositories/setting.repo.js';
import { TeslaTokenManager } from '../tesla/tesla-auth.js';
import { RequestHandler } from 'express';
import { FetchJobService } from '../services/fetch-job.service.js';

interface RouteDeps {
  userRepo: UserRepo;
  vehicleRepo: VehicleRepo;
  invoiceRepo: InvoiceRepo;
  fetchRunRepo: FetchRunRepo;
  settingRepo: SettingRepo;
  tokenManager: TeslaTokenManager;
  fetchJobs: FetchJobService;
  apiLimiter: RequestHandler;
  authLimiter: RequestHandler;
}

export function createApiRouter(deps: RouteDeps): Router {
  const router = Router();

  router.use(deps.apiLimiter);

  router.use('/auth', createAuthRoutes(deps.userRepo, deps.authLimiter));
  router.use('/users', createUserRoutes(deps.userRepo));
  router.use('/tesla-auth', createTeslaAuthRoutes(deps.tokenManager));
  router.use('/vehicles', createVehicleRoutes(deps.vehicleRepo, deps.tokenManager));
  router.use('/invoices', createInvoiceRoutes(deps.invoiceRepo));
  router.use('/fetch-runs', createFetchRunRoutes(deps.fetchRunRepo, deps.fetchJobs));
  router.use('/settings', createSettingsRoutes(deps.settingRepo));
  router.use('/logs', createLogRoutes());
  router.use('/dashboard', createDashboardRoutes(deps.invoiceRepo, deps.fetchRunRepo, deps.vehicleRepo, deps.tokenManager, deps.userRepo));
  router.use('/diagnostics', createDiagnosticsRoutes(deps.invoiceRepo, deps.fetchRunRepo, deps.vehicleRepo, deps.tokenManager, deps.fetchJobs));

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return router;
}
