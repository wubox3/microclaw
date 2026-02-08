import { DatabaseSync } from "node:sqlite";

export type SqliteDb = DatabaseSync;

export function withTransaction<T>(db: SqliteDb, fn: () => T): T {
  const savepointName = `sp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const quoted = `"${savepointName}"`;
  db.exec(`SAVEPOINT ${quoted}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${quoted}`);
    return result;
  } catch (err) {
    try { db.exec(`ROLLBACK TO ${quoted}`); } catch { /* ignore rollback failure */ }
    throw err;
  }
}

export function openDatabase(path: string): SqliteDb {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function closeDatabase(db: SqliteDb): void {
  db.close();
}
