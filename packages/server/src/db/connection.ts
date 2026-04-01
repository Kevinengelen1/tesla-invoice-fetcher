import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';
import { SqliteAdapter, MySqlAdapter, type DbAdapter } from './adapter.js';

// Database connection settings are READ FROM ENVIRONMENT ONLY.
// These are bootstrap settings — they determine which database to connect to,
// so they can't be stored in the database itself (chicken-and-egg problem).
function envOrDefault(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

let adapter: DbAdapter | null = null;

export async function createAdapter(): Promise<DbAdapter> {
  if (adapter) return adapter;

  const dbType = envOrDefault('DATABASE_TYPE', 'sqlite');

  if (dbType === 'mysql') {
    const connConfig: mysql.ConnectionOptions = {
      host: envOrDefault('MYSQL_HOST', 'localhost'),
      port: parseInt(envOrDefault('MYSQL_PORT', '3306'), 10),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASS,
      database: envOrDefault('MYSQL_DATABASE', 'tesla_invoices'),
    };
    const pool = mysql.createPool({
      ...connConfig,
      waitForConnections: true,
      connectionLimit: 10,
      multipleStatements: false,
      // mysql2 returns DECIMAL/NUMERIC as strings by default to avoid precision loss.
      // Cast them to float so numeric fields like energy_kwh arrive as numbers.
      typeCast(field, next) {
        if (field.type === 'DECIMAL' || field.type === 'NEWDECIMAL') {
          const val = field.string();
          return val === null ? null : parseFloat(val);
        }
        return next();
      },
    });

    // Force UTC session timezone so MySQL's DEFAULT CURRENT_TIMESTAMP is consistent
    // with our Node-side UTC timestamps written via toSqlDatetime().
    (pool as any).pool.on('connection', (conn: any) => {
      conn.query("SET time_zone = '+00:00'");
    });

    adapter = new MySqlAdapter(pool, connConfig);
  } else {
    const dbPath = path.resolve(envOrDefault('DATABASE_PATH', './data/tesla-invoices.sqlite'));
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    adapter = new SqliteAdapter(db);
  }

  return adapter;
}

export function getAdapter(): DbAdapter {
  if (!adapter) throw new Error('Database adapter not initialized. Call createAdapter() first.');
  return adapter;
}

export function closeAdapter() {
  adapter = null;
}

/** Create an in-memory SQLite adapter for testing */
export function createTestAdapter(): DbAdapter {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  return new SqliteAdapter(testDb);
}

/** @deprecated Use createAdapter(). Keep for tests that directly use better-sqlite3. */
export function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

