import { randomBytes, createCipheriv, createDecipheriv, scryptSync, createHash } from 'crypto';
import axios from 'axios';
import { config } from '../config.js';
import { TESLA_REGIONS } from './regions.js';
import { logStream } from '../services/log-stream.service.js';
import type { Region, TeslaAccount, TeslaAppConfig, TeslaToken } from '../types/models.js';
import type { TeslaTokenResponse } from '../types/tesla-api.types.js';
import type { DbAdapter } from '../db/adapter.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'tesla-invoice-fetcher-salt', KEY_LENGTH);
}

export function encrypt(text: string): string {
  const key = deriveKey(config.tokenEncryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(data: string): string {
  const key = deriveKey(config.tokenEncryptionKey);
  const [ivB64, tagB64, encB64] = data.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildAuthUrl(
  region: Region,
  codeChallenge: string,
  state: string,
  appConfig: Pick<TeslaAppConfig, 'client_id' | 'redirect_uri'>,
): string {
  const regionConfig = TESLA_REGIONS[region];
  const params = new URLSearchParams({
    client_id: appConfig.client_id,
    redirect_uri: appConfig.redirect_uri,
    response_type: 'code',
    scope: 'openid offline_access vehicle_device_data vehicle_charging_cmds energy_device_data',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${regionConfig.authBase}/oauth2/v3/authorize?${params.toString()}`;
}

// ── Ownership (ownerapi) token flow ──────────────────────────────────────────
// Tesla's first-party "ownerapi" token is required for Premium Connectivity
// invoices served from ownership.tesla.com. It uses a separate PKCE flow with
// a fixed client_id and Tesla's own void callback URI.

const OWNERSHIP_CLIENT_ID = 'ownerapi';
const OWNERSHIP_REDIRECT_URI = 'https://auth.tesla.com/void/callback';
const OWNERSHIP_SCOPES = 'openid email offline_access';

export function buildOwnershipAuthUrl(region: Region, codeChallenge: string, state: string): string {
  const regionConfig = TESLA_REGIONS[region];
  const params = new URLSearchParams({
    client_id: OWNERSHIP_CLIENT_ID,
    redirect_uri: OWNERSHIP_REDIRECT_URI,
    response_type: 'code',
    scope: OWNERSHIP_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${regionConfig.authBase}/oauth2/v3/authorize?${params.toString()}`;
}

export async function exchangeOwnershipCode(region: Region, code: string, codeVerifier: string): Promise<TeslaTokenResponse> {
  const regionConfig = TESLA_REGIONS[region];
  // Ownership exchange has no client_secret — ownerapi is a first-party client
  const response = await axios.post(`${regionConfig.authBase}/oauth2/v3/token`, {
    grant_type: 'authorization_code',
    client_id: OWNERSHIP_CLIENT_ID,
    code,
    redirect_uri: OWNERSHIP_REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  return response.data;
}

export async function refreshOwnershipToken(region: Region, refreshTokenValue: string): Promise<TeslaTokenResponse> {
  const regionConfig = TESLA_REGIONS[region];
  const response = await axios.post(`${regionConfig.authBase}/oauth2/v3/token`, {
    grant_type: 'refresh_token',
    client_id: OWNERSHIP_CLIENT_ID,
    refresh_token: refreshTokenValue,
  });
  return response.data;
}

export async function exchangeCode(
  region: Region,
  code: string,
  codeVerifier: string,
  appConfig: Pick<TeslaAppConfig, 'client_id' | 'redirect_uri'> & { client_secret?: string | null },
): Promise<TeslaTokenResponse> {
  const regionConfig = TESLA_REGIONS[region];
  const response = await axios.post(`${regionConfig.authBase}/oauth2/v3/token`, {
    grant_type: 'authorization_code',
    client_id: appConfig.client_id,
    client_secret: appConfig.client_secret || undefined,
    code,
    redirect_uri: appConfig.redirect_uri,
    code_verifier: codeVerifier,
  });
  return response.data;
}

export async function refreshToken(
  region: Region,
  refreshTokenValue: string,
  appConfig: Pick<TeslaAppConfig, 'client_id'>,
): Promise<TeslaTokenResponse> {
  const regionConfig = TESLA_REGIONS[region];
  const response = await axios.post(`${regionConfig.authBase}/oauth2/v3/token`, {
    grant_type: 'refresh_token',
    client_id: appConfig.client_id,
    refresh_token: refreshTokenValue,
  });
  return response.data;
}

export class TeslaTokenManager {
  constructor(private db: DbAdapter) {}

  async createAppConfig(data: { name: string; region: Region; clientId: string; clientSecret: string; redirectUri: string }): Promise<TeslaAppConfig> {
    const encryptedSecret = encrypt(data.clientSecret);
    const result = await this.db.run(
      'INSERT INTO tesla_app_configs (name, region, client_id, client_secret_enc, redirect_uri) VALUES (?, ?, ?, ?, ?)',
      [data.name, data.region, data.clientId, encryptedSecret, data.redirectUri],
    );
    return (await this.getAppConfig(result.lastId))!;
  }

  async listAppConfigs(region?: Region): Promise<TeslaAppConfig[]> {
    const sql = region
      ? "SELECT id, name, region, client_id, redirect_uri, created_at, updated_at, CASE WHEN client_secret_enc IS NOT NULL AND client_secret_enc <> '' THEN 1 ELSE 0 END AS has_client_secret FROM tesla_app_configs WHERE region = ? ORDER BY name, created_at"
      : "SELECT id, name, region, client_id, redirect_uri, created_at, updated_at, CASE WHEN client_secret_enc IS NOT NULL AND client_secret_enc <> '' THEN 1 ELSE 0 END AS has_client_secret FROM tesla_app_configs ORDER BY region, name, created_at";
    return region
      ? this.db.all<TeslaAppConfig>(sql, [region])
      : this.db.all<TeslaAppConfig>(sql);
  }

  async getAppConfig(id: number): Promise<TeslaAppConfig | undefined> {
    return this.db.get<TeslaAppConfig>(
      "SELECT id, name, region, client_id, redirect_uri, created_at, updated_at, CASE WHEN client_secret_enc IS NOT NULL AND client_secret_enc <> '' THEN 1 ELSE 0 END AS has_client_secret FROM tesla_app_configs WHERE id = ?",
      [id],
    );
  }

  private async getAppConfigRecord(id: number): Promise<TeslaAppConfig | undefined> {
    return this.db.get<TeslaAppConfig>('SELECT * FROM tesla_app_configs WHERE id = ?', [id]);
  }

  async getFleetAuthConfigForAccount(accountId: number): Promise<{ client_id: string; client_secret?: string | null; redirect_uri: string } | null> {
    const account = await this.getAccount(accountId);
    if (!account?.app_config_id) {
      return null;
    }

    const appConfig = await this.getAppConfigRecord(account.app_config_id);
    if (!appConfig) {
      return null;
    }

    return {
      client_id: appConfig.client_id,
      client_secret: appConfig.client_secret_enc ? decrypt(appConfig.client_secret_enc) : null,
      redirect_uri: appConfig.redirect_uri,
    };
  }

  async deleteAppConfig(id: number): Promise<void> {
    await this.db.run('DELETE FROM tesla_app_configs WHERE id = ?', [id]);
  }

  async countAccountsUsingAppConfig(appConfigId: number): Promise<number> {
    const row = await this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tesla_accounts WHERE app_config_id = ?', [appConfigId]);
    return row?.count ?? 0;
  }

  private upsertSql(): string {
    if (this.db.dialect === 'mysql') {
      return `INSERT INTO tesla_tokens (account_id, region, token_category, access_token, refresh_token, token_type, expires_at, scopes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE region=VALUES(region), access_token=VALUES(access_token), refresh_token=VALUES(refresh_token),
          token_type=VALUES(token_type), expires_at=VALUES(expires_at), scopes=VALUES(scopes)`;
    }
    return `INSERT INTO tesla_tokens (account_id, region, token_category, access_token, refresh_token, token_type, expires_at, scopes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, token_category) DO UPDATE SET
        access_token=excluded.access_token, refresh_token=excluded.refresh_token,
        account_id=excluded.account_id,
        token_type=excluded.token_type, expires_at=excluded.expires_at, scopes=excluded.scopes,
        updated_at=datetime('now')`;
  }

  async createAccount(name: string, region: Region, appConfigId: number | null): Promise<TeslaAccount> {
    const result = await this.db.run('INSERT INTO tesla_accounts (name, region, app_config_id) VALUES (?, ?, ?)', [name, region, appConfigId]);
    return (await this.getAccount(result.lastId))!;
  }

  async getAccount(accountId: number): Promise<TeslaAccount | undefined> {
    return this.db.get<TeslaAccount>(`
      SELECT tesla_accounts.*, tesla_app_configs.name AS app_config_name
      FROM tesla_accounts
      LEFT JOIN tesla_app_configs ON tesla_app_configs.id = tesla_accounts.app_config_id
      WHERE tesla_accounts.id = ?
    `, [accountId]);
  }

  async listAccounts(region?: Region): Promise<TeslaAccount[]> {
    if (region) {
      return this.db.all<TeslaAccount>(`
        SELECT tesla_accounts.*, tesla_app_configs.name AS app_config_name
        FROM tesla_accounts
        LEFT JOIN tesla_app_configs ON tesla_app_configs.id = tesla_accounts.app_config_id
        WHERE tesla_accounts.region = ?
        ORDER BY tesla_accounts.name, tesla_accounts.created_at
      `, [region]);
    }
    return this.db.all<TeslaAccount>(`
      SELECT tesla_accounts.*, tesla_app_configs.name AS app_config_name
      FROM tesla_accounts
      LEFT JOIN tesla_app_configs ON tesla_app_configs.id = tesla_accounts.app_config_id
      ORDER BY tesla_accounts.region, tesla_accounts.name, tesla_accounts.created_at
    `);
  }

  async countVehiclesUsingAccount(accountId: number): Promise<number> {
    const row = await this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM vehicles WHERE account_id = ?', [accountId]);
    return row?.count ?? 0;
  }

  async deleteAccount(accountId: number): Promise<void> {
    await this.db.run('DELETE FROM tesla_accounts WHERE id = ?', [accountId]);
  }

  // ── Fleet token helpers ────────────────────────────────────────────────────

  async getToken(accountId: number): Promise<TeslaToken | undefined> {
    return this.db.get<TeslaToken>(
      "SELECT * FROM tesla_tokens WHERE account_id = ? AND token_category = 'fleet'",
      [accountId],
    );
  }

  async getDecryptedAccessToken(accountId: number): Promise<string | undefined> {
    const token = await this.getToken(accountId);
    if (!token) return undefined;
    try {
      return decrypt(token.access_token);
    } catch {
      logStream.error(`Failed to decrypt access token for account ${accountId}`);
      return undefined;
    }
  }

  async isTokenExpired(accountId: number): Promise<boolean> {
    const token = await this.getToken(accountId);
    if (!token) return true;
    const expiresAt = new Date(token.expires_at);
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return expiresAt <= fiveMinFromNow;
  }

  async storeToken(accountId: number, region: Region, tokenResponse: TeslaTokenResponse): Promise<void> {
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
    const encryptedAccess = encrypt(tokenResponse.access_token);
    const encryptedRefresh = encrypt(tokenResponse.refresh_token);
    await this.db.run(this.upsertSql(), [
      accountId, region, 'fleet', encryptedAccess, encryptedRefresh,
      tokenResponse.token_type, expiresAt, tokenResponse.scope ?? null,
    ]);
    logStream.info(`Tesla fleet token stored`, { accountId, region, expiresAt });
  }

  async ensureValidToken(accountId: number): Promise<string | null> {
    const token = await this.getToken(accountId);
    if (!token) return null;

    const expired = await this.isTokenExpired(accountId);
    if (!expired) {
      return decrypt(token.access_token);
    }

    try {
      const decryptedRefresh = decrypt(token.refresh_token);
      const appConfig = await this.getFleetAuthConfigForAccount(accountId);
      if (!appConfig) {
        return null;
      }
      const newTokens = await refreshToken(token.region as Region, decryptedRefresh, { client_id: appConfig.client_id });
      await this.storeToken(accountId, token.region as Region, newTokens);
      logStream.info(`Tesla fleet token refreshed`, { accountId, region: token.region });
      return newTokens.access_token;
    } catch (err) {
      logStream.error(`Failed to refresh Tesla fleet token`, { accountId, error: String(err) });
      return null;
    }
  }

  async deleteToken(accountId: number): Promise<void> {
    await this.db.run("DELETE FROM tesla_tokens WHERE account_id = ? AND token_category = 'fleet'", [accountId]);
    logStream.info(`Tesla fleet token deleted`, { accountId });
  }

  // ── Ownership token helpers ────────────────────────────────────────────────

  async getOwnershipToken(accountId: number): Promise<TeslaToken | undefined> {
    return this.db.get<TeslaToken>(
      "SELECT * FROM tesla_tokens WHERE account_id = ? AND token_category = 'ownership'",
      [accountId],
    );
  }

  async isOwnershipTokenExpired(accountId: number): Promise<boolean> {
    const token = await this.getOwnershipToken(accountId);
    if (!token) return true;
    const expiresAt = new Date(token.expires_at);
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return expiresAt <= fiveMinFromNow;
  }

  async storeOwnershipToken(accountId: number, region: Region, tokenResponse: TeslaTokenResponse): Promise<void> {
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
    const encryptedAccess = encrypt(tokenResponse.access_token);
    const encryptedRefresh = tokenResponse.refresh_token
      ? encrypt(tokenResponse.refresh_token)
      : encrypt('');
    await this.db.run(this.upsertSql(), [
      accountId, region, 'ownership', encryptedAccess, encryptedRefresh,
      tokenResponse.token_type, expiresAt, tokenResponse.scope ?? null,
    ]);
    logStream.info(`Tesla ownership token stored`, { accountId, region, expiresAt });
  }

  async ensureValidOwnershipToken(accountId: number): Promise<string | null> {
    const token = await this.getOwnershipToken(accountId);
    if (!token) return null;

    const expired = await this.isOwnershipTokenExpired(accountId);
    if (!expired) {
      return decrypt(token.access_token);
    }

    try {
      const decryptedRefresh = decrypt(token.refresh_token);
      if (!decryptedRefresh) return null;
      const newTokens = await refreshOwnershipToken(token.region as Region, decryptedRefresh);
      await this.storeOwnershipToken(accountId, token.region as Region, newTokens);
      logStream.info(`Tesla ownership token refreshed`, { accountId, region: token.region });
      return newTokens.access_token;
    } catch (err) {
      logStream.error(`Failed to refresh Tesla ownership token`, { accountId, error: String(err) });
      return null;
    }
  }

  async deleteOwnershipToken(accountId: number): Promise<void> {
    await this.db.run("DELETE FROM tesla_tokens WHERE account_id = ? AND token_category = 'ownership'", [accountId]);
    logStream.info(`Tesla ownership token deleted`, { accountId });
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  async getAccountTokenStatus(accountId: number): Promise<{ fleet: TokenCategoryStatus; ownership: TokenCategoryStatus }> {
    const [fleetToken, ownershipToken] = await Promise.all([
      this.getToken(accountId),
      this.getOwnershipToken(accountId),
    ]);
    const fleetExpired = await this.isTokenExpired(accountId);
    const ownershipExpired = await this.isOwnershipTokenExpired(accountId);
    return {
      fleet: this._categoryStatus(fleetToken, fleetExpired),
      ownership: this._categoryStatus(ownershipToken, ownershipExpired),
    };
  }

  async getAccountsWithStatus(region?: Region): Promise<Array<TeslaAccount & { fleet: TokenCategoryStatus; ownership: TokenCategoryStatus }>> {
    const accounts = await this.listAccounts(region);
    return Promise.all(accounts.map(async (account) => ({
      ...account,
      ...(await this.getAccountTokenStatus(account.id)),
    })));
  }

  async getRegionTokenStatus(region: Region): Promise<{ fleet: TokenCategoryStatus; ownership: TokenCategoryStatus }> {
    const accounts = await this.getAccountsWithStatus(region);
    const fleetStates = accounts.map((account) => account.fleet);
    const ownershipStates = accounts.map((account) => account.ownership);

    return {
      fleet: this._mergeCategoryStatus(fleetStates),
      ownership: this._mergeCategoryStatus(ownershipStates),
    };
  }

  async hasAnyFleetAppConfig(region: Region): Promise<boolean> {
    const appConfigs = await this.listAppConfigs(region);
    return appConfigs.length > 0;
  }

  private _mergeCategoryStatus(states: TokenCategoryStatus[]): TokenCategoryStatus {
    if (states.length === 0) {
      return { hasToken: false, isExpired: false };
    }

    const hasToken = states.every((state) => state.hasToken);
    const isExpired = states.some((state) => state.hasToken && state.isExpired);
    const expiresAt = states
      .map((state) => state.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    return { hasToken, isExpired, expiresAt };
  }

  private _categoryStatus(token: TeslaToken | undefined, expired: boolean): TokenCategoryStatus {
    if (!token) return { hasToken: false, isExpired: false };
    return { hasToken: true, isExpired: expired, expiresAt: token.expires_at };
  }
}

export interface TokenCategoryStatus {
  hasToken: boolean;
  isExpired: boolean;
  expiresAt?: string;
}

