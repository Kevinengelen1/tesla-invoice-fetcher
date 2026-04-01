import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { SettingRepo } from '../db/repositories/setting.repo.js';
import { getSetting } from '../config.js';
import { sendTestEmail, resetTransporter } from '../services/email.service.js';
import { reloadScheduler, validateCronExpression } from '../services/scheduler.service.js';

const EDITABLE_KEYS = [
  'INVOICE_STORAGE_DIR', 'INVOICE_FILENAME_TEMPLATE',
  'EMAIL_ENABLED', 'EMAIL_TO', 'EMAIL_FROM',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  'FETCH_SCHEDULE_CRON', 'AUTO_FETCH_ENABLED',
  'TESLA_REGION',
  'OIDC_ENABLED', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI',
];

const updateSettingsSchema = z.record(z.string(), z.string());

// Bootstrap keys are read from env only (not editable at runtime)
const ENV_ONLY_KEYS = [
  'DATABASE_TYPE', 'DATABASE_PATH',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_DATABASE',
];

const WRITE_ONLY_KEYS = new Set(['SMTP_PASS', 'OIDC_CLIENT_SECRET']);

function createBadRequestError(message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function validateScheduleSettings(updates: Record<string, string>) {
  const autoFetchEnabled = (updates.AUTO_FETCH_ENABLED ?? getSetting('AUTO_FETCH_ENABLED')) === 'true';
  const cronExpression = updates.FETCH_SCHEDULE_CRON ?? getSetting('FETCH_SCHEDULE_CRON');

  if (!autoFetchEnabled) {
    return;
  }

  const validation = validateCronExpression(cronExpression);
  if (!validation.valid) {
    throw createBadRequestError(validation.error ?? 'Invalid cron expression');
  }
}

export function createSettingsRoutes(settingRepo: SettingRepo): Router {
  const router = Router();

  router.get('/', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const settings: Record<string, { value: string; source: string }> = {};

    for (const key of EDITABLE_KEYS) {
      const dbVal = await settingRepo.getAsync(key);
      const envVal = process.env[key];
      const value = getSetting(key);
      const source = dbVal ? 'database' : envVal ? 'environment' : 'default';
      const writeOnly = WRITE_ONLY_KEYS.has(key);
      settings[key] = {
        value: writeOnly ? '' : value,
        source,
        ...(writeOnly ? { writeOnly: true, hasValue: Boolean(value) } : {}),
      } as { value: string; source: string };
    }

    // Include bootstrap (env-only) keys as read-only
    for (const key of ENV_ONLY_KEYS) {
      const envVal = process.env[key] ?? '';
      settings[key] = { value: envVal, source: envVal ? 'environment' : 'default' };
    }

    res.json(settings);
  }));

  router.put('/', requireAdmin, validate(updateSettingsSchema), asyncHandler(async (req: Request, res: Response) => {
    const updates: Record<string, string> = {};

    for (const [key, value] of Object.entries(req.body)) {
      if (EDITABLE_KEYS.includes(key)) {
        if (WRITE_ONLY_KEYS.has(key) && !(value as string).trim()) {
          continue;
        }
        updates[key] = value as string;
      }
    }

    validateScheduleSettings(updates);

    await settingRepo.setBulk(updates);

    // Reset email transporter when email settings change
    if (Object.keys(updates).some((k) => k.startsWith('EMAIL_') || k.startsWith('SMTP_'))) {
      resetTransporter();
    }

    if (Object.keys(updates).some((k) => k === 'FETCH_SCHEDULE_CRON' || k === 'AUTO_FETCH_ENABLED')) {
      reloadScheduler();
    }

    res.json({ ok: true, updated: Object.keys(updates) });
  }));

  router.get('/defaults', requireAuth, (_req: Request, res: Response) => {
    const defaults: Record<string, string> = {};
    for (const key of EDITABLE_KEYS) {
      defaults[key] = process.env[key] ?? '';
    }
    res.json(defaults);
  });

  router.post('/test-email', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    try {
      await sendTestEmail();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }));

  return router;
}
