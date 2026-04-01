import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import {
  TeslaTokenManager,
  generatePKCE,
  buildAuthUrl,
  exchangeCode,
  buildOwnershipAuthUrl,
  exchangeOwnershipCode,
} from '../tesla/tesla-auth.js';
import { logStream } from '../services/log-stream.service.js';
import type { Region } from '../types/models.js';
import { config } from '../config.js';

const accountIdSchema = z.object({
  accountId: z.number().int().positive(),
});

const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  region: z.enum(['NA', 'EU', 'CN']),
  appConfigId: z.number().int().positive(),
});

const createAppConfigSchema = z.object({
  name: z.string().min(1).max(100),
  region: z.enum(['NA', 'EU', 'CN']),
  clientId: z.string().min(1).max(255),
  clientSecret: z.string().min(1).max(2048),
  redirectUri: z.string().url().max(512),
});

const initiateSchema = z.object({
  region: z.enum(['NA', 'EU', 'CN']),
  accountId: z.number().int().positive(),
});

const manualCallbackSchema = z.object({
  callbackUrl: z.string().min(1),
});

function assertConfiguredRegion(region: Region, res: Response): boolean {
  if (region !== config.tesla.region) {
    res.status(400).json({
      error: `Region ${region} is not enabled. Configure and use ${config.tesla.region} instead.`,
    });
    return false;
  }
  return true;
}

