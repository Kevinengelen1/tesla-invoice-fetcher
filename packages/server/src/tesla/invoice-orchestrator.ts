import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { BaseFetcher } from './fetchers/base.fetcher.js';
import { SuperchargerFetcher } from './fetchers/supercharger.fetcher.js';
import { SubscriptionFetcher } from './fetchers/subscription.fetcher.js';
import { TeslaClient } from './tesla-client.js';
import { InvoiceRepo } from '../db/repositories/invoice.repo.js';
import { VehicleRepo } from '../db/repositories/vehicle.repo.js';
import { FetchRunRepo } from '../db/repositories/fetch-run.repo.js';
import { logStream } from '../services/log-stream.service.js';
import { config } from '../config.js';
import type { Vehicle, InvoiceListItem, FetchRun } from '../types/models.js';

/** Convert a Date to a MySQL/SQLite-compatible datetime string (YYYY-MM-DD HH:MM:SS). */
function toSqlDatetime(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

/** Extract a human-readable message from an AxiosError or generic Error. */
function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const axiosErr = err as any;
    const status: number | undefined = axiosErr.response?.status;
    const data = axiosErr.response?.data;
    let body: string;
    if (Buffer.isBuffer(data)) {
      body = data.toString('utf8').slice(0, 500);
    } else if (typeof data === 'object') {
      body = JSON.stringify(data);
    } else {
      body = String(data ?? '');
    }
    return `AxiosError ${status}: ${body || axiosErr.message}`;
  }
  return String(err);
}

export class InvoiceOrchestrator {
  private fetchers: BaseFetcher[];

  constructor(
    private client: TeslaClient,
    private invoiceRepo: InvoiceRepo,
    private vehicleRepo: VehicleRepo,
    private fetchRunRepo: FetchRunRepo,
  ) {
    this.fetchers = [
      new SuperchargerFetcher(client),
      new SubscriptionFetcher(client),
    ];
  }

