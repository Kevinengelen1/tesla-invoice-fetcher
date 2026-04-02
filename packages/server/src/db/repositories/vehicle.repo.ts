import type { DbAdapter } from '../adapter.js';
import { Vehicle, Region } from '../../types/models.js';

export class VehicleRepo {
  constructor(private db: DbAdapter) {}

  async findAll(): Promise<Vehicle[]> {
    return this.db.all<Vehicle>(`
      SELECT vehicles.*, tesla_accounts.name AS account_name
      FROM vehicles
      LEFT JOIN tesla_accounts ON tesla_accounts.id = vehicles.account_id
      ORDER BY vehicles.created_at
    `);
  }

  async findEnabled(): Promise<Vehicle[]> {
    return this.db.all<Vehicle>(`
      SELECT vehicles.*, tesla_accounts.name AS account_name
      FROM vehicles
      LEFT JOIN tesla_accounts ON tesla_accounts.id = vehicles.account_id
      WHERE vehicles.enabled = 1
      ORDER BY vehicles.created_at
    `);
  }

  async findById(id: number): Promise<Vehicle | undefined> {
    return this.db.get<Vehicle>(`
      SELECT vehicles.*, tesla_accounts.name AS account_name
      FROM vehicles
      LEFT JOIN tesla_accounts ON tesla_accounts.id = vehicles.account_id
      WHERE vehicles.id = ?
    `, [id]);
  }

  async findByVin(vin: string): Promise<Vehicle | undefined> {
    return this.db.get<Vehicle>(`
      SELECT vehicles.*, tesla_accounts.name AS account_name
      FROM vehicles
      LEFT JOIN tesla_accounts ON tesla_accounts.id = vehicles.account_id
      WHERE vehicles.vin = ?
    `, [vin]);
  }

  async create(data: { vin: string; name?: string; region: Region; account_id?: number | null; tesla_id?: string }): Promise<Vehicle> {
    const result = await this.db.run(
      'INSERT INTO vehicles (vin, name, region, account_id, tesla_id) VALUES (?, ?, ?, ?, ?)',
      [data.vin, data.name ?? null, data.region, data.account_id ?? null, data.tesla_id ?? null],
    );
    return (await this.findById(result.lastId))!;
  }

  async update(id: number, data: Partial<Pick<Vehicle, 'name' | 'region' | 'account_id' | 'enabled'>>): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      assignments.push('name = ?');
      values.push(data.name ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'region')) {
      assignments.push('region = ?');
      values.push(data.region);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'account_id')) {
      assignments.push('account_id = ?');
      values.push(data.account_id ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'enabled')) {
      assignments.push('enabled = ?');
      values.push(data.enabled);
    }

    if (!assignments.length) return;

    values.push(id);
    await this.db.run(`UPDATE vehicles SET ${assignments.join(', ')} WHERE id = ?`, values);
  }

  async delete(id: number): Promise<void> {
    await this.db.run('DELETE FROM vehicles WHERE id = ?', [id]);
  }

  async count(): Promise<number> {
    const row = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM vehicles');
    return row?.count ?? 0;
  }
}

