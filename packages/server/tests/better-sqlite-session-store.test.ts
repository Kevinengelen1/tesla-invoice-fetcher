import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import session from 'express-session';
import { afterEach, describe, expect, it } from 'vitest';
import { BetterSqliteSessionStore } from '../src/auth/better-sqlite-session-store.js';

async function createTempDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tif-session-store-'));
  return path.join(dir, 'sessions.sqlite');
}

function storeSet(store: BetterSqliteSessionStore, sid: string, sessionData: session.SessionData): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(sid, sessionData, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function storeGet(store: BetterSqliteSessionStore, sid: string): Promise<session.SessionData | null | undefined> {
  return new Promise((resolve, reject) => {
    store.get(sid, (error, sessionData) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sessionData);
    });
  });
}

function storeDestroy(store: BetterSqliteSessionStore, sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    store.destroy(sid, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

const tempDirs: string[] = [];
const stores: BetterSqliteSessionStore[] = [];

afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('BetterSqliteSessionStore', () => {
  it('stores and retrieves session data', async () => {
    const dbPath = await createTempDbPath();
    tempDirs.push(path.dirname(dbPath));
    const store = new BetterSqliteSessionStore({ dbPath });
    stores.push(store);

    await storeSet(store, 'abc123', {
      cookie: { maxAge: 60_000 } as session.Cookie,
      passport: { user: 42 },
      teslaOAuthState: 'state',
    });

    const loaded = await storeGet(store, 'abc123');
    expect(loaded?.passport?.user).toBe(42);
    expect(loaded?.teslaOAuthState).toBe('state');
  });

  it('removes expired sessions on read', async () => {
    const dbPath = await createTempDbPath();
    tempDirs.push(path.dirname(dbPath));
    const store = new BetterSqliteSessionStore({ dbPath });
    stores.push(store);

    await storeSet(store, 'expired', {
      cookie: { expires: new Date(Date.now() - 1_000) } as session.Cookie,
    });

    const loaded = await storeGet(store, 'expired');
    expect(loaded).toBeNull();
  });

  it('destroys sessions explicitly', async () => {
    const dbPath = await createTempDbPath();
    tempDirs.push(path.dirname(dbPath));
    const store = new BetterSqliteSessionStore({ dbPath });
    stores.push(store);

    await storeSet(store, 'to-delete', {
      cookie: { maxAge: 60_000 } as session.Cookie,
    });
    await storeDestroy(store, 'to-delete');

    const loaded = await storeGet(store, 'to-delete');
    expect(loaded).toBeNull();
  });
});