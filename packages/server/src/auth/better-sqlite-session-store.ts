import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import session from 'express-session';

interface BetterSqliteSessionStoreOptions {
  dbPath: string;
}

type StoredSessionRow = {
  sess: string;
  expires_at: number;
};

export class BetterSqliteSessionStore extends session.Store {
  private readonly db: Database.Database;
  private readonly getStatement: Database.Statement<[string], StoredSessionRow | undefined>;
  private readonly setStatement: Database.Statement<[string, string, number, number]>;
  private readonly touchStatement: Database.Statement<[string, number, number, string]>;
  private readonly deleteStatement: Database.Statement<[string]>;
  private readonly cleanupStatement: Database.Statement<[number]>;

  constructor(options: BetterSqliteSessionStoreOptions) {
    super();

    const resolvedPath = path.resolve(options.dbPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
    `);

    this.getStatement = this.db.prepare(
      'SELECT sess, expires_at FROM sessions WHERE sid = ?',
    ) as Database.Statement<[string], StoredSessionRow | undefined>;
    this.setStatement = this.db.prepare(`
      INSERT INTO sessions (sid, sess, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        sess = excluded.sess,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `) as Database.Statement<[string, string, number, number]>;
    this.touchStatement = this.db.prepare(`
      UPDATE sessions
      SET sess = ?, expires_at = ?, updated_at = ?
      WHERE sid = ?
    `) as Database.Statement<[string, number, number, string]>;
    this.deleteStatement = this.db.prepare(
      'DELETE FROM sessions WHERE sid = ?',
    ) as Database.Statement<[string]>;
    this.cleanupStatement = this.db.prepare(
      'DELETE FROM sessions WHERE expires_at <= ?',
    ) as Database.Statement<[number]>;

    this.cleanupExpiredSessions();
  }

  override get(sid: string, callback: (err?: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = this.getStatement.get(sid);
      if (!row) {
        callback(undefined, null);
        return;
      }

      if (row.expires_at <= Date.now()) {
        this.deleteStatement.run(sid);
        callback(undefined, null);
        return;
      }

      callback(undefined, JSON.parse(row.sess) as session.SessionData);
    } catch (error) {
      callback(error);
    }
  }

  override set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      const now = Date.now();
      this.setStatement.run(
        sid,
        JSON.stringify(sessionData),
        this.resolveExpiry(sessionData, now),
        now,
      );
      this.maybeCleanupExpiredSessions(now);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  override touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    try {
      const now = Date.now();
      this.touchStatement.run(
        JSON.stringify(sessionData),
        this.resolveExpiry(sessionData, now),
        now,
        sid,
      );
      this.maybeCleanupExpiredSessions(now);
      callback?.();
    } catch {
      callback?.();
    }
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.deleteStatement.run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  close(): void {
    this.db.close();
  }

  private resolveExpiry(sessionData: session.SessionData, now: number): number {
    const cookieExpiry = sessionData.cookie?.expires;
    if (cookieExpiry instanceof Date) {
      return cookieExpiry.getTime();
    }

    if (typeof cookieExpiry === 'string') {
      const parsed = new Date(cookieExpiry).getTime();
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    const maxAge = sessionData.cookie?.maxAge;
    if (typeof maxAge === 'number' && Number.isFinite(maxAge)) {
      return now + maxAge;
    }

    return now + 24 * 60 * 60 * 1000;
  }

  private cleanupExpiredSessions(now = Date.now()): void {
    this.cleanupStatement.run(now);
  }

  private maybeCleanupExpiredSessions(now: number): void {
    if (Math.random() < 0.02) {
      this.cleanupExpiredSessions(now);
    }
  }
}