  async run(options: { dryRun?: boolean; vins?: string[]; runId?: number } = {}): Promise<FetchRun> {
    const run = options.runId
      ? (await this.fetchRunRepo.findById(options.runId))!
      : await this.fetchRunRepo.create(!!options.dryRun);
    const log = async (msg: string) => {
      logStream.info(msg, { runId: run.id });
      await this.fetchRunRepo.appendLog(run.id, `[${new Date().toISOString()}] ${msg}`);
    };

    let totalFound = 0;
    let totalNew = 0;
    let totalSkipped = 0;
    let hasErrors = false;

    try {
      const vehicles = options.vins
        ? (await this.vehicleRepo.findAll()).filter(v => options.vins!.includes(v.vin))
        : await this.vehicleRepo.findEnabled();

      const eligibleVehicles = vehicles.filter((vehicle) => vehicle.region === config.tesla.region);

      if (eligibleVehicles.length !== vehicles.length) {
        await log(`Skipping ${vehicles.length - eligibleVehicles.length} vehicle(s) outside configured region ${config.tesla.region}`);
      }

      if (eligibleVehicles.length === 0) {
        await log('No vehicles configured. Add vehicles in the Vehicles page.');
        await this.fetchRunRepo.update(run.id, {
          finished_at: toSqlDatetime(new Date()),
          status: 'success',
          invoices_found: 0,
          invoices_new: 0,
          invoices_skipped: 0,
        });
        return (await this.fetchRunRepo.findById(run.id))!;
      }

      await log(`Starting fetch for ${eligibleVehicles.length} vehicle(s): ${eligibleVehicles.map(v => v.vin).join(', ')}`);
      if (options.dryRun) await log('DRY RUN MODE - no files will be saved');

      for (const vehicle of eligibleVehicles) {
        if (!vehicle.account_id) {
          hasErrors = true;
          await log(`[${vehicle.vin}] ERROR: No Tesla account is assigned to this vehicle.`);
          continue;
        }

        for (const fetcher of this.fetchers) {
          try {
            await log(`[${vehicle.vin}] Fetching ${fetcher.type} invoices...`);
            const invoiceList = await fetcher.fetchInvoiceList(vehicle.vin, vehicle.region, vehicle.account_id);
            totalFound += invoiceList.length;
            await log(`[${vehicle.vin}] Found ${invoiceList.length} ${fetcher.type} invoice(s)`);

            for (const item of invoiceList) {
              const existing = await this.invoiceRepo.findByExternalId(item.externalId, fetcher.type);
              if (existing) {
                totalSkipped++;
                continue;
              }

              if (options.dryRun) {
                totalNew++;
                await log(`[${vehicle.vin}] [DRY RUN] Would download: ${item.externalId} (${item.siteName ?? 'N/A'}) ${item.invoiceDate}`);
                continue;
              }

              // Download the invoice
              await log(`[${vehicle.vin}] Downloading invoice ${item.externalId}...`);
              const pdfBuffer = await fetcher.downloadInvoice(item.externalId, vehicle.region, vehicle.vin, vehicle.account_id);
              const fileHash = createHash('sha256').update(pdfBuffer).digest('hex');

              // Check for content duplicates
              const hashDupe = await this.invoiceRepo.findByHash(fileHash);
              if (hashDupe) {
                totalSkipped++;
                await log(`[${vehicle.vin}] Skipping duplicate (same content hash): ${item.externalId}`);
                continue;
              }

              // Save file
              const fileName = this.buildFileName(vehicle, fetcher.type, item);
              const filePath = await this.saveFile(pdfBuffer, fileName);

              // Store in DB
              await this.invoiceRepo.create({
                external_id: item.externalId,
                vin: vehicle.vin,
                vehicle_id: vehicle.id,
                invoice_type: fetcher.type,
                invoice_date: item.invoiceDate,
                amount_cents: item.amountCents,
                currency: item.currency,
                site_name: item.siteName ?? null,
                energy_kwh: item.energyKwh ?? null,
                file_path: filePath,
                file_hash: fileHash,
                file_size: pdfBuffer.length,
                original_name: (item.metadata as any)?.fileName ?? null,
                metadata: JSON.stringify(item.metadata),
              });

              totalNew++;
              await log(`[${vehicle.vin}] Saved: ${fileName}`);
            }
          } catch (err) {
            hasErrors = true;
            const detail = formatError(err);
            await log(`[${vehicle.vin}] ERROR in ${fetcher.type}: ${detail}`);
            logStream.error(`Fetcher error`, { vin: vehicle.vin, type: fetcher.type, error: detail });
          }
        }
      }

      const status = hasErrors ? 'partial' : 'success';
      await log(`Fetch complete: ${totalFound} found, ${totalNew} new, ${totalSkipped} skipped`);

      await this.fetchRunRepo.update(run.id, {
        finished_at: toSqlDatetime(new Date()),
        status,
        invoices_found: totalFound,
        invoices_new: totalNew,
        invoices_skipped: totalSkipped,
      });

      return (await this.fetchRunRepo.findById(run.id))!;
    } catch (err) {
      const detail = formatError(err);
      await log(`FATAL ERROR: ${detail}`);
      await this.fetchRunRepo.update(run.id, {
        finished_at: toSqlDatetime(new Date()),
        status: 'failed',
        invoices_found: totalFound,
        invoices_new: totalNew,
        invoices_skipped: totalSkipped,
        error_message: detail,
      });
      return (await this.fetchRunRepo.findById(run.id))!;
    }
  }

  private buildFileName(vehicle: Vehicle, type: string, item: InvoiceListItem): string {
    const template = config.invoiceFilenameTemplate;
    const date = item.invoiceDate.split('T')[0] ?? item.invoiceDate;
    const site = (item.siteName ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const vinLast6 = vehicle.vin.slice(-6);

    return template
      .replace('{date}', date)
      .replace('{type}', type)
      .replace('{vin}', vehicle.vin)
      .replace('{vin:last6}', vinLast6)
      .replace('{site}', site)
      .replace('{amount}', String(item.amountCents ?? 0))
      .replace('{currency}', item.currency)
      + '.pdf';
  }

  private async saveFile(buffer: Buffer, fileName: string): Promise<string> {
    const storageDir = path.resolve(config.invoiceStorageDir);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(fileName);
    let filePath = path.join(storageDir, sanitized);

    // Handle collision
    let counter = 1;
    while (fs.existsSync(filePath)) {
      const ext = path.extname(sanitized);
      const base = path.basename(sanitized, ext);
      filePath = path.join(storageDir, `${base}_${counter}${ext}`);
      counter++;
    }

    fs.writeFileSync(filePath, buffer);
    // Store relative path
    return path.relative(storageDir, filePath);
  }
}
