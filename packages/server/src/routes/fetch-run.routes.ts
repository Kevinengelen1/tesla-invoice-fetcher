import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { FetchRunRepo } from '../db/repositories/fetch-run.repo.js';
import { FetchJobService } from '../services/fetch-job.service.js';

const listQuerySchema = z.object({
  sort: z.enum(['id', 'status', 'started_at', 'finished_at', 'invoices_new', 'invoices_found', 'invoices_skipped', 'duration_ms']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const triggerSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  vins: z.array(z.string()).optional(),
});

export function createFetchRunRoutes(fetchRunRepo: FetchRunRepo, fetchJobs: FetchJobService): Router {
  const router = Router();

  router.get('/', requireAuth, validate(listQuerySchema, 'query'), asyncHandler(async (req: Request, res: Response) => {
    res.json(await fetchRunRepo.findAll(req.query as any));
  }));

  router.get('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const run = await fetchRunRepo.findById(id);
    if (!run) return res.status(404).json({ error: 'Fetch run not found' });
    res.json(run);
  }));

  router.post('/', requireAuth, validate(triggerSchema), asyncHandler(async (req: Request, res: Response) => {
    const { dryRun, vins } = req.body;
    const result = await fetchJobs.start({ source: 'manual', dryRun, vins });
    if (!result.accepted || !result.runId) {
      return res.status(409).json({ error: result.reason ?? 'A fetch is already running' });
    }

    res.status(202).json({ id: result.runId, status: 'running' });
  }));

  return router;
}
