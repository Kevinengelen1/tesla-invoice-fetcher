import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { requireAuth } from '../auth/guards.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate } from '../middleware/validation.js';
import { InvoiceRepo } from '../db/repositories/invoice.repo.js';
import { FetchRunRepo } from '../db/repositories/fetch-run.repo.js';
import { VehicleRepo } from '../db/repositories/vehicle.repo.js';
import { config } from '../config.js';
import { isSchedulerRunning } from '../services/scheduler.service.js';
import { TeslaTokenManager } from '../tesla/tesla-auth.js';
import { UserRepo } from '../db/repositories/user.repo.js';

export function createDashboardRoutes(
  invoiceRepo: InvoiceRepo,
  fetchRunRepo: FetchRunRepo,
  vehicleRepo: VehicleRepo,
  tokenManager: TeslaTokenManager,
  userRepo: UserRepo,
): Router {
  const router = Router();

  const analyticsQuerySchema = z.object({
    vin: z.string().optional(),
    type: z.enum(['supercharger', 'subscription', 'service']).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional(),
  });

  router.get('/stats', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const storageDir = path.resolve(config.invoiceStorageDir);
    let storageUsedBytes = 0;

    if (fs.existsSync(storageDir)) {
      const files = fs.readdirSync(storageDir);
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(storageDir, file));
          storageUsedBytes += stat.size;
        } catch { /* skip */ }
      }
    }

    const [totalInvoices, byType, totalAmountCents, recentRuns, vehicleCount, allVehicles, activeTokenHealth, users, hasRegionAppConfig] = await Promise.all([
      invoiceRepo.count(),
      invoiceRepo.countByType(),
      invoiceRepo.totalAmount(),
      fetchRunRepo.findRecent(5),
      vehicleRepo.count(),
      vehicleRepo.findAll(),
      tokenManager.getRegionTokenStatus(config.tesla.region),
      userRepo.findAll(),
      tokenManager.hasAnyFleetAppConfig(config.tesla.region),
    ]);

    const vehiclesInActiveRegion = allVehicles.filter((vehicle) => vehicle.region === config.tesla.region).length;
    const mismatchedVehicles = allVehicles.filter((vehicle) => vehicle.region !== config.tesla.region).length;
    const localFallbackReady = users.some((user) => Boolean(user.password_hash));
    const oidcConfigured = Boolean(
      config.oidc.enabled
      && config.oidc.issuer
      && config.oidc.clientId
      && config.oidc.clientSecret
      && config.oidc.redirectUri,
    );

    const setupSteps = [
      {
        id: 'local-fallback',
        title: 'Local fallback ready',
        description: 'At least one local password-based account is available.',
        status: localFallbackReady ? 'complete' : 'action-required',
        href: '/users',
        required: true,
      },
      {
        id: 'tesla-credentials',
        title: 'Tesla developer app config',
        description: 'At least one Tesla developer app config exists for the active region.',
        status: hasRegionAppConfig ? 'complete' : 'action-required',
        href: '/tesla-auth',
        required: true,
      },
      {
        id: 'fleet-auth',
        title: 'Fleet token connected',
        description: `Fleet API token for region ${config.tesla.region}.`,
        status: activeTokenHealth.fleet.hasToken && !activeTokenHealth.fleet.isExpired ? 'complete' : 'action-required',
        href: '/tesla-auth',
        required: true,
      },
      {
        id: 'ownership-auth',
        title: 'Ownership token connected',
        description: `Ownership API token for region ${config.tesla.region}.`,
        status: activeTokenHealth.ownership.hasToken && !activeTokenHealth.ownership.isExpired ? 'complete' : 'action-required',
        href: '/tesla-auth',
        required: true,
      },
      {
        id: 'vehicles',
        title: 'Vehicle added',
        description: `At least one vehicle uses region ${config.tesla.region}.`,
        status: vehiclesInActiveRegion > 0 ? 'complete' : 'action-required',
        href: '/vehicles',
        required: true,
      },
      {
        id: 'sso',
        title: 'Optional SSO configured',
        description: config.oidc.enabled
          ? 'OIDC is enabled and fully configured.'
          : 'Local login works already; SSO is optional.',
        status: config.oidc.enabled ? (oidcConfigured ? 'complete' : 'action-required') : 'optional',
        href: '/settings',
        required: false,
      },
    ];

    const requiredSteps = setupSteps.filter((step) => step.required);
    const completedRequiredSteps = requiredSteps.filter((step) => step.status === 'complete').length;

    res.json({
      totalInvoices,
      byType,
      totalAmountCents,
      storageUsedBytes,
      recentRuns,
      vehicleCount,
      schedulerRunning: isSchedulerRunning(),
      scheduleCron: config.schedule.cron,
      activeRegion: config.tesla.region,
      tokenHealth: activeTokenHealth,
      setup: {
        requiredTotal: requiredSteps.length,
        requiredComplete: completedRequiredSteps,
        mismatchedVehicles,
        localFallbackReady,
        oidcEnabled: config.oidc.enabled,
        oidcConfigured,
        steps: setupSteps,
      },
    });
  }));

  router.get('/analytics', requireAuth, validate(analyticsQuerySchema, 'query'), asyncHandler(async (req: Request, res: Response) => {
    const points = await invoiceRepo.analytics(req.query as any);
    const vehicles = await vehicleRepo.findAll();
    res.json({
      points,
      availableVins: vehicles.map((vehicle) => vehicle.vin),
      availableVehicles: vehicles.map((vehicle) => ({
        vin: vehicle.vin,
        name: vehicle.name,
      })),
      filters: req.query,
    });
  }));

  return router;
}
