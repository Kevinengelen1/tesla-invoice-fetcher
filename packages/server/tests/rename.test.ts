import { describe, it, expect } from 'vitest';
import { buildFilename } from '../src/services/rename.service.js';
import type { Invoice } from '../src/types/models.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 42,
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

describe('buildFilename', () => {
  it('should replace all template variables', () => {
    const result = buildFilename('{date}_{type}_{vin}_{site}', makeInvoice());
    expect(result).toBe('2025-01-15_supercharger_LRW3E7FA5NC123456_Amsterdam_SC.pdf');
  });

  it('should support vin:last6', () => {
    const result = buildFilename('{date}_{vin:last6}', makeInvoice());
    expect(result).toBe('2025-01-15_123456.pdf');
  });

  it('should replace amount and currency', () => {
    const result = buildFilename('{amount}_{currency}', makeInvoice());
    expect(result).toBe('1250_EUR.pdf');
  });

  it('should replace seq with invoice id', () => {
    const result = buildFilename('{seq}_{date}', makeInvoice({ id: 42 }));
    expect(result).toBe('42_2025-01-15.pdf');
  });

  it('should handle null site name', () => {
    const result = buildFilename('{site}', makeInvoice({ site_name: null }));
    expect(result).toBe('unknown.pdf');
  });

  it('should sanitize special characters in site name', () => {
    const result = buildFilename('{site}', makeInvoice({ site_name: 'Test / Site <1>' }));
    expect(result).toBe('Test___Site__1_.pdf');
  });
});