export function createTeslaAuthRoutes(tokenManager: TeslaTokenManager): Router {
  const router = Router();

  router.get('/status', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const accounts = await tokenManager.getAccountsWithStatus(config.tesla.region);
    res.json(accounts);
  }));

  router.get('/app-configs', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const appConfigs = await tokenManager.listAppConfigs(config.tesla.region);
    res.json(appConfigs);
  }));

  router.post('/app-configs', requireAuth, validate(createAppConfigSchema), asyncHandler(async (req: Request, res: Response) => {
    const { name, region, clientId, clientSecret, redirectUri } = req.body as {
      name: string;
      region: Region;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    };

    if (!assertConfiguredRegion(region, res)) return;

    const appConfig = await tokenManager.createAppConfig({
      name: name.trim(),
      region,
      clientId: clientId.trim(),
      clientSecret,
      redirectUri: redirectUri.trim(),
    });
    res.status(201).json({ appConfig });
  }));

  router.delete('/app-configs/:appConfigId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const appConfigId = parseInt(req.params.appConfigId as string, 10);
    if (!Number.isInteger(appConfigId) || appConfigId <= 0) {
      return res.status(400).json({ error: 'Invalid app config id' });
    }

    const usageCount = await tokenManager.countAccountsUsingAppConfig(appConfigId);
    if (usageCount > 0) {
      return res.status(409).json({ error: 'This Tesla app config is still assigned to one or more Tesla accounts' });
    }

    await tokenManager.deleteAppConfig(appConfigId);
    res.json({ ok: true });
  }));

  router.post('/accounts', requireAuth, validate(createAccountSchema), asyncHandler(async (req: Request, res: Response) => {
    const { name, region, appConfigId } = req.body as { name: string; region: Region; appConfigId: number };
    if (!assertConfiguredRegion(region, res)) return;

    const appConfig = await tokenManager.getAppConfig(appConfigId);
    if (!appConfig || appConfig.region !== region) {
      return res.status(400).json({ error: 'Selected Tesla app config is not available for this region' });
    }

    const account = await tokenManager.createAccount(name.trim(), region, appConfigId);
    res.status(201).json({ account });
  }));

  router.delete('/accounts/:accountId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const accountId = parseInt(req.params.accountId as string, 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: 'Invalid account id' });
    }

    const vehicleCount = await tokenManager.countVehiclesUsingAccount(accountId);
    if (vehicleCount > 0) {
      return res.status(409).json({ error: 'This Tesla account is still assigned to one or more vehicles' });
    }

    await tokenManager.deleteAccount(accountId);
    res.json({ ok: true });
  }));

  // ── Fleet token flow ────────────────────────────────────────────────────────

  router.post('/initiate', requireAuth, validate(initiateSchema), asyncHandler(async (req: Request, res: Response) => {
    const { region, accountId } = req.body as { region: Region; accountId: number };
    if (!assertConfiguredRegion(region, res)) return;
    const account = await tokenManager.getAccount(accountId);
    if (!account || account.region !== region) {
      return res.status(404).json({ error: 'Tesla account not found for this region' });
    }

    const fleetConfig = await tokenManager.getFleetAuthConfigForAccount(accountId);
    if (!fleetConfig) {
      return res.status(400).json({ error: 'This Tesla account has no developer app config linked. Assign a Tesla app config first.' });
    }

    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = randomBytes(16).toString('hex');

    // Store in session
    req.session.teslaOAuthState = `${region}:${state}`;
    req.session.teslaCodeVerifier = codeVerifier;
    req.session.teslaAccountId = accountId;

    const authUrl = buildAuthUrl(region, codeChallenge, `${region}:${state}`, fleetConfig);
    res.json({ authUrl });
  }));

  // Manual callback: user pastes the full redirect URL after Tesla authentication.
  // Tesla redirects to localhost:8080/callback (not reachable), so the user copies
  // that URL from their browser and submits it here.
  router.post('/manual-callback', requireAuth, validate(manualCallbackSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const { callbackUrl } = req.body as { callbackUrl: string };

      let parsed: URL;
      try {
        parsed = new URL(callbackUrl);
      } catch {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');

      if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state in URL' });
      }

      if (state !== req.session.teslaOAuthState) {
        return res.status(400).json({ error: 'State mismatch. Please restart the authentication flow.' });
      }

      const region = state.split(':')[0] as Region;
      const codeVerifier = req.session.teslaCodeVerifier;
      const accountId = req.session.teslaAccountId;

      if (!codeVerifier || !accountId) {
        return res.status(400).json({ error: 'Missing code verifier. Please restart the authentication flow.' });
      }

      const fleetConfig = await tokenManager.getFleetAuthConfigForAccount(accountId);
      if (!fleetConfig) {
        return res.status(400).json({ error: 'This Tesla account has no developer app credentials linked.' });
      }

      const tokenResponse = await exchangeCode(region, code, codeVerifier, fleetConfig);
      await tokenManager.storeToken(accountId, region, tokenResponse);

      delete req.session.teslaOAuthState;
      delete req.session.teslaCodeVerifier;
      delete req.session.teslaAccountId;

      logStream.info(`Tesla fleet authentication successful for region ${region}`, { accountId });
      res.json({ ok: true, region, accountId });
    } catch (err) {
      logStream.error('Tesla manual callback error', { error: String(err) });
      res.status(400).json({ error: 'Authentication failed. Please try again.' });
    }
  }));

  router.post('/refresh', requireAuth, validate(accountIdSchema), asyncHandler(async (req: Request, res: Response) => {
    const { accountId } = req.body as { accountId: number };
    const accessToken = await tokenManager.ensureValidToken(accountId);
    if (accessToken) {
      res.json({ status: 'refreshed' });
    } else {
      res.status(400).json({ error: 'Failed to refresh token. Please re-authenticate.' });
    }
  }));

  router.delete('/:accountId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const accountId = parseInt(req.params.accountId as string, 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: 'Invalid account id' });
    }
    await tokenManager.deleteToken(accountId);
    res.json({ ok: true });
  }));

  // ── Ownership token flow ────────────────────────────────────────────────────
  // Uses Tesla's first-party "ownerapi" client to access Premium Connectivity
  // invoices. The redirect URI is https://auth.tesla.com/void/callback — a blank
  // Tesla-owned page. The user must copy the URL from their browser and paste it.

  router.post('/ownership/initiate', requireAuth, validate(initiateSchema), asyncHandler(async (req: Request, res: Response) => {
    const { region, accountId } = req.body as { region: Region; accountId: number };
    if (!assertConfiguredRegion(region, res)) return;
    const account = await tokenManager.getAccount(accountId);
    if (!account || account.region !== region) {
      return res.status(404).json({ error: 'Tesla account not found for this region' });
    }

    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = randomBytes(16).toString('hex');

    req.session.teslaOwnershipOAuthState = `${region}:${state}`;
    req.session.teslaOwnershipCodeVerifier = codeVerifier;
    req.session.teslaOwnershipAccountId = accountId;

    const authUrl = buildOwnershipAuthUrl(region, codeChallenge, `${region}:${state}`);
    res.json({ authUrl });
  }));

  router.post('/ownership/manual-callback', requireAuth, validate(manualCallbackSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const { callbackUrl } = req.body as { callbackUrl: string };

      let parsed: URL;
      try {
        parsed = new URL(callbackUrl);
      } catch {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');

      if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state in URL' });
      }

      if (state !== req.session.teslaOwnershipOAuthState) {
        return res.status(400).json({ error: 'State mismatch. Please restart the authentication flow.' });
      }

      const region = state.split(':')[0] as Region;
      const codeVerifier = req.session.teslaOwnershipCodeVerifier;
      const accountId = req.session.teslaOwnershipAccountId;

      if (!codeVerifier || !accountId) {
        return res.status(400).json({ error: 'Missing code verifier. Please restart the authentication flow.' });
      }

      const tokenResponse = await exchangeOwnershipCode(region, code, codeVerifier);
      await tokenManager.storeOwnershipToken(accountId, region, tokenResponse);

      delete req.session.teslaOwnershipOAuthState;
      delete req.session.teslaOwnershipCodeVerifier;
      delete req.session.teslaOwnershipAccountId;

      logStream.info(`Tesla ownership authentication successful for region ${region}`, { accountId });
      res.json({ ok: true, region, accountId });
    } catch (err) {
      logStream.error('Tesla ownership manual callback error', { error: String(err) });
      res.status(400).json({ error: 'Ownership authentication failed. Please try again.' });
    }
  }));

  router.post('/ownership/refresh', requireAuth, validate(accountIdSchema), asyncHandler(async (req: Request, res: Response) => {
    const { accountId } = req.body as { accountId: number };
    const accessToken = await tokenManager.ensureValidOwnershipToken(accountId);
    if (accessToken) {
      res.json({ status: 'refreshed' });
    } else {
      res.status(400).json({ error: 'Failed to refresh ownership token. Please re-authenticate.' });
    }
  }));

  router.delete('/ownership/:accountId', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const accountId = parseInt(req.params.accountId as string, 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: 'Invalid account id' });
    }
    await tokenManager.deleteOwnershipToken(accountId);
    res.json({ ok: true });
  }));

  return router;
}
