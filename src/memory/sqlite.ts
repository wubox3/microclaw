import { DatabaseSync } from "node:sqlite";

export type SqliteDb = DatabaseSync;

export function openDatabase(path: string): SqliteDb {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function closeDatabase(db: SqliteDb): void {
  db.close();
}
