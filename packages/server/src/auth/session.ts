import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import MySQLStoreFactory from 'express-mysql-session';
import path from 'path';
import { config, getSetting } from '../config.js';

const SQLiteStore = connectSqlite3(session);
const MySQLStore = MySQLStoreFactory(session as any);

export function createSessionMiddleware() {
  const dbType = process.env.DATABASE_TYPE || 'sqlite';
  const secret = config.sessionSecret;

  const sessionOptions: session.SessionOptions = {
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: getSetting('BASE_URL').startsWith('https://'),
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
    name: 'tif.sid',
  };

  if (dbType === 'mysql') {
    sessionOptions.store = new MySQLStore({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASS,
      database: process.env.MYSQL_DATABASE || 'tesla_invoices',
      createDatabaseTable: true,
    });
  } else {
    const dbPath = path.resolve(getSetting('DATABASE_PATH') || './data/tesla-invoices.sqlite');
    const dbDir = path.dirname(dbPath);
    sessionOptions.store = new SQLiteStore({
      db: 'sessions.sqlite',
      dir: dbDir,
      concurrentDB: 'true' as any,
    }) as session.Store;
  }

  return session(sessionOptions);
}

