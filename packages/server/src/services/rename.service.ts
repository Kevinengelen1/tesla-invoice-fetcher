import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { InvoiceRepo } from '../db/repositories/invoice.repo.js';
import { logStream } from './log-stream.service.js';
import type { Invoice } from '../types/models.js';

interface RenamePreview {
  id: number;
  currentPath: string;
  newPath: string;
  conflict: boolean;
}

export function buildFilename(template: string, invoice: Invoice): string {
  const date = invoice.invoice_date.split('T')[0] ?? invoice.invoice_date;
  const site = (invoice.site_name ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  const vinLast6 = invoice.vin.slice(-6);

  return template
    .replace('{date}', date)
    .replace('{type}', invoice.invoice_type)
    .replace('{vin}', invoice.vin)
    .replace('{vin:last6}', vinLast6)
    .replace('{site}', site)
    .replace('{amount}', String(invoice.amount_cents ?? 0))
    .replace('{currency}', invoice.currency)
    .replace('{seq}', String(invoice.id))
    + '.pdf';
}

export function previewRename(invoices: Invoice[], template: string): RenamePreview[] {
  const seen = new Set<string>();
  return invoices.map(inv => {
    const newName = buildFilename(template, inv);
    const conflict = seen.has(newName);
    seen.add(newName);
    return {
      id: inv.id,
      currentPath: inv.file_path,
      newPath: newName,
      conflict,
    };
  });
}

export async function executeRename(invoiceRepo: InvoiceRepo, invoices: Invoice[], template: string): Promise<{ renamed: number; errors: string[] }> {
  const storageDir = path.resolve(config.invoiceStorageDir);
  let renamed = 0;
  const errors: string[] = [];

  for (const inv of invoices) {
    try {
      const newName = path.basename(buildFilename(template, inv));
      const oldFullPath = path.join(storageDir, inv.file_path);
      const newFullPath = path.join(storageDir, newName);

      if (!fs.existsSync(oldFullPath)) {
        errors.push(`File not found: ${inv.file_path}`);
        continue;
      }

      if (oldFullPath !== newFullPath) {
        if (fs.existsSync(newFullPath)) {
          errors.push(`Target already exists: ${newName}`);
          continue;
        }
        fs.renameSync(oldFullPath, newFullPath);
        await invoiceRepo.updateFilePath(inv.id, newName);
        renamed++;
      }
    } catch (err) {
      errors.push(`Error renaming invoice ${inv.id}: ${String(err)}`);
    }
  }

  logStream.info(`Bulk rename complete: ${renamed} renamed, ${errors.length} errors`);
  return { renamed, errors };
}
