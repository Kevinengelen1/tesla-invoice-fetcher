export interface User {
  id: number;
  username: string;
  password_hash: string | null;
  oidc_sub: string | null;
  display_name: string | null;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: number;
  vin: string;
  name: string | null;
  region: Region;
  account_id: number | null;
  account_name?: string | null;
  tesla_id: string | null;
  enabled: number;
  created_at: string;
}

export interface TeslaAppConfig {
  id: number;
  name: string;
  region: Region;
  client_id: string;
  redirect_uri: string;
  client_secret_enc?: string | null;
  has_client_secret?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeslaAccount {
  id: number;
  name: string;
  region: Region;
  app_config_id: number | null;
  app_config_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeslaToken {
  id: number;
  account_id: number;
  vehicle_id: number | null;
  region: string;
  token_category: 'fleet' | 'ownership';
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
  scopes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: number;
  external_id: string;
  vin: string;
  vehicle_id: number | null;
  invoice_type: InvoiceType;
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

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export type Region = 'NA' | 'EU' | 'CN';
export type InvoiceType = 'supercharger' | 'subscription' | 'service';

export interface InvoiceListItem {
  externalId: string;
  invoiceDate: string;
  amountCents: number | null;
  currency: string;
  siteName: string | null;
  energyKwh: number | null;
  metadata: Record<string, unknown>;
}

export interface InvoiceFilter {
  search?: string;
  vin?: string;
  type?: InvoiceType;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
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

export interface DashboardStats {
  totalInvoices: number;
  byType: Record<string, number>;
  totalAmountCents: number;
  storageUsedBytes: number;
  recentRuns: FetchRun[];
  vehicleCount: number;
}

export interface InvoiceAnalyticsFilter {
  vin?: string;
  type?: InvoiceType;
  dateFrom?: string;
  dateTo?: string;
  groupBy?: 'day' | 'week' | 'month';
}

export interface InvoiceAnalyticsPoint {
  period: string;
  invoice_type: InvoiceType;
  amount_cents: number;
  energy_kwh: number;
  invoice_count: number;
}
