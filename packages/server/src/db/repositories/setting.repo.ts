import type { DbAdapter } from '../adapter.js';
import { Setting } from '../../types/models.js';

export class SettingRepo {
  constructor(private db: DbAdapter) {}

  get(key: string): string | undefined {
    // Sync fallback used by config.getSetting() before DB is async-initialized.
    // Since SqliteAdapter wraps sync calls, this safely returns via the getter below.
    return this._syncGet(key);
  }

  /** @internal used by config injection (sync interface required) */
  private _syncGet(key: string): string | undefined {
    // For SQLite: leverage the fact that SqliteAdapter's .get() wrapped in a then() still runs synchronously
    // We store the last values in a simple in-memory cache for the sync interface
    return this._cache.get(key);
  }

  private _cache = new Map<string, string>();

  async load(): Promise<void> {
    const rows = await this.db.all<Setting>('SELECT * FROM settings');
    for (const row of rows) {
      this._cache.set(row.key, row.value);
    }
  }

  async getAsync(key: string): Promise<string | undefined> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE `key` = ?', [key]);
    if (row) this._cache.set(key, row.value);
    return row?.value;
  }

  async getAll(): Promise<Setting[]> {
    return this.db.all<Setting>('SELECT * FROM settings ORDER BY `key`');
  }

  async set(key: string, value: string): Promise<void> {
    let sql: string;
    if (this.db.dialect === 'mysql') {
      sql = 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)';
    } else {
      sql = "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";
    }
    await this.db.run(sql, [key, value]);
    this._cache.set(key, value);
  }

  async setBulk(settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.db.run('DELETE FROM settings WHERE `key` = ?', [key]);
    this._cache.delete(key);
  }
}
