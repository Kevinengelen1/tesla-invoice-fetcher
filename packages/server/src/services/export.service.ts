import type { Invoice } from '../types/models.js';

export function invoicesToCsv(invoices: Invoice[]): string {
  const headers = [
    'ID', 'External ID', 'VIN', 'Type', 'Date', 'Amount', 'Currency',
    'Site', 'Energy (kWh)', 'File', 'Created',
  ];

  const rows = invoices.map(inv => [
    inv.id,
    inv.external_id,
    inv.vin,
    inv.invoice_type,
    inv.invoice_date,
    inv.amount_cents != null ? (inv.amount_cents / 100).toFixed(2) : '',
    inv.currency,
    inv.site_name ?? '',
    inv.energy_kwh ?? '',
    inv.file_path,
    inv.created_at,
  ]);

  const escape = (val: unknown): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  return [
    headers.join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ].join('\n');
}
