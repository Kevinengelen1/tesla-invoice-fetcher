import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DbAdapter } from './adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(adapter: DbAdapter) {
  const dialect = adapter.dialect;

  // Create migrations tracking table (dialect-specific)
  if (dialect === 'mysql') {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )
    `);
  } else {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL UNIQUE,
        applied  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  const applied = new Set(
    (await adapter.all<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name),
  );

  const migrationsSubdir = dialect === 'mysql' ? 'migrations-mysql' : 'migrations';
  const migrationsDir = path.join(__dirname, migrationsSubdir);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await adapter.exec(sql);
    await adapter.run('INSERT INTO _migrations (name) VALUES (?)', [file]);
    console.log(`[DB] Applied migration: ${file}`);
  }
}

