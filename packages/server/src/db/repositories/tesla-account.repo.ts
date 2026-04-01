import type { DbAdapter } from '../adapter.js';
import type { Region, TeslaAccount } from '../../types/models.js';

export class TeslaAccountRepo {
  constructor(private db: DbAdapter) {}

  async findAll(region?: Region): Promise<TeslaAccount[]> {
    if (region) {
      return this.db.all<TeslaAccount>('SELECT * FROM tesla_accounts WHERE region = ? ORDER BY name, created_at', [region]);
    }
    return this.db.all<TeslaAccount>('SELECT * FROM tesla_accounts ORDER BY region, name, created_at');
  }

  async findById(id: number): Promise<TeslaAccount | undefined> {
    return this.db.get<TeslaAccount>('SELECT * FROM tesla_accounts WHERE id = ?', [id]);
  }

  async create(data: { name: string; region: Region }): Promise<TeslaAccount> {
    const result = await this.db.run(
      'INSERT INTO tesla_accounts (name, region) VALUES (?, ?)',
      [data.name, data.region],
    );
    return (await this.findById(result.lastId))!;
  }

  async update(id: number, data: Partial<{ name: string }>): Promise<void> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    const fields = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    const updatedAt = this.db.dialect === 'mysql' ? 'NOW()' : "datetime('now')";
    await this.db.run(`UPDATE tesla_accounts SET ${fields}, updated_at = ${updatedAt} WHERE id = ?`, [...values, id]);
  }

  async delete(id: number): Promise<void> {
    await this.db.run('DELETE FROM tesla_accounts WHERE id = ?', [id]);
  }
}