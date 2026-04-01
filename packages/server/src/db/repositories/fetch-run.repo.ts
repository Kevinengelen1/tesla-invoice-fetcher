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

  async update(id: number, data: Partial<FetchRun>): Promise<void> {
    const entries = Object.entries(data).filter(([k, v]) => v !== undefined && k !== 'id');
    if (!entries.length) return;
    const fields = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    await this.db.run(`UPDATE fetch_runs SET ${fields} WHERE id = ?`, [...values, id]);
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
    const sortOrder = filter.order === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = this.resolveSortColumn(filter.sort);

    return this.db.all<FetchRun>(
      `SELECT * FROM fetch_runs ORDER BY ${sortColumn} ${sortOrder}, id DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  }

  private resolveSortColumn(sort?: FetchRunFilter['sort']): string {
    switch (sort) {
      case 'id':
      case 'status':
      case 'started_at':
      case 'finished_at':
      case 'invoices_new':
      case 'invoices_found':
      case 'invoices_skipped':
        return sort;
      case 'duration_ms':
        return this.db.dialect === 'mysql'
          ? 'TIMESTAMPDIFF(SECOND, started_at, COALESCE(finished_at, UTC_TIMESTAMP()))'
          : "(strftime('%s', COALESCE(finished_at, CURRENT_TIMESTAMP)) - strftime('%s', started_at))";
      default:
        return 'started_at';
    }
  }
}

