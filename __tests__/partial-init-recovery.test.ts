/**
 * Regression: a half-baked DB (init crashed partway through schema.sql, so
 * schema_versions is stamped at v=1 but the tables already have the columns
 * migration #2 adds) must still open without "duplicate column name".
 *
 * The historical trigger was FTS5 missing from Node 22.x's bundled SQLite,
 * which threw mid-schema and left the file on disk in this orphan state.
 * The fix is two-pronged: (a) `initialize()` now wraps schema load in a
 * transaction and removes the file on failure so the orphan state can't be
 * created in the first place; (b) migration #2 is defensive so any orphan
 * DBs already in the wild still open.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { getCurrentVersion, runMigrations, CURRENT_SCHEMA_VERSION } from '../src/db/migrations';

describe('partial-init recovery', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-partial-init-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens a DB whose schema_versions is stuck at v=1 without erroring on duplicate columns', () => {
    const dbPath = path.join(dir, 'specship.db');

    // Build the orphan state: fully-applied schema, but only the v=1 stamp
    // (the one from schema.sql) survived — the v=CURRENT stamp from
    // `initialize()` did not. Mirrors what the FTS5 crash left behind.
    const conn = DatabaseConnection.initialize(dbPath);
    conn.getDb().exec('DELETE FROM schema_versions WHERE version > 1');
    expect(getCurrentVersion(conn.getDb())).toBe(1);
    conn.close();

    // Re-opening triggers migrations 2/3/4 against a schema that already has
    // file_path / language / provenance. Pre-fix: ALTER throws. Post-fix:
    // hasColumn() guards every ALTER, migration #2 is a no-op.
    const reopened = DatabaseConnection.open(dbPath);
    expect(getCurrentVersion(reopened.getDb())).toBe(CURRENT_SCHEMA_VERSION);
    reopened.close();
  });

  it('migration #2 is idempotent when run directly against a fresh schema', () => {
    const dbPath = path.join(dir, 'specship.db');
    const conn = DatabaseConnection.initialize(dbPath);

    // Wipe the version stamps so runMigrations() considers migration #2 pending.
    conn.getDb().exec('DELETE FROM schema_versions');
    expect(() => runMigrations(conn.getDb(), 0)).not.toThrow();

    conn.close();
  });
});
