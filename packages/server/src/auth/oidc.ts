import { config } from '../config.js';
import { UserRepo } from '../db/repositories/user.repo.js';
import { logStream } from '../services/log-stream.service.js';
import type { Express, Request, Response, NextFunction } from 'express';
import type { RequestHandler } from 'express';

// Dynamic OIDC setup - loaded on demand when OIDC is enabled
let oidcClient: any = null;
let oidcConfig: any = null;

async function getOidcClient() {
  if (oidcClient) return oidcClient;
  if (!config.oidc.enabled || !config.oidc.issuer) return null;

  try {
    const { discovery } = await import('openid-client');
    oidcConfig = await discovery(
      new URL(config.oidc.issuer),
      config.oidc.clientId,
      config.oidc.clientSecret ? { client_secret: config.oidc.clientSecret } : undefined,
    );
    oidcClient = oidcConfig;
    logStream.info('OIDC client initialized', { issuer: config.oidc.issuer });
    return oidcClient;
  } catch (err) {
    logStream.error('Failed to initialize OIDC client', { error: String(err) });
    return null;
  }
}

export function setupOidcRoutes(app: Express, userRepo: UserRepo, authLimiter: RequestHandler) {
  // Initiate OIDC login
  app.get('/api/auth/oidc', authLimiter, async (req: Request, res: Response) => {
    const client = await getOidcClient();
    if (!client) {
      return res.status(503).json({ error: 'OIDC not configured' });
    }

    const { randomBytes } = await import('crypto');
    const { calculatePKCECodeChallenge, randomPKCECodeVerifier } = await import('openid-client');

    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomBytes(16).toString('hex');

    req.session.teslaOAuthState = state;
    req.session.teslaCodeVerifier = codeVerifier;

    const params = new URLSearchParams({
      client_id: config.oidc.clientId,
      redirect_uri: config.oidc.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const serverMeta = client.serverMetadata();
    const authUrl = `${serverMeta.authorization_endpoint}?${params.toString()}`;

    // Explicitly persist the session before redirecting — MySQL session store is
    // async so the state/codeVerifier must be in the DB before Authentik
    // redirects back (different HTTP request).
    req.session.save((saveErr) => {
      if (saveErr) {
        logStream.error('Failed to save OIDC session before redirect', { error: String(saveErr) });
        return res.status(500).json({ error: 'Session error, please try again' });
      }
      res.redirect(authUrl);
    });
  });

  // OIDC callback
  app.get('/api/auth/oidc/callback', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await getOidcClient();
      if (!client) {
        return res.status(503).json({ error: 'OIDC not configured' });
      }

      const { authorizationCodeGrant } = await import('openid-client');

      const tokens = await authorizationCodeGrant(client, new URL(req.url, config.baseUrl), {
        pkceCodeVerifier: req.session.teslaCodeVerifier,
        expectedState: req.session.teslaOAuthState,
      });

      const claims = tokens.claims()!;
      const sub = claims.sub;
      const displayName = (claims as any).name || (claims as any).preferred_username || sub;

      const user = await userRepo.upsertOidcUser(sub, displayName);

      const loginUser = {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
      };

      req.login(loginUser, (loginErr) => {
        if (loginErr) return next(loginErr);
        delete req.session.teslaOAuthState;
        delete req.session.teslaCodeVerifier;
        // Save session explicitly so MySQL async store flushes before the
        // browser follows the redirect to '/' and calls /api/me.
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.redirect('/');
        });
      });
    } catch (err) {
      logStream.error('OIDC callback error', {
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.redirect('/login?error=oidc_failed');
    }
  });
}
