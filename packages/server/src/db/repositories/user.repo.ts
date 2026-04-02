import type { DbAdapter } from '../adapter.js';
import { User } from '../../types/models.js';

export class UserRepo {
  constructor(private db: DbAdapter) {}

  async findById(id: number): Promise<User | undefined> {
    return this.db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
  }

  async findByUsername(username: string): Promise<User | undefined> {
    return this.db.get<User>('SELECT * FROM users WHERE username = ?', [username]);
  }

  async findByOidcSub(sub: string): Promise<User | undefined> {
    return this.db.get<User>('SELECT * FROM users WHERE oidc_sub = ?', [sub]);
  }

  async count(): Promise<number> {
    const row = await this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return row?.count ?? 0;
  }

  async create(data: { username: string; password_hash?: string; oidc_sub?: string; display_name?: string; role?: string }): Promise<User> {
    const result = await this.db.run(
      'INSERT INTO users (username, password_hash, oidc_sub, display_name, role) VALUES (?, ?, ?, ?, ?)',
      [data.username, data.password_hash ?? null, data.oidc_sub ?? null, data.display_name ?? null, data.role ?? 'user'],
    );
    return (await this.findById(result.lastId))!;
  }

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  }

  async update(id: number, data: { display_name?: string | null; role?: string }): Promise<User> {
    const hasDisplayName = Object.prototype.hasOwnProperty.call(data, 'display_name');
    const hasRole = Object.prototype.hasOwnProperty.call(data, 'role');

    if (!hasDisplayName && !hasRole) {
      return (await this.findById(id))!;
    }

    if (hasDisplayName && hasRole) {
      await this.db.run(
        'UPDATE users SET display_name = ?, role = ? WHERE id = ?',
        [data.display_name ?? null, data.role, id],
      );
    } else if (hasDisplayName) {
      await this.db.run('UPDATE users SET display_name = ? WHERE id = ?', [data.display_name ?? null, id]);
    } else {
      await this.db.run('UPDATE users SET role = ? WHERE id = ?', [data.role, id]);
    }

    return (await this.findById(id))!;
  }

  async upsertOidcUser(sub: string, displayName: string): Promise<User> {
    const existing = await this.findByOidcSub(sub);
    if (existing) {
      await this.db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, existing.id]);
      return (await this.findById(existing.id))!;
    }
    return this.create({ username: `oidc_${sub}`, oidc_sub: sub, display_name: displayName });
  }

  async findAll(): Promise<User[]> {
    return this.db.all<User>('SELECT * FROM users ORDER BY created_at');
  }

  async delete(id: number): Promise<void> {
    await this.db.run('DELETE FROM users WHERE id = ?', [id]);
  }
}
