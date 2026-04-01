import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';

export interface RunResult {
  lastId: number;
  changes: number;
}

export interface DbAdapter {
  readonly dialect: 'sqlite' | 'mysql';
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
}

export class SqliteAdapter implements DbAdapter {
  readonly dialect = 'sqlite' as const;

  constructor(private db: Database.Database) {}

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const result = this.db.prepare(sql).run(...params);
    return { lastId: Number(result.lastInsertRowid), changes: result.changes };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  /** Expose underlying db for migration and test helpers */
  getUnderlyingDb(): Database.Database {
    return this.db;
  }
}

export class MySqlAdapter implements DbAdapter {
  readonly dialect = 'mysql' as const;

  constructor(private pool: mysql.Pool, private connConfig?: mysql.ConnectionOptions) {}

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const [rows] = await this.pool.execute(sql, params as any[]);
    return (rows as T[])[0];
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params as any[]);
    return rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const [result] = await this.pool.execute(sql, params as any[]);
    const r = result as mysql.ResultSetHeader;
    return { lastId: r.insertId, changes: r.affectedRows };
  }

  async exec(sql: string): Promise<void> {
    // Migrations may contain multiple statements; use a dedicated connection
    // with multipleStatements=true since pool has it disabled for safety.
    if (this.connConfig) {
      const conn = await mysql.createConnection({ ...this.connConfig, multipleStatements: true });
      try {
        await conn.query(sql);
      } finally {
        await conn.end();
      }
    } else {
      // Fallback: split on semicolons and execute individually
      const conn = await this.pool.getConnection();
      try {
        for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
          await conn.query(stmt);
        }
      } finally {
        conn.release();
      }
    }
  }
}
