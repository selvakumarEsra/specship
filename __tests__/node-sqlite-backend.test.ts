/**
 * node:sqlite backend (issue #238 follow-up).
 *
 * Forces the node:sqlite backend (production path) and drives a real index
 * + queries through it — WAL, FTS5 search, and @named-param writes all
 * exercised end-to-end.
 *
 * Skipped on Node < 22.5 where node:sqlite doesn't exist, AND on hosts
 * whose built-in node:sqlite was compiled without FTS5 (common on Node
 * 22.x macOS builds — the production install ships Node 24 with FTS5).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';

/**
 * Probe: does the host's node:sqlite have FTS5 compiled in? If not, skip
 * the suite — this test's whole purpose is to exercise the node:sqlite
 * path, but the schema requires FTS5.
 */
const nodeSqliteHasFts5 = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
      return false;
    }
  } catch {
    return false;
  }
})();

describe.skipIf(!nodeSqliteHasFts5)('node:sqlite backend — real index + queries', () => {
  let dir: string;
  let cg: SpecShip;
  let savedBackend: string | undefined;

  beforeAll(async () => {
    // Force node:sqlite for this suite (better-sqlite3 may be installed as a
    // devDep, which the adapter would otherwise prefer). The other suite
    // exercises the better-sqlite3 path.
    savedBackend = process.env.SPECSHIP_SQLITE_BACKEND;
    process.env.SPECSHIP_SQLITE_BACKEND = 'node-sqlite';

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-nodesqlite-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function helper(): number { return 1; }\n');
    fs.writeFileSync(
      path.join(dir, 'b.ts'),
      "import { helper } from './a';\nexport function main(): number { return helper(); }\n"
    );
    cg = await SpecShip.init(dir, { index: true });
  });

  afterAll(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedBackend === undefined) {
      delete process.env.SPECSHIP_SQLITE_BACKEND;
    } else {
      process.env.SPECSHIP_SQLITE_BACKEND = savedBackend;
    }
  });

  it('uses the node:sqlite backend', () => {
    expect(cg.getBackend()).toBe('node-sqlite');
  });

  it('runs in WAL mode — the whole reason it beats the wasm fallback', () => {
    expect(cg.getJournalMode()).toBe('wal');
  });

  it('indexed the project (write path: @named-param INSERTs via node:sqlite)', () => {
    const stats = cg.getStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.nodeCount).toBeGreaterThan(0);
  });

  it('FTS5 search returns the indexed symbol (read path)', () => {
    const results = cg.searchNodes('helper');
    const names = results.map(r => r.node.name);
    expect(names).toContain('helper');
  });

  it('graph traversal resolves the cross-file caller', () => {
    const helper = cg.searchNodes('helper').find(r => r.node.name === 'helper');
    expect(helper).toBeTruthy();
    const callers = cg.getCallers(helper!.node.id);
    expect(callers.map(c => c.node.name)).toContain('main');
  });
});
