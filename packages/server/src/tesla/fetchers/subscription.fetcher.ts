import { BaseFetcher } from './base.fetcher.js';
import { Region, InvoiceType, InvoiceListItem } from '../../types/models.js';
import { logStream } from '../../services/log-stream.service.js';

export class SubscriptionFetcher extends BaseFetcher {
  readonly type: InvoiceType = 'subscription';

  async fetchInvoiceList(vin: string, region: Region, accountId: number): Promise<InvoiceListItem[]> {
    try {
      const invoices = await this.client.getSubscriptionInvoices(region, vin, accountId);

      return invoices.map((inv: any) => {
        const invoiceId = inv.InvoiceId ?? inv.invoiceId;
        const invoiceDate = inv.InvoiceDate ?? inv.invoiceDate ?? 'unknown';
        const invoiceFileName = inv.InvoiceFileName ?? inv.invoiceFileName ?? null;
        const amount = inv.Amount ?? inv.amount ?? inv.TotalAmount ?? inv.totalAmount
          ?? inv.total ?? inv.Total ?? null;
        const currency = inv.Currency ?? inv.currency ?? inv.CurrencyCode
          ?? inv.currencyCode ?? inv.currency_code ?? 'EUR';

        return {
          externalId: String(invoiceId),
          invoiceDate,
          amountCents: amount != null ? Math.round(Number(amount) * 100) : null,
          currency,
          siteName: 'Premium Connectivity',
          energyKwh: null,
          metadata: {
            invoiceFileName,
            vin,
          },
        };
      });
    } catch (err) {
      logStream.warn('Subscription fetcher failed', { error: String(err) });
      return [];
    }
  }

  async downloadInvoice(invoiceId: string, region: Region, vin: string, accountId: number): Promise<Buffer> {
    return this.client.downloadSubscriptionInvoice(region, invoiceId, vin, accountId);
  }
}

