import axios, { AxiosInstance } from 'axios';
import { TESLA_REGIONS } from './regions.js';
import { TeslaTokenManager } from './tesla-auth.js';
import { logStream } from '../services/log-stream.service.js';
import type { Region } from '../types/models.js';
import type { TeslaChargingHistoryResponse } from '../types/tesla-api.types.js';

export class TeslaClient {
  constructor(private tokenManager: TeslaTokenManager) {}

  // ── Fleet API client (Supercharger invoices) ────────────────────────────────

  private async getFleetClient(region: Region, accountId: number): Promise<AxiosInstance> {
    const accessToken = await this.tokenManager.ensureValidToken(accountId);
    if (!accessToken) {
      throw new Error(`No valid Tesla fleet token for account ${accountId} in region ${region}. Please re-authenticate.`);
    }
    const regionConfig = TESLA_REGIONS[region];
    return axios.create({
      baseURL: regionConfig.fleetApiBase,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ── Ownership API client (Premium Connectivity invoices) ───────────────────

  private async getOwnershipClient(region: Region, accountId: number): Promise<AxiosInstance> {
    const accessToken = await this.tokenManager.ensureValidOwnershipToken(accountId);
    if (!accessToken) {
      throw new Error(`No valid Tesla ownership token for account ${accountId} in region ${region}. Please connect via Premium Connectivity auth.`);
    }
    const regionConfig = TESLA_REGIONS[region];
    return axios.create({
      baseURL: regionConfig.ownershipBase,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ── Supercharger (Fleet API) ────────────────────────────────────────────────

  async getChargingHistory(region: Region, vin: string, options?: {
    accountId: number;
    startTime?: string;
    endTime?: string;
    pageNo?: number;
    pageSize?: number;
  }): Promise<TeslaChargingHistoryResponse> {
    const client = await this.getFleetClient(region, options!.accountId);
    const params: Record<string, string | number> = { vin };

    if (options?.startTime) params.startTime = options.startTime;
    if (options?.endTime) params.endTime = options.endTime;
    if (options?.pageNo !== undefined) params.pageNo = options.pageNo;
    if (options?.pageSize !== undefined) params.pageSize = options.pageSize;

    logStream.info(`Fetching charging history for ${vin}`, { region, params });
    const response = await client.get('/api/1/dx/charging/history', { params });
    return response.data;
  }

  async downloadChargingInvoice(region: Region, contentId: string, accountId: number): Promise<Buffer> {
    const client = await this.getFleetClient(region, accountId);
    logStream.info(`Downloading supercharger invoice ${contentId}`, { region });
    const response = await client.get(`/api/1/dx/charging/invoice/${contentId}`, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  }

  // ── Premium Connectivity (Ownership API) ────────────────────────────────────

  async getSubscriptionInvoices(region: Region, vin: string, accountId: number): Promise<any[]> {
    const client = await this.getOwnershipClient(region, accountId);
    logStream.info('Fetching subscription invoices via Ownership API', { region, vin });

    const response = await client.get('/mobile-app/subscriptions/invoices', {
      params: {
        deviceLanguage: 'en',
        deviceCountry: 'NL',
        httpLocale: 'en_US',
        vin,
        optionCode: '$CPF1',
      },
    });

    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    if (data?.invoices && Array.isArray(data.invoices)) return data.invoices;
    return [];
  }

  async downloadSubscriptionInvoice(region: Region, invoiceId: string, vin: string, accountId: number): Promise<Buffer> {
    const client = await this.getOwnershipClient(region, accountId);
    logStream.info(`Downloading subscription invoice ${invoiceId}`, { region });
    const response = await client.get(`/mobile-app/documents/invoices/${invoiceId}`, {
      params: {
        deviceLanguage: 'en',
        deviceCountry: 'NL',
        httpLocale: 'en_US',
        vin,
      },
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  }
}

