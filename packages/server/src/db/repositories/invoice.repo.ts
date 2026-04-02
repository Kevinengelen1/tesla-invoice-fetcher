import type { DbAdapter } from '../adapter.js';
import { Invoice, InvoiceAnalyticsFilter, InvoiceAnalyticsPoint, InvoiceFilter } from '../../types/models.js';

export class InvoiceRepo {
  constructor(private db: DbAdapter) {}

  async findById(id: number): Promise<Invoice | undefined> {
    return this.db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
  }

  async findByExternalId(externalId: string, invoiceType: string): Promise<Invoice | undefined> {
    return this.db.get<Invoice>(
      'SELECT * FROM invoices WHERE external_id = ? AND invoice_type = ?',
      [externalId, invoiceType],
    );
  }

  async findByHash(hash: string): Promise<Invoice | undefined> {
    return this.db.get<Invoice>('SELECT * FROM invoices WHERE file_hash = ?', [hash]);
  }

  async findFiltered(filter: InvoiceFilter): Promise<{ data: Invoice[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.search) {
      conditions.push('(external_id LIKE ? OR site_name LIKE ? OR vin LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
    }
    if (filter.vin) {
      conditions.push('vin = ?');
      params.push(filter.vin);
    }
    if (filter.type) {
      conditions.push('invoice_type = ?');
      params.push(filter.type);
    }
    if (filter.dateFrom) {
      conditions.push('invoice_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      conditions.push('invoice_date <= ?');
      params.push(filter.dateTo);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderByClause = this.resolveFilterOrderByClause(filter);
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = ((filter.page ?? 1) - 1) * limit;

    const countRow = await this.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM invoices ${where}`, params);
    const total = countRow?.count ?? 0;
    const data = await this.db.all<Invoice>(
      `SELECT * FROM invoices ${where} ${orderByClause} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { data, total };
  }

  async create(data: Omit<Invoice, 'id' | 'created_at' | 'renamed' | 'emailed'>): Promise<Invoice> {
    const result = await this.db.run(
      'INSERT INTO invoices (external_id, vin, vehicle_id, invoice_type, invoice_date, amount_cents, currency, site_name, energy_kwh, file_path, file_hash, file_size, original_name, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [data.external_id, data.vin, data.vehicle_id ?? null, data.invoice_type, data.invoice_date, data.amount_cents ?? null, data.currency ?? null, data.site_name ?? null, data.energy_kwh ?? null, data.file_path, data.file_hash, data.file_size ?? null, data.original_name ?? null, data.metadata ?? null],
    );
    return (await this.findById(result.lastId))!;
  }

  async updateFilePath(id: number, filePath: string): Promise<void> {
    await this.db.run('UPDATE invoices SET file_path = ?, renamed = 1 WHERE id = ?', [filePath, id]);
  }

  async markEmailed(id: number): Promise<void> {
    await this.db.run('UPDATE invoices SET emailed = 1 WHERE id = ?', [id]);
  }

  async delete(id: number): Promise<void> {
    await this.db.run('DELETE FROM invoices WHERE id = ?', [id]);
  }

  async count(): Promise<number> {
    const row = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM invoices');
    return row?.count ?? 0;
  }

  async countByType(): Promise<Record<string, number>> {
    const rows = await this.db.all<{ invoice_type: string; count: number }>(
      'SELECT invoice_type, COUNT(*) as count FROM invoices GROUP BY invoice_type',
    );
    return Object.fromEntries(rows.map((r) => [r.invoice_type, r.count]));
  }

  async totalAmount(): Promise<number> {
    const row = await this.db.get<{ total: number }>('SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices');
    return row?.total ?? 0;
  }

  async findAll(): Promise<Invoice[]> {
    return this.db.all<Invoice>('SELECT * FROM invoices ORDER BY invoice_date DESC');
  }

  async latestInvoiceDateForVins(vins: string[]): Promise<string | null> {
    if (vins.length === 0) return null;
    const placeholders = vins.map(() => '?').join(',');
    const row = await this.db.get<{ latest: string | null }>(
      `SELECT MAX(invoice_date) AS latest FROM invoices WHERE vin IN (${placeholders})`,
      vins,
    );
    return row?.latest ?? null;
  }

  async findByIds(ids: number[]): Promise<Invoice[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.all<Invoice>(`SELECT * FROM invoices WHERE id IN (${placeholders})`, ids);
  }

  async analytics(filter: InvoiceAnalyticsFilter): Promise<InvoiceAnalyticsPoint[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.vin) {
      conditions.push('vin = ?');
      params.push(filter.vin);
    }

    if (filter.type) {
      conditions.push('invoice_type = ?');
      params.push(filter.type);
    }

    if (filter.dateFrom) {
      conditions.push('invoice_date >= ?');
      params.push(filter.dateFrom);
    }

    if (filter.dateTo) {
      conditions.push('invoice_date <= ?');
      params.push(filter.dateTo);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const groupBy = filter.groupBy ?? 'month';

    const periodExpression = this.db.dialect === 'mysql'
      ? this.mysqlPeriodExpression(groupBy)
      : this.sqlitePeriodExpression(groupBy);

    return this.db.all<InvoiceAnalyticsPoint>(
      `SELECT ${periodExpression} AS period,
              invoice_type,
              COALESCE(SUM(amount_cents), 0) AS amount_cents,
              COALESCE(SUM(energy_kwh), 0) AS energy_kwh,
              COUNT(*) AS invoice_count
       FROM invoices
       ${where}
       GROUP BY period, invoice_type
       ORDER BY period ASC, invoice_type ASC`,
      params,
    );
  }

  private sqlitePeriodExpression(groupBy: 'day' | 'week' | 'month'): string {
    if (groupBy === 'day') {
      return "strftime('%Y-%m-%d', invoice_date)";
    }

    if (groupBy === 'week') {
      return "strftime('%Y-W%W', invoice_date)";
    }

    return "strftime('%Y-%m', invoice_date)";
  }

  private mysqlPeriodExpression(groupBy: 'day' | 'week' | 'month'): string {
    if (groupBy === 'day') {
      return "DATE_FORMAT(invoice_date, '%Y-%m-%d')";
    }

    if (groupBy === 'week') {
      return "DATE_FORMAT(invoice_date, '%x-W%v')";
    }

    return "DATE_FORMAT(invoice_date, '%Y-%m')";
  }

  private resolveFilterOrderByClause(filter: InvoiceFilter): string {
    const direction = filter.order === 'asc' ? 'ASC' : 'DESC';

    switch (filter.sort) {
      case 'vin':
        return `ORDER BY vin ${direction}`;
      case 'invoice_type':
        return `ORDER BY invoice_type ${direction}`;
      case 'amount_cents':
        return `ORDER BY amount_cents ${direction}`;
      case 'site_name':
        return `ORDER BY site_name ${direction}`;
      case 'energy_kwh':
        return `ORDER BY energy_kwh ${direction}`;
      case 'created_at':
        return `ORDER BY created_at ${direction}`;
      case 'invoice_date':
      default:
        return `ORDER BY invoice_date ${direction}`;
    }
  }
}

