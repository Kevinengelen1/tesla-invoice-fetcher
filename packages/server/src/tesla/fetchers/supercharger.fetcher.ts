import { BaseFetcher } from './base.fetcher.js';
import { Region, InvoiceType, InvoiceListItem } from '../../types/models.js';
import { logStream } from '../../services/log-stream.service.js';

function extractAxiosBody(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const ax = err as any;
    const data = ax.response?.data;
    if (Buffer.isBuffer(data)) return data.toString('utf8').slice(0, 500);
    if (typeof data === 'object') return JSON.stringify(data);
    return String(data ?? '');
  }
  return '';
}

export class SuperchargerFetcher extends BaseFetcher {
  readonly type: InvoiceType = 'supercharger';

  async fetchInvoiceList(vin: string, region: Region, accountId: number): Promise<InvoiceListItem[]> {
    const allInvoices: InvoiceListItem[] = [];
    let pageNo = 1;
    const pageSize = 50;
    let hasMore = true;

    while (hasMore) {
      let response: any;
      try {
        response = await this.client.getChargingHistory(region, vin, { accountId, pageNo, pageSize });
      } catch (err: any) {
        const status: number | undefined = err?.response?.status;
        const body = extractAxiosBody(err);

        if (status === 400 || status === 404) {
          // Vehicle not authorized via Tesla app, or no charging data for this VIN
          logStream.warn(
            `Supercharger history unavailable for ${vin} (HTTP ${status}): ${body || err?.message}`,
            { region, vin, status },
          );
          return allInvoices; // return whatever we collected so far (usually empty)
        }
        throw err; // re-throw unexpected errors
      }

      for (const session of response.data ?? []) {
        for (const invoice of session.invoices ?? []) {
          const totalDue = session.fees?.reduce((sum: number, fee: any) => sum + (fee.totalDue ?? 0), 0) ?? 0;
          const currency = session.fees?.[0]?.currencyCode ?? 'USD';
          const energyKwh = session.fees?.reduce((sum: number, fee: any) => sum + (fee.usageBase ?? 0), 0) ?? 0;

          allInvoices.push({
            externalId: invoice.contentId,
            invoiceDate: session.chargeStartDateTime,
            amountCents: Math.round(totalDue * 100),
            currency,
            siteName: session.siteLocationName,
            energyKwh,
            metadata: {
              sessionId: session.sessionId,
              fileName: invoice.fileName,
              invoiceType: invoice.invoiceType,
              country: session.country,
              state: session.state,
              chargeStop: session.chargeStopDateTime,
            },
          });
        }
      }

      hasMore = response.hasMoreData && (response.data?.length ?? 0) >= pageSize;
      pageNo++;

      if (pageNo > 100) {
        logStream.warn('Hit pagination limit for supercharger invoices', { vin, region });
        break;
      }
    }

    logStream.info(`Found ${allInvoices.length} supercharger invoices`, { vin, region });
    return allInvoices;
  }

  async downloadInvoice(contentId: string, region: Region, _vin: string, accountId: number): Promise<Buffer> {
    return this.client.downloadChargingInvoice(region, contentId, accountId);
  }
}
