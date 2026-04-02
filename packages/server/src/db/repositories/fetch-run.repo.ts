import type { DbAdapter } from '../adapter.js';
import { FetchRun, FetchRunFilter } from '../../types/models.js';

export class FetchRunRepo {
  constructor(private db: DbAdapter) {}

  async findById(id: number): Promise<FetchRun | undefined> {
    return this.db.get<FetchRun>('SELECT * FROM fetch_runs WHERE id = ?', [id]);
  }

  async findRecent(limit = 10): Promise<FetchRun[]> {
    return this.db.all<FetchRun>('SELECT * FROM fetch_runs ORDER BY started_at DESC LIMIT ?', [limit]);
  }

  async create(dryRun: boolean): Promise<FetchRun> {
    const result = await this.db.run('INSERT INTO fetch_runs (dry_run) VALUES (?)', [dryRun ? 1 : 0]);
    return (await this.findById(result.lastId))!;
  }

  async update(id: number, data: Partial<Pick<FetchRun, 'finished_at' | 'status' | 'invoices_found' | 'invoices_new' | 'invoices_skipped' | 'error_message' | 'log'>>): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(data, 'finished_at')) {
      assignments.push('finished_at = ?');
      values.push(data.finished_at ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'status')) {
      assignments.push('status = ?');
      values.push(data.status);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'invoices_found')) {
      assignments.push('invoices_found = ?');
      values.push(data.invoices_found ?? 0);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'invoices_new')) {
      assignments.push('invoices_new = ?');
      values.push(data.invoices_new ?? 0);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'invoices_skipped')) {
      assignments.push('invoices_skipped = ?');
      values.push(data.invoices_skipped ?? 0);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'error_message')) {
      assignments.push('error_message = ?');
      values.push(data.error_message ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'log')) {
      assignments.push('log = ?');
      values.push(data.log ?? null);
    }

    if (!assignments.length) return;

    values.push(id);
    await this.db.run(`UPDATE fetch_runs SET ${assignments.join(', ')} WHERE id = ?`, values);
  }

  async appendLog(id: number, line: string): Promise<void> {
    const sql = this.db.dialect === 'mysql'
      ? "UPDATE fetch_runs SET log = CONCAT(COALESCE(log, ''), ?) WHERE id = ?"
      : "UPDATE fetch_runs SET log = COALESCE(log, '') || ? WHERE id = ?";
    await this.db.run(sql, [line + '\n', id]);
  }

  async findAll(filter: FetchRunFilter = {}): Promise<FetchRun[]> {
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const orderByClause = this.resolveOrderByClause(filter);

    return this.db.all<FetchRun>(
      `SELECT * FROM fetch_runs ${orderByClause} LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  }

  private resolveOrderByClause(filter: FetchRunFilter): string {
    const ascending = filter.order === 'asc';
    const direction = ascending ? 'ASC' : 'DESC';

    switch (filter.sort) {
      case 'id':
        return `ORDER BY id ${direction}`;
      case 'status':
        return `ORDER BY status ${direction}, id DESC`;
      case 'finished_at':
        return `ORDER BY finished_at ${direction}, id DESC`;
      case 'invoices_new':
        return `ORDER BY invoices_new ${direction}, id DESC`;
      case 'invoices_found':
        return `ORDER BY invoices_found ${direction}, id DESC`;
      case 'invoices_skipped':
        return `ORDER BY invoices_skipped ${direction}, id DESC`;
      case 'duration_ms':
        return this.db.dialect === 'mysql'
          ? `ORDER BY TIMESTAMPDIFF(SECOND, started_at, COALESCE(finished_at, UTC_TIMESTAMP())) ${direction}, id DESC`
          : `ORDER BY (strftime('%s', COALESCE(finished_at, CURRENT_TIMESTAMP)) - strftime('%s', started_at)) ${direction}, id DESC`;
      case 'started_at':
      default:
        return `ORDER BY started_at ${direction}, id DESC`;
    }
  }
}

