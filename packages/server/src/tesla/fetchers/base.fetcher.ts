import { Region, InvoiceType, InvoiceListItem } from '../../types/models.js';
import { TeslaClient } from '../tesla-client.js';

export abstract class BaseFetcher {
  abstract readonly type: InvoiceType;

  constructor(protected client: TeslaClient) {}

  abstract fetchInvoiceList(vin: string, region: Region, accountId: number): Promise<InvoiceListItem[]>;
  abstract downloadInvoice(externalId: string, region: Region, vin: string, accountId: number): Promise<Buffer>;
}
