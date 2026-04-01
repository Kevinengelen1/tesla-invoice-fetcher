export interface TeslaChargingHistoryResponse {
  data: TeslaChargingSession[];
  totalResults: number;
  hasMoreData: boolean;
}

export interface TeslaChargingSession {
  sessionId: string;
  vin: string;
  siteLocationName: string;
  chargeStartDateTime: string;
  chargeStopDateTime: string;
  unlatchDateTime: string | null;
  country: string;
  state: string;
  billingType: string;
  fees: TeslaChargingFee[];
  invoices: TeslaInvoiceRef[];
}

export interface TeslaChargingFee {
  feeType: string;
  currencyCode: string;
  pricingType: string;
  rateBase: number;
  rateTier1: number | null;
  rateTier2: number | null;
  usageBase: number;
  usageTier1: number | null;
  usageTier2: number | null;
  totalBase: number;
  totalTier1: number | null;
  totalTier2: number | null;
  totalDue: number;
  netDue: number;
  uom: string;
  isPaid: boolean;
  status: string;
}

export interface TeslaInvoiceRef {
  contentId: string;
  invoiceType: string;
  fileName: string;
}

export interface TeslaTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface TeslaSubscriptionInvoice {
  invoiceId: string;
  invoiceDate: string;
  amount?: number | null;
  currency?: string;
  productName?: string;
  status?: string;
}
