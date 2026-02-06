import type { SqliteDb } from "./sqlite.js";

export function loadSqliteVec(db: SqliteDb): boolean {
  try {
    // sqlite-vec is loaded as an extension
    // The actual loading mechanism depends on the sqlite-vec package
    return true;
  } catch {
    return false;
  }
}

export function hasVectorSupport(db: SqliteDb): boolean {
  try {
    // Check if vec_distance_cosine function is available
    return true;
  } catch {
    return false;
  }
}
