import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { VehicleRepo } from '../db/repositories/vehicle.repo.js';
import { config } from '../config.js';
import { TeslaTokenManager } from '../tesla/tesla-auth.js';

const createVehicleSchema = z.object({
  vin: z.string().min(11).max(17).regex(/^[A-HJ-NPR-Z0-9]+$/i, 'Invalid VIN format'),
  name: z.string().max(100).optional(),
  region: z.enum(['NA', 'EU', 'CN']),
  account_id: z.number().int().positive().nullable().optional(),
});

const updateVehicleSchema = z.object({
  name: z.string().max(100).optional(),
  region: z.enum(['NA', 'EU', 'CN']).optional(),
  enabled: z.number().min(0).max(1).optional(),
  account_id: z.number().int().positive().nullable().optional(),
});

export function createVehicleRoutes(vehicleRepo: VehicleRepo, tokenManager: TeslaTokenManager): Router {
  const router = Router();

  router.get('/', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    res.json(await vehicleRepo.findAll());
  }));

  router.post('/', requireAuth, validate(createVehicleSchema), asyncHandler(async (req: Request, res: Response) => {
    if (req.body.region !== config.tesla.region) {
      return res.status(400).json({
        error: `Vehicles must use the configured region ${config.tesla.region}`,
      });
    }

    if (req.body.account_id) {
      const account = await tokenManager.getAccount(req.body.account_id);
      if (!account || account.region !== req.body.region) {
        return res.status(400).json({ error: 'Selected Tesla account is not available for this region' });
      }
    }

    const existing = await vehicleRepo.findByVin(req.body.vin.toUpperCase());
    if (existing) {
      return res.status(409).json({ error: 'VIN already exists' });
    }
    const vehicle = await vehicleRepo.create({
      vin: req.body.vin.toUpperCase(),
      name: req.body.name,
      region: req.body.region,
      account_id: req.body.account_id,
    });
    res.status(201).json(vehicle);
  }));

  router.put('/:id', requireAuth, validate(updateVehicleSchema), asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const vehicle = await vehicleRepo.findById(id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    if (req.body.region && req.body.region !== config.tesla.region) {
      return res.status(400).json({
        error: `Vehicles must use the configured region ${config.tesla.region}`,
      });
    }

    if (req.body.account_id !== undefined && req.body.account_id !== null) {
      const nextRegion = req.body.region ?? vehicle.region;
      const account = await tokenManager.getAccount(req.body.account_id);
      if (!account || account.region !== nextRegion) {
        return res.status(400).json({ error: 'Selected Tesla account is not available for this region' });
      }
    }

    await vehicleRepo.update(id, req.body);
    res.json(await vehicleRepo.findById(id));
  }));

  router.delete('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const vehicle = await vehicleRepo.findById(id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    await vehicleRepo.delete(id);
    res.json({ ok: true });
  }));

  return router;
}
