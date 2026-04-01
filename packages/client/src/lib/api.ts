const BASE = '/api';

let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${BASE}/csrf-token`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.token;
  return csrfToken!;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  return fetchCsrfToken();
}

/** Call after login/logout so the next mutation fetches a fresh CSRF token. */
export function clearCsrfToken() {
  csrfToken = null;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE}${path}`;
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Add CSRF token for mutation requests
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = await getCsrfToken();
    headers.set('x-csrf-token', token);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Refresh CSRF token on 403 (token might have expired)
  if (res.status === 403) {
    const body = await res.text();
    if (body.includes('csrf') || body.includes('CSRF')) {
      csrfToken = null;
      const newToken = await getCsrfToken();
      headers.set('x-csrf-token', newToken);
      const retry = await fetch(url, { ...options, headers, credentials: 'include' });
      if (!retry.ok) {
        throw new ApiError(retry.status, await retry.text());
      }
      return retry.json();
    }
    throw new ApiError(403, body);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.headers.get('content-type')?.includes('text/csv')) {
    return (await res.text()) as unknown as T;
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Auth
export const authApi = {
  me: () => api<{ user: User | null; oidcEnabled: boolean }>('/auth/me'),
  login: (username: string, password: string) =>
    api<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// Dashboard
export const dashboardApi = {
  stats: () => api<DashboardStats>('/dashboard/stats'),
  analytics: (params: DashboardAnalyticsFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        qs.set(key, String(value));
      }
    });
    return api<DashboardAnalyticsResponse>(`/dashboard/analytics?${qs.toString()}`);
  },
};

export const diagnosticsApi = {
  get: () => api<DiagnosticsResponse>('/diagnostics'),
};

// Invoices
export const invoiceApi = {
  list: (params: InvoiceFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    return api<InvoiceListResponse>(`/invoices?${qs}`);
  },
  get: (id: number) => api<Invoice>(`/invoices/${id}`),
  delete: (id: number) =>
    api(`/invoices/${id}`, { method: 'DELETE' }),
  exportCsv: () => api<string>('/invoices/export/csv'),
  rename: (ids: number[], template: string, preview = false) =>
    api<RenameResult[]>(`/invoices/rename${preview ? '?preview=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify({ ids, template }),
    }),
  downloadZip: async (ids: number[]): Promise<Blob> => {
    const token = await getCsrfToken();
    const res = await fetch(`${BASE}/invoices/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
      credentials: 'include',
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.blob();
  },
};

