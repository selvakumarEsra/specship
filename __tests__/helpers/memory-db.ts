/**
 * In-memory SQLite for tests, via the project's own adapter.
 *
 * `createDatabase` prefers the native `better-sqlite3` when its binding is built
 * and transparently falls back to Node's built-in `node:sqlite` otherwise — so
 * tests never hard-depend on a native compile that varies by host / Node ABI
 * (`better-sqlite3` is an optionalDependency). This mirrors how the production
 * code and the rest of the DB test-suite acquire a connection.
 */

import { createDatabase, type SqliteDatabase } from '../../src/db/sqlite-adapter';

export function openMemoryDb(): SqliteDatabase {
  return createDatabase(':memory:').db;
}
