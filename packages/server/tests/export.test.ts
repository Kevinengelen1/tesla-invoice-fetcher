import { describe, it, expect } from 'vitest';
import { invoicesToCsv } from '../src/services/export.service.js';
import type { Invoice } from '../src/types/models.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    external_id: 'ext-001',
    vin: 'LRW3E7FA5NC123456',
    vehicle_id: 1,
    invoice_type: 'supercharger',
    invoice_date: '2025-01-15',
    amount_cents: 1250,
    currency: 'EUR',
    site_name: 'Amsterdam SC',
    energy_kwh: 35.2,
    file_path: 'inv_001.pdf',
    file_hash: 'abc123',
    file_size: 50000,
    original_name: 'invoice.pdf',
    renamed: 0,
    emailed: 0,
    metadata: null,
    created_at: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('invoicesToCsv', () => {
  it('should produce valid CSV with headers', () => {
    const csv = invoicesToCsv([makeInvoice()]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('ID');
    expect(lines[0]).toContain('VIN');
    expect(lines[0]).toContain('Amount');
  });

  it('should handle empty list', () => {
    const csv = invoicesToCsv([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // headers only
  });

  it('should escape commas and quotes in fields', () => {
    const inv = makeInvoice({ site_name: 'Amsterdam, "Central" SC' });
    const csv = invoicesToCsv([inv]);
    expect(csv).toContain('"Amsterdam, ""Central"" SC"');
  });

  it('should format amount correctly', () => {
    const inv = makeInvoice({ amount_cents: 1250 });
    const csv = invoicesToCsv([inv]);
    expect(csv).toContain('12.50');
  });

  it('should handle null amount', () => {
    const inv = makeInvoice({ amount_cents: null });
    const csv = invoicesToCsv([inv]);
    const lines = csv.split('\n');
    // Amount cell should be empty
    expect(lines[1]).toBeDefined();
  });
});