// Vehicles
export const vehicleApi = {
  list: () => api<Vehicle[]>('/vehicles'),
  create: (data: { vin: string; name?: string; region: string; account_id?: number | null }) =>
    api<Vehicle>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: number, data: Partial<{ name: string; region: string; enabled: number; account_id: number | null }>) =>
    api<Vehicle>(`/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    api(`/vehicles/${id}`, { method: 'DELETE' }),
};

// Tesla Auth
export const teslaAuthApi = {
  status: () => api<TeslaAccountStatus[]>('/tesla-auth/status'),
  appConfigs: () => api<TeslaAppConfig[]>('/tesla-auth/app-configs'),
  createAppConfig: (payload: { name: string; region: string; clientId: string; clientSecret: string; redirectUri: string }) =>
    api<{ appConfig: TeslaAppConfig }>('/tesla-auth/app-configs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAppConfig: (id: number) =>
    api(`/tesla-auth/app-configs/${id}`, { method: 'DELETE' }),
  createAccount: (payload: { name: string; region: string; appConfigId: number }) =>
    api<{ account: TeslaAccountStatus }>('/tesla-auth/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAccount: (id: number) =>
    api(`/tesla-auth/accounts/${id}`, { method: 'DELETE' }),

  // Fleet token
  initiate: (payload: { region: string; accountId: number }) =>
    api<{ authUrl: string }>('/tesla-auth/initiate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  manualCallback: (callbackUrl: string) =>
    api<{ ok: boolean; region: string; accountId: number }>('/tesla-auth/manual-callback', {
      method: 'POST',
      body: JSON.stringify({ callbackUrl }),
    }),
  refresh: (accountId: number) =>
    api<{ status: string }>('/tesla-auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  revoke: (accountId: number) =>
    api(`/tesla-auth/${accountId}`, { method: 'DELETE' }),

  // Ownership token (Premium Connectivity)
  initiateOwnership: (payload: { region: string; accountId: number }) =>
    api<{ authUrl: string }>('/tesla-auth/ownership/initiate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  ownershipCallback: (callbackUrl: string) =>
    api<{ ok: boolean; region: string; accountId: number }>('/tesla-auth/ownership/manual-callback', {
      method: 'POST',
      body: JSON.stringify({ callbackUrl }),
    }),
  refreshOwnership: (accountId: number) =>
    api<{ status: string }>('/tesla-auth/ownership/refresh', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  revokeOwnership: (accountId: number) =>
    api(`/tesla-auth/ownership/${accountId}`, { method: 'DELETE' }),
};

// Fetch Runs
export const fetchRunApi = {
  list: (params: FetchRunFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        qs.set(key, String(value));
      }
    });
    return api<FetchRun[]>(`/fetch-runs?${qs.toString()}`);
  },
  get: (id: number) => api<FetchRun>(`/fetch-runs/${id}`),
  trigger: (dryRun = false, vins?: string[]) =>
    api<{ id: number; status: string }>('/fetch-runs', {
      method: 'POST',
      body: JSON.stringify({ dryRun, vins }),
    }),
};

// Settings
export const settingsApi = {
  get: () => api<Record<string, SettingEntry>>('/settings'),
  update: (settings: Record<string, string>) =>
    api<{ ok: boolean; updated: string[] }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  defaults: () => api<Record<string, string>>('/settings/defaults'),
  testEmail: () =>
    api('/settings/test-email', { method: 'POST' }),
};

export const usersApi = {
  list: () => api<{ users: AdminUser[] }>('/users'),
  create: (payload: { username: string; display_name?: string; password: string; role: 'admin' | 'user' }) =>
    api<{ user: AdminUser }>('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (id: number, payload: Partial<Pick<AdminUser, 'display_name' | 'role'>>) =>
    api<{ user: AdminUser }>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  resetPassword: (id: number, password: string) =>
    api<{ user: AdminUser }>(`/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  delete: (id: number) =>
    api(`/users/${id}`, { method: 'DELETE' }),
};

// Types
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
}

export interface AdminUser extends User {
  authType: 'local' | 'oidc' | 'mixed';
  hasPassword: boolean;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  totalInvoices: number;
  byType: Record<string, number>;
  totalAmountCents: number;
  storageUsedBytes: number;
  recentRuns: FetchRun[];
  vehicleCount: number;
  schedulerRunning: boolean;
  scheduleCron: string;
  activeRegion: 'NA' | 'EU' | 'CN';
  tokenHealth: {
    fleet: TokenCategoryStatus;
    ownership: TokenCategoryStatus;
  };
  setup: {
    requiredTotal: number;
    requiredComplete: number;
    mismatchedVehicles: number;
    localFallbackReady: boolean;
    oidcEnabled: boolean;
    oidcConfigured: boolean;
    steps: SetupStep[];
  };
}

export interface DashboardAnalyticsFilter {
  vin?: string;
  type?: 'supercharger' | 'subscription' | 'service';
  dateFrom?: string;
  dateTo?: string;
  groupBy?: 'day' | 'week' | 'month';
}

export interface DashboardAnalyticsPoint {
  period: string;
  invoice_type: 'supercharger' | 'subscription' | 'service';
  amount_cents: number;
  energy_kwh: number;
  invoice_count: number;
}

export interface DashboardAnalyticsResponse {
  points: DashboardAnalyticsPoint[];
  availableVins: string[];
  availableVehicles: Array<{
    vin: string;
    name: string | null;
  }>;
  filters: DashboardAnalyticsFilter;
}

export interface FetchJobSnapshot {
  source: 'manual' | 'scheduled';
  dryRun: boolean;
  vins?: string[];
  runId: number;
  startedAt: string;
}

