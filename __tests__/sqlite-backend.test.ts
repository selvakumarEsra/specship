/**
 * SQLite backend reporting.
 *
 * Two backends are supported: `node-sqlite` (production: Node's built-in
 * with the bundled Node 24) and `better-sqlite3` (dev/test: ships its own
 * SQLite with FTS5, used when installed as a devDep on hosts whose system
 * Node was built without FTS5). Pin that DatabaseConnection / SpecShip
 * report one of these AND come up in WAL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { SpecShip } from '../src';

const VALID_BACKENDS = ['node-sqlite', 'better-sqlite3'] as const;

describe('DatabaseConnection — backend reporting', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-backend-'));
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a supported backend in WAL for an initialized DB', () => {
    const conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    expect(VALID_BACKENDS).toContain(conn.getBackend());
    expect(conn.getJournalMode()).toBe('wal');
    conn.close();
  });

  it('SpecShip.getBackend() delegates to the underlying DatabaseConnection', async () => {
    fs.writeFileSync(path.join(dir, 'x.ts'), `export function x(): void {}\n`);
    const cg = await SpecShip.init(dir, { index: true });
    try {
      expect(VALID_BACKENDS).toContain(cg.getBackend());
    } finally {
      cg.destroy();
    }
  });
});
