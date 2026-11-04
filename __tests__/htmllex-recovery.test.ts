/**
 * Stale-extraction recovery on upgrade (REQ-HTMLLEX-002).
 *
 * An index built by the pre-fix extractor holds JS/TS files whose content hash
 * is current but whose declarations were dropped. The tests rebuild that state
 * from a real index: delete the declaration's node row, keep the file row
 * (hash/size/mtime untouched) and roll the `extraction_version` stamp back.
 * The next full sync must re-extract with no file change, exactly once.
 *
 * The fixture's `-->` sits in a string literal, which the current grammar
 * already lexes correctly (REQ-HTMLLEX-001.A4), so the test proves the
 * recovery mechanism independent of the regex-literal fix itself.
 *
 * Skipped without FTS5 in the system SQLite (same pattern as the sibling spec
 * suites) — SpecShip.init runs the full schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { EXTRACTION_VERSION, EXTRACTION_VERSION_KEY } from '../src/extraction';
import type { QueryBuilder } from '../src/db/queries';

const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    // better-sqlite3 not installed — fall through to node:sqlite.
  }
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
    }
  } catch {
    // node:sqlite not available either (Node < 22.5).
  }
  return false;
})();

const STRIP_TS = `export function stripComments(s: string): string {
  return s.split('<!--').join('').split('-->').join('');
}

export const MARKER = 'keep';
`;

const SPEC_MD = `---
id: RECOVER-DOC
title: Recovery demo
---

<!-- id: RECOVER-DOC -->
# Recovery demo

<!-- id: REQ-RECOVER-001 -->
## Strip HTML comments

Comments are stripped.

implementations:
  - src/strip.ts:stripComments
`;

const repoChangelog = path.resolve(__dirname, '..', 'CHANGELOG.md');

describe.skipIf(!fts5Available)('stale-extraction recovery on sync (REQ-HTMLLEX-002)', () => {
  let dir: string;
  let cg: SpecShip;

  const queries = (): QueryBuilder => (cg as unknown as { queries: QueryBuilder }).queries;
  const rawDb = () =>
    (cg as unknown as { db: { getDb(): { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown } } } }).db.getDb();
  const hasNode = (name: string): boolean =>
    rawDb().prepare('SELECT 1 AS ok FROM nodes WHERE name = ? AND kind = ?').get(name, 'function') !== undefined;
  const linkStates = (): string[] =>
    cg.getSpecQueries().getAllLinks()
      .filter((l) => l.specId === 'REQ-RECOVER-001' && l.targetQualifiedName === 'stripComments')
      .map((l) => l.state);

  /** Rewind the index to what the pre-fix extractor left behind. */
  const simulatePreFixIndex = (): void => {
    rawDb().prepare('DELETE FROM nodes WHERE name = ? AND file_path = ?').run('stripComments', 'src/strip.ts');
    queries().setMetadata(EXTRACTION_VERSION_KEY, '1');
  };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-htmllex-recover-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'strip.ts'), STRIP_TS, 'utf-8');
    fs.writeFileSync(path.join(dir, 'specs', 'recover.md'), SPEC_MD, 'utf-8');
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    expect(hasNode('stripComments')).toBe(true);
    expect(queries().getMetadata(EXTRACTION_VERSION_KEY)).toBe(String(EXTRACTION_VERSION));
  });

  afterEach(() => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('REQ-HTMLLEX-002.A1: sync with no file changes restores a declaration dropped by the pre-fix extractor', async function reqHtmllex002A1() {
    simulatePreFixIndex();
    expect(hasNode('stripComments')).toBe(false);

    const result = await cg.sync();

    expect(hasNode('stripComments')).toBe(true);
    expect(result.filesModified).toBeGreaterThanOrEqual(1);
    expect(queries().getMetadata(EXTRACTION_VERSION_KEY)).toBe(String(EXTRACTION_VERSION));
  });

  it('REQ-HTMLLEX-002.A2: a second sync with no file changes re-extracts nothing', async function reqHtmllex002A2() {
    simulatePreFixIndex();
    await cg.sync();
    expect(hasNode('stripComments')).toBe(true);

    const second = await cg.sync();

    expect(second.filesModified).toBe(0);
    expect(second.filesAdded).toBe(0);
    expect(second.nodesUpdated).toBe(0);
  });

  it('REQ-HTMLLEX-002.A3: spec links whose targets reappear leave orphaned in the same sync', async function reqHtmllex002A3() {
    expect(linkStates().length).toBeGreaterThan(0);
    simulatePreFixIndex();
    // Re-resolve against the rewound graph so the link is born orphaned, as on
    // a real pre-fix index.
    await cg.indexSpecs();
    expect(linkStates()).toContain('orphaned');

    await cg.sync();

    const states = linkStates();
    expect(states.length).toBeGreaterThan(0);
    expect(states).not.toContain('orphaned');
  });

  it('REQ-HTMLLEX-002: a file-scoped sync does not stamp the version; the next full sync still recovers', async function reqHtmllex002ScopedSyncDoesNotStamp() {
    simulatePreFixIndex();

    await cg.indexFiles(['src/strip.ts']);
    expect(queries().getMetadata(EXTRACTION_VERSION_KEY)).toBe('1');

    await cg.sync();
    expect(hasNode('stripComments')).toBe(true);
    expect(queries().getMetadata(EXTRACTION_VERSION_KEY)).toBe(String(EXTRACTION_VERSION));
  });

  // chmod 000 doesn't block reads on Windows or for root.
  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'REQ-HTMLLEX-002.A2: a stale file that fails to read does not leave the index re-extracting on every sync',
    async function reqHtmllex002A2FailedFileStillStamps() {
      const locked = path.join(dir, 'src', 'locked.ts');
      fs.writeFileSync(locked, 'export function lockedFn(): number { return 1; }\n', 'utf-8');
      await cg.sync();
      simulatePreFixIndex();
      fs.chmodSync(locked, 0o000);
      try {
        await cg.sync();
        expect(hasNode('stripComments')).toBe(true);
        expect(queries().getMetadata(EXTRACTION_VERSION_KEY)).toBe(String(EXTRACTION_VERSION));

        const second = await cg.sync();
        expect(second.filesModified).toBe(0);
        expect(second.nodesUpdated).toBe(0);
      } finally {
        fs.chmodSync(locked, 0o644);
      }
    },
  );
});

describe('REQ-HTMLLEX-002 changelog', () => {
  it('REQ-HTMLLEX-002.A4: [Unreleased] carries a Fixes entry for the HTML-comment regex recovery', function reqHtmllex002A4() {
    const changelog = fs.readFileSync(repoChangelog, 'utf-8');
    const start = changelog.indexOf('## [Unreleased]');
    expect(start).toBeGreaterThanOrEqual(0);
    const next = changelog.indexOf('\n## [', start + 1);
    const unreleased = changelog.slice(start, next === -1 ? undefined : next);

    expect(unreleased).toMatch(/^### Fixes$/m);
    const entry = unreleased.split('\n').find((l) => /HTML-comment/i.test(l)) ?? '';
    expect(entry).toMatch(/regex/i);
    expect(entry).toMatch(/missing from the index/i);
    expect(entry).toMatch(/next sync/i);
  });
});
