import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3001',
  BASE_URL: 'http://localhost:3001',
  DATABASE_PATH: './data/tesla-invoices.sqlite',
  INVOICE_STORAGE_DIR: './invoices',
  SESSION_SECRET: '',
  TOKEN_ENCRYPTION_KEY: '',
  TESLA_VINS: '',
  TESLA_REGION: 'NA',
  OIDC_ENABLED: 'false',
  OIDC_ISSUER: '',
  OIDC_CLIENT_ID: '',
  OIDC_CLIENT_SECRET: '',
  OIDC_REDIRECT_URI: 'http://localhost:3001/api/auth/oidc/callback',
  EMAIL_ENABLED: 'false',
  EMAIL_TO: '',
  EMAIL_FROM: '',
  SMTP_HOST: '',
  SMTP_PORT: '587',
  SMTP_SECURE: 'true',
  SMTP_USER: '',
  SMTP_PASS: '',
  FETCH_SCHEDULE_CRON: '',
  AUTO_FETCH_ENABLED: 'false',
  INVOICE_FILENAME_TEMPLATE: '{date}_{type}_{vin}_{site}',
  DATABASE_TYPE: 'sqlite',
  MYSQL_HOST: 'localhost',
  MYSQL_PORT: '3306',
  MYSQL_USER: '',
  MYSQL_PASS: '',
  MYSQL_DATABASE: 'tesla_invoices',
};

// Settings repository will be injected after DB init
let settingsRepo: { get(key: string): string | undefined; set(key: string, value: string): void } | null = null;

export function injectSettingsRepo(repo: { get(key: string): string | undefined; set(key: string, value: string): void }) {
  settingsRepo = repo;
}

export function getSetting(key: string): string {
  // Priority: DB settings > env vars > defaults
  const dbValue = settingsRepo?.get(key);
  if (dbValue !== undefined && dbValue !== '') return dbValue;

  const envValue = process.env[key];
  if (envValue !== undefined && envValue !== '') return envValue;

  return DEFAULTS[key] ?? '';
}

function autoGenerateSecret(key: string): string {
  const value = getSetting(key);
  if (value) return value;
  const generated = randomBytes(32).toString('hex');
  // Persist to DB so the secret survives server restarts
  if (settingsRepo) {
    settingsRepo.set(key, generated);
  }
  // Also cache in process.env as a fast in-process fallback
  process.env[key] = generated;
  return generated;
}

export const config = {
  get nodeEnv() { return getSetting('NODE_ENV'); },
  get isProduction() { return this.nodeEnv === 'production'; },
  get port() { return parseInt(getSetting('PORT'), 10); },
  get baseUrl() { return getSetting('BASE_URL'); },
  get databasePath() { return getSetting('DATABASE_PATH'); },
  get invoiceStorageDir() { return getSetting('INVOICE_STORAGE_DIR'); },
  get sessionSecret() { return autoGenerateSecret('SESSION_SECRET'); },
  get tokenEncryptionKey() { return autoGenerateSecret('TOKEN_ENCRYPTION_KEY'); },

  tesla: {
    get vins() { return getSetting('TESLA_VINS').split(',').map(v => v.trim()).filter(Boolean); },
    get region() { return getSetting('TESLA_REGION') as 'NA' | 'EU' | 'CN'; },
  },

  oidc: {
    get enabled() { return getSetting('OIDC_ENABLED') === 'true'; },
    get issuer() { return getSetting('OIDC_ISSUER'); },
    get clientId() { return getSetting('OIDC_CLIENT_ID'); },
    get clientSecret() { return getSetting('OIDC_CLIENT_SECRET'); },
    get redirectUri() { return getSetting('OIDC_REDIRECT_URI'); },
  },

  email: {
    get enabled() { return getSetting('EMAIL_ENABLED') === 'true'; },
    get to() { return getSetting('EMAIL_TO'); },
    get from() { return getSetting('EMAIL_FROM'); },
    get smtpHost() { return getSetting('SMTP_HOST'); },
    get smtpPort() { return parseInt(getSetting('SMTP_PORT'), 10); },
    get smtpSecure() { return getSetting('SMTP_SECURE') === 'true'; },
    get smtpUser() { return getSetting('SMTP_USER'); },
    get smtpPass() { return getSetting('SMTP_PASS'); },
  },

  schedule: {
    get cron() { return getSetting('FETCH_SCHEDULE_CRON'); },
    get autoFetchEnabled() { return getSetting('AUTO_FETCH_ENABLED') === 'true'; },
  },

  get invoiceFilenameTemplate() { return getSetting('INVOICE_FILENAME_TEMPLATE'); },
};