export interface DiagnosticsAccountError {
  runId: number;
  line: string;
  timestamp: string;
}

export interface DiagnosticsAccount extends TeslaAccountStatus {
  vehicleCount: number;
  vehicles: Array<{
    id: number;
    vin: string;
    name: string | null;
    enabled: number;
  }>;
  latestInvoiceDate: string | null;
  lastSuccessfulRunAt: string | null;
  recentErrors: DiagnosticsAccountError[];
  issues: string[];
}

export interface DiagnosticsAppConfig extends TeslaAppConfig {
  accountCount: number;
}

export interface DiagnosticsProblemRun extends FetchRun {
  highlights: string[];
}

export interface DiagnosticsResponse {
  summary: {
    activeRegion: 'NA' | 'EU' | 'CN';
    schedulerRunning: boolean;
    currentJob: FetchJobSnapshot | null;
    appConfigCount: number;
    accountCount: number;
    vehicleCount: number;
    problemRunCount: number;
    unassignedVehicleCount: number;
    mismatchedVehicleCount: number;
  };
  appConfigs: DiagnosticsAppConfig[];
  accounts: DiagnosticsAccount[];
  recentProblemRuns: DiagnosticsProblemRun[];
  vehicleIssues: {
    unassigned: Vehicle[];
    mismatchedRegion: Vehicle[];
  };
}

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  status: 'complete' | 'action-required' | 'optional';
  href: string;
  required: boolean;
}

export interface SettingEntry {
  value: string;
  source: string;
  writeOnly?: boolean;
  hasValue?: boolean;
}

export interface Invoice {
  id: number;
  external_id: string;
  vin: string;
  vehicle_id: number | null;
  invoice_type: 'supercharger' | 'subscription' | 'service';
  invoice_date: string;
  amount_cents: number | null;
  currency: string;
  site_name: string | null;
  energy_kwh: number | null;
  file_path: string;
  file_hash: string;
  file_size: number | null;
  original_name: string | null;
  renamed: number;
  emailed: number;
  metadata: string | null;
  created_at: string;
}

export interface InvoiceFilter {
  search?: string;
  vin?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'invoice_date' | 'invoice_type' | 'vin' | 'amount_cents' | 'site_name' | 'energy_kwh' | 'created_at';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface FetchRunFilter {
  sort?: 'id' | 'status' | 'started_at' | 'finished_at' | 'invoices_new' | 'invoices_found' | 'invoices_skipped' | 'duration_ms';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface InvoiceListResponse {
  data: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Vehicle {
  id: number;
  vin: string;
  name: string | null;
  region: 'NA' | 'EU' | 'CN';
  account_id: number | null;
  account_name?: string | null;
  tesla_id: string | null;
  enabled: number;
  created_at: string;
}

export interface TeslaAccountStatus {
  id: number;
  name: string;
  region: 'NA' | 'EU' | 'CN';
  app_config_id: number | null;
  app_config_name?: string | null;
  created_at: string;
  updated_at: string;
  fleet: TokenCategoryStatus;
  ownership: TokenCategoryStatus;
}

export interface TeslaAppConfig {
  id: number;
  name: string;
  region: 'NA' | 'EU' | 'CN';
  client_id: string;
  redirect_uri: string;
  has_client_secret?: boolean;
  created_at: string;
  updated_at: string;
}

export interface FetchRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  dry_run: number;
  invoices_found: number;
  invoices_new: number;
  invoices_skipped: number;
  error_message: string | null;
  log: string | null;
}

export interface TokenCategoryStatus {
  hasToken: boolean;
  isExpired: boolean;
  expiresAt?: string;
}

export interface RegionTokenStatus {
  region: string;
  fleet: TokenCategoryStatus;
  ownership: TokenCategoryStatus;
}

/** @deprecated use RegionTokenStatus */
export interface TokenStatus {
  region: string;
  hasToken: boolean;
  expiresAt: string | null;
  isExpired: boolean;
}

export interface RenameResult {
  id: number;
  oldName: string;
  newName: string;
  success?: boolean;
  error?: string;
}
