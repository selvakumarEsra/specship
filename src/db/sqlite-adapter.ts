/**
 * SQLite Adapter
 *
 * Thin wrapper over a SQLite engine, exposed through a small
 * better-sqlite3-shaped interface so the rest of the codebase is
 * storage-agnostic.
 *
 * Backend selection (tried in order, first that loads wins):
 *   1. `better-sqlite3` — present only when the host has installed it (a
 *      devDependency in this repo, optional in user installs). Ships its
 *      own SQLite compiled with FTS5, so it's the only path that works on
 *      dev machines whose system Node was built without FTS5. Production
 *      bundle ships Node 24 with FTS5 in `node:sqlite`, so it skips this.
 *   2. `node:sqlite` — Node's built-in module (Node 22.5+). Used by the
 *      shipped Node 24 bundle which is compiled with FTS5.
 *
 * Tests, dev runs from source, and contributors get FTS5 via better-sqlite3.
 * End users on the published binary get FTS5 via the bundled Node 24.
 */

export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
  /**
   * Lazily yield result rows one at a time instead of materializing the whole
   * set with `all()`. Use for unbounded scans (e.g. every function/method node)
   * so memory stays O(1) in the row count rather than O(rows) — see #610, where
   * `all()`-ing every symbol on a dense project spiked the heap into an OOM.
   */
  iterate(...params: any[]): IterableIterator<any>;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): any;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  readonly open: boolean;
}

/**
 * The active SQLite backend. Reported per-instance so `specship status`
 * and the per-instance reporting have a stable shape.
 */
export type SqliteBackend = 'node-sqlite' | 'better-sqlite3';

/**
 * Wraps Node's built-in `node:sqlite` (`DatabaseSync`) to match the
 * better-sqlite3 interface the rest of the code expects.
 *
 * node:sqlite is real SQLite compiled into Node, so it supports WAL, FTS5,
 * mmap, and `@named` params natively — the only shims needed are the
 * better-sqlite3 conveniences node:sqlite omits: a `.pragma()` helper, a
 * `.transaction()` helper, and `open` (node:sqlite exposes `isOpen`).
 */
class NodeSqliteAdapter implements SqliteDatabase {
  private _db: any;

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    this._db = new DatabaseSync(dbPath);
  }

  get open(): boolean {
    return this._db.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    // node:sqlite matches better-sqlite3's calling convention (variadic
    // positional args, or a single object for @named params), so params forward
    // through unchanged.
    const stmt = this._db.prepare(sql);
    return {
      run(...params: any[]) {
        const r = stmt.run(...params);
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get(...params: any[]) {
        return stmt.get(...params);
      },
      all(...params: any[]) {
        return stmt.all(...params);
      },
      iterate(...params: any[]) {
        return stmt.iterate(...params);
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    const trimmed = str.trim();
    // Write pragma ("key = value"): node:sqlite is real SQLite, so every pragma
    // (WAL, mmap, synchronous, …) applies as-is.
    if (trimmed.includes('=')) {
      this._db.exec(`PRAGMA ${trimmed}`);
      return;
    }
    // Read pragma. Default: the row object (e.g. { journal_mode: 'wal' }).
    // `{ simple: true }` returns just the single column value, like better-sqlite3.
    const row = this._db.prepare(`PRAGMA ${trimmed}`).get();
    if (options?.simple) {
      return row && typeof row === 'object' ? Object.values(row)[0] : row;
    }
    return row;
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (error) {
        this._db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    // node:sqlite's DatabaseSync.close() throws if already closed; make it
    // idempotent to match better-sqlite3 (callers may close more than once).
    if (this._db.isOpen) this._db.close();
  }
}

/**
 * Wraps `better-sqlite3` to match the same interface. better-sqlite3 already
 * implements `.pragma()`, `.transaction()`, and `.open`, so this adapter is
 * mostly an interface-shape passthrough.
 *
 * better-sqlite3 ships its own SQLite (built with FTS5), so it's the dev /
 * test / contributor backend on hosts whose system Node was compiled without
 * FTS5 (common on Node 22.x macOS builds).
 */
class BetterSqlite3Adapter implements SqliteDatabase {
  private _db: any;

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    this._db = new Database(dbPath);
  }

  get open(): boolean {
    return this._db.open;
  }

  prepare(sql: string): SqliteStatement {
    const stmt = this._db.prepare(sql);
    return {
      run(...params: any[]) {
        const r = stmt.run(...params);
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get(...params: any[]) {
        return stmt.get(...params);
      },
      all(...params: any[]) {
        return stmt.all(...params);
      },
      iterate(...params: any[]) {
        return stmt.iterate(...params);
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    return this._db.pragma(str, options);
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return this._db.transaction(fn);
  }

  close(): void {
    if (this._db.open) this._db.close();
  }
}

/**
 * Determine whether better-sqlite3 is available without actually opening
 * a DB. `require.resolve` throws when the package is absent.
 */
function isBetterSqlite3Available(): boolean {
  try {
    require.resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a database connection. Prefers `better-sqlite3` (which ships its
 * own SQLite with FTS5) when available, falls back to Node's built-in
 * `node:sqlite`. Returns the active backend alongside the db so each
 * `DatabaseConnection` can report it per-instance — MCP can open multiple
 * project DBs in one process, so a process-global would race.
 *
 * Override the choice with the env var:
 *   SPECSHIP_SQLITE_BACKEND=node-sqlite     # force node:sqlite
 *   SPECSHIP_SQLITE_BACKEND=better-sqlite3  # force better-sqlite3
 */
export function createDatabase(dbPath: string): { db: SqliteDatabase; backend: SqliteBackend } {
  const forced = process.env.SPECSHIP_SQLITE_BACKEND;
  const tryBetter = forced ? forced === 'better-sqlite3' : isBetterSqlite3Available();

  const errors: string[] = [];

  if (tryBetter && forced !== 'node-sqlite') {
    try {
      return { db: new BetterSqlite3Adapter(dbPath), backend: 'better-sqlite3' };
    } catch (error) {
      errors.push(`better-sqlite3: ${error instanceof Error ? error.message : String(error)}`);
      // Only fall through to node:sqlite if the user didn't FORCE better-sqlite3.
      if (forced === 'better-sqlite3') {
        throw new Error(
          `Failed to open SQLite via better-sqlite3 (forced).\nUnderlying error: ${errors[0]}`
        );
      }
    }
  }

  try {
    return { db: new NodeSqliteAdapter(dbPath), backend: 'node-sqlite' };
  } catch (error) {
    errors.push(`node:sqlite: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(
      'Failed to open SQLite.\n' +
      'SpecShip tries better-sqlite3 first (when installed), then falls back to\n' +
      "Node's built-in node:sqlite (Node 22.5+). The production install bundles a\n" +
      'compatible Node 24 with FTS5. For dev / running from source, install\n' +
      'better-sqlite3 (`npm install --save-dev better-sqlite3`) so FTS5 works on\n' +
      'hosts whose system Node was built without it.\n' +
      `Backend errors:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}
