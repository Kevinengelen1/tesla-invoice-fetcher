import { Router, Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { requireAuth } from '../auth/guards.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { InvoiceRepo } from '../db/repositories/invoice.repo.js';
import { config } from '../config.js';
import { invoicesToCsv } from '../services/export.service.js';
import { previewRename, executeRename } from '../services/rename.service.js';

const listQuerySchema = z.object({
  search: z.string().optional(),
  vin: z.string().optional(),
  type: z.enum(['supercharger', 'subscription', 'service']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const renameSchema = z.object({
  ids: z.array(z.number()).min(1),
  template: z.string().min(1).max(200),
});

const downloadZipSchema = z.object({
  ids: z.array(z.number()).min(1).max(200),
});

export function createInvoiceRoutes(invoiceRepo: InvoiceRepo): Router {
  const router = Router();

  router.get('/', requireAuth, validate(listQuerySchema, 'query'), asyncHandler(async (req: Request, res: Response) => {
    const result = await invoiceRepo.findFiltered(req.query as any);
    res.json(result);
  }));

  router.get('/export/csv', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const invoices = await invoiceRepo.findAll();
    const csv = invoicesToCsv(invoices);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tesla-invoices.csv');
    res.send(csv);
  }));

  router.get('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const invoice = await invoiceRepo.findById(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  }));

  router.get('/:id/download', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const invoice = await invoiceRepo.findById(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const storageDir = path.resolve(config.invoiceStorageDir);
    const filePath = path.resolve(storageDir, invoice.file_path);
    if (!filePath.startsWith(storageDir + path.sep) && filePath !== storageDir) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Invoice file not found on disk' });
    }

    res.download(filePath, path.basename(invoice.file_path));
  }));

  router.post('/download-zip', requireAuth, validate(downloadZipSchema), asyncHandler(async (req: Request, res: Response) => {
    const { ids } = req.body as { ids: number[] };
    const invoices = await invoiceRepo.findByIds(ids);
    const storageDir = path.resolve(config.invoiceStorageDir);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=invoices.zip');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const invoice of invoices) {
      const filePath = path.resolve(storageDir, invoice.file_path);
      if (filePath.startsWith(storageDir + path.sep) && fs.existsSync(filePath)) {
        archive.file(filePath, { name: path.basename(invoice.file_path) });
      }
    }

    await archive.finalize();
  }));

  router.post('/rename', requireAuth, validate(renameSchema), asyncHandler(async (req: Request, res: Response) => {
    const { ids, template } = req.body;
    const invoices = await invoiceRepo.findByIds(ids);

    if (req.query.preview === 'true') {
      return res.json(previewRename(invoices, template));
    }

    const result = await executeRename(invoiceRepo, invoices, template);
    res.json(result);
  }));

  router.delete('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const invoice = await invoiceRepo.findById(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Delete file
    const storageDir = path.resolve(config.invoiceStorageDir);
    const filePath = path.resolve(storageDir, invoice.file_path);
    if (filePath.startsWith(storageDir + path.sep) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await invoiceRepo.delete(id);
    res.json({ ok: true });
  }));

  return router;
}
