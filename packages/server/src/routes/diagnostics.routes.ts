import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/guards.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { InvoiceRepo } from '../db/repositories/invoice.repo.js';
import { FetchRunRepo } from '../db/repositories/fetch-run.repo.js';
import { VehicleRepo } from '../db/repositories/vehicle.repo.js';
import { TeslaTokenManager } from '../tesla/tesla-auth.js';
import { config } from '../config.js';
import { isSchedulerRunning } from '../services/scheduler.service.js';
import { FetchJobService } from '../services/fetch-job.service.js';

function extractHighlights(log: string | null, vins: string[] = []): string[] {
  if (!log) return [];
  return log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /error|fatal|axioserror/i.test(line))
    .filter((line) => vins.length === 0 || vins.some((vin) => line.includes(vin)))
    .slice(0, 5);
}

export function createDiagnosticsRoutes(
  invoiceRepo: InvoiceRepo,
  fetchRunRepo: FetchRunRepo,
  vehicleRepo: VehicleRepo,
  tokenManager: TeslaTokenManager,
  fetchJobs: FetchJobService,
): Router {
  const router = Router();

  router.get('/', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const [accounts, appConfigs, vehicles, recentRuns] = await Promise.all([
      tokenManager.getAccountsWithStatus(),
      tokenManager.listAppConfigs(),
      vehicleRepo.findAll(),
      fetchRunRepo.findAll({ limit: 50, sort: 'started_at', order: 'desc' }),
    ]);

    const appConfigUsage = new Map<number, number>();
    for (const appConfig of appConfigs) {
      appConfigUsage.set(appConfig.id, 0);
    }
    for (const account of accounts) {
      if (account.app_config_id) {
        appConfigUsage.set(account.app_config_id, (appConfigUsage.get(account.app_config_id) ?? 0) + 1);
      }
    }

    const accountDiagnostics = await Promise.all(accounts.map(async (account) => {
      const linkedVehicles = vehicles.filter((vehicle) => vehicle.account_id === account.id);
      const vins = linkedVehicles.map((vehicle) => vehicle.vin);
      const latestInvoiceDate = await invoiceRepo.latestInvoiceDateForVins(vins);
      const lastSuccessfulRun = recentRuns.find((run) =>
        (run.status === 'success' || run.status === 'partial')
        && Boolean(run.log)
        && vins.some((vin) => run.log!.includes(vin))
      );
      const recentErrors = recentRuns
        .filter((run) => run.status === 'failed' || run.status === 'partial')
        .flatMap((run) => extractHighlights(run.log, vins).map((line) => ({
          runId: run.id,
          line,
          timestamp: run.finished_at ?? run.started_at,
        })))
        .slice(0, 3);

      const issues: string[] = [];
      if (!account.app_config_id) issues.push('No linked app config');
      if (!account.fleet.hasToken) issues.push('Fleet token missing');
      else if (account.fleet.isExpired) issues.push('Fleet token expired');
      if (!account.ownership.hasToken) issues.push('Ownership token missing');
      else if (account.ownership.isExpired) issues.push('Ownership token expired');
      if (linkedVehicles.length === 0) issues.push('No vehicles assigned');

      return {
        ...account,
        vehicleCount: linkedVehicles.length,
        vehicles: linkedVehicles.map((vehicle) => ({
          id: vehicle.id,
          vin: vehicle.vin,
          name: vehicle.name,
          enabled: vehicle.enabled,
        })),
        latestInvoiceDate,
        lastSuccessfulRunAt: lastSuccessfulRun?.finished_at ?? lastSuccessfulRun?.started_at ?? null,
        recentErrors,
        issues,
      };
    }));

    const recentProblemRuns = recentRuns
      .filter((run) => run.status === 'failed' || run.status === 'partial')
      .slice(0, 10)
      .map((run) => ({
        ...run,
        highlights: extractHighlights(run.log),
      }));

    const unassignedVehicles = vehicles.filter((vehicle) => !vehicle.account_id);
    const mismatchedVehicles = vehicles.filter((vehicle) => vehicle.region !== config.tesla.region);

    res.json({
      summary: {
        activeRegion: config.tesla.region,
        schedulerRunning: isSchedulerRunning(),
        currentJob: fetchJobs.getSnapshot(),
        appConfigCount: appConfigs.length,
        accountCount: accounts.length,
        vehicleCount: vehicles.length,
        problemRunCount: recentProblemRuns.length,
        unassignedVehicleCount: unassignedVehicles.length,
        mismatchedVehicleCount: mismatchedVehicles.length,
      },
      appConfigs: appConfigs.map((appConfig) => ({
        ...appConfig,
        accountCount: appConfigUsage.get(appConfig.id) ?? 0,
      })),
      accounts: accountDiagnostics,
      recentProblemRuns,
      vehicleIssues: {
        unassigned: unassignedVehicles,
        mismatchedRegion: mismatchedVehicles,
      },
    });
  }));

  return router;
}