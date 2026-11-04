/**
 * Specs from spec files no longer in the checkout are removed on sync
 * (REQ-MULTIDEV-003).
 *
 * A deleted spec file — or one missing on the branch just checked out — used
 * to keep its specs and links in the index, where they surfaced as drift that
 * wasn't real. These tests drive the real path: write files → init →
 * indexAll → change the checkout → sync.
 *
 * Skipped without FTS5 in the system SQLite (same pattern as the sibling spec
 * suites) — SpecShip.init runs the full schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-removal-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

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

const SRC_A = `export function foo(): number {\n  return 1;\n}\n`;
const SRC_B = `export function bar(): number {\n  return 2;\n}\n`;
const TEST_A = `import { foo } from '../src/a';\nexport function fooWorks(): boolean {\n  return foo() === 1;\n}\n`;

const FOO_SPEC = `---
id: FOO-DOC
title: Foo
---

<!-- id: FOO-DOC -->
# Foo

<!-- id: REQ-FOO-001 -->
## Foo returns one

Foo MUST return one.

implementations:
  - src/a.ts:foo
verifies:
  - tests/a.test.ts:fooWorks
`;

const BAR_SPEC = `---
id: BAR-DOC
title: Bar
---

<!-- id: BAR-DOC -->
# Bar

<!-- id: REQ-BAR-001 -->
## Bar returns two

Bar MUST return two.

implementations:
  - src/b.ts:bar
`;

const FOO_IDS = ['FOO-DOC', 'REQ-FOO-001'];

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

describe.skipIf(!fts5Available)('spec files no longer in the checkout are pruned on sync (REQ-MULTIDEV-003)', () => {
  let dir: string;
  let cg: SpecShip | undefined;
  let sq: SpecQueries;

  const specVirtualNodes = (filePath: string): number => {
    const db = sq.getRawDb();
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM nodes WHERE kind = 'spec' AND file_path = ?`)
      .get(filePath) as { n: number };
    return row.n;
  };

  const assertFooGone = () => {
    const ids = sq.getAllSpecs().map((s) => s.id);
    for (const id of FOO_IDS) expect(ids).not.toContain(id);
    expect(sq.getAllLinks().filter((l) => l.specId.startsWith('REQ-FOO') || l.specId === 'FOO-DOC')).toEqual([]);
    expect(
      sq.getLinksByState(['drifted']).filter((l) => FOO_IDS.includes(l.specId))
    ).toEqual([]);
    expect(specVirtualNodes('specs/foo.md')).toBe(0);
    expect(sq.getSpecFileByPath('specs/foo.md')).toBeNull();
  };

  beforeEach(async () => {
    dir = tempDir();
    write(dir, 'src/a.ts', SRC_A);
    write(dir, 'src/b.ts', SRC_B);
    write(dir, 'tests/a.test.ts', TEST_A);
    write(dir, 'specs/foo.md', FOO_SPEC);
    write(dir, 'specs/bar.md', BAR_SPEC);
  });

  afterEach(() => {
    cg?.close();
    cg = undefined;
    clean(dir);
  });

  const open = async () => {
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    await cg.indexAll();
  };

  it('REQ-MULTIDEV-003.A1 deleted spec file drops specs and links', async function reqMultidev003A1() {
    await open();
    expect(sq.getSpecById('REQ-FOO-001')).not.toBeNull();
    expect(sq.getLinksBySpec('REQ-FOO-001').length).toBeGreaterThan(0);
    expect(specVirtualNodes('specs/foo.md')).toBeGreaterThan(0);

    fs.rmSync(path.join(dir, 'specs', 'foo.md'));
    await cg!.sync();

    assertFooGone();
    // The surviving file is intact.
    expect(sq.getSpecById('REQ-BAR-001')).not.toBeNull();

    // Removing the whole specs/ directory prunes everything.
    fs.rmSync(path.join(dir, 'specs'), { recursive: true, force: true });
    await cg!.sync();
    expect(sq.getAllSpecs()).toEqual([]);
    expect(sq.getAllSpecFiles()).toEqual([]);
    expect(sq.getAllLinks()).toEqual([]);
  });

  it('REQ-MULTIDEV-003.A2 branch switch removes then restores', async function reqMultidev003A2() {
    git(dir, 'init', '-q', '-b', 'with');
    // Repo-local identity so commits work on CI runners with none configured.
    git(dir, 'config', 'user.name', 'SpecShip Test');
    git(dir, 'config', 'user.email', 'specship-test@example.invalid');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.specship/\n', 'utf-8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'with foo');
    git(dir, 'checkout', '-q', '-b', 'without');
    git(dir, 'rm', '-q', 'specs/foo.md');
    git(dir, 'commit', '-q', '-m', 'without foo');
    git(dir, 'checkout', '-q', 'with');

    await open();
    const before = sq.getLinksBySpec('REQ-FOO-001');
    expect(before.length).toBeGreaterThan(0);

    git(dir, 'checkout', '-q', 'without');
    await cg!.sync();
    assertFooGone();

    git(dir, 'checkout', '-q', 'with');
    await cg!.sync();
    expect(sq.getSpecById('REQ-FOO-001')).not.toBeNull();
    const after = sq.getLinksBySpec('REQ-FOO-001');
    const targets = after.map((l) => `${l.targetFilePath}:${l.targetQualifiedName}`).sort();
    expect(targets).toEqual(
      before.map((l) => `${l.targetFilePath}:${l.targetQualifiedName}`).sort()
    );
    expect(targets).toContain('src/a.ts:foo');
    expect(targets).toContain('tests/a.test.ts:fooWorks');
    // Re-resolved against the live graph, not orphaned.
    for (const l of after) {
      expect(l.state).not.toBe('orphaned');
      expect(l.resolvedNodeId).toBeTruthy();
    }
    expect(specVirtualNodes('specs/foo.md')).toBeGreaterThan(0);
  });

  it('REQ-MULTIDEV-003.A3 surviving files keep verified state', async function reqMultidev003A3() {
    await open();
    const link = sq.getLinksBySpec('REQ-BAR-001')[0]!;
    const evidence = { verification: { result: 'pass', verifiedAt: '2026-11-01T00:00:00.000Z', tests: ['bar works'] } };
    sq.updateSpecLinkState(link.id, 'verified');
    sq.updateSpecLinkMetadata(link.id, evidence);
    const before = sq.getLinkById(link.id)!;
    const barSpec = sq.getSpecById('REQ-BAR-001')!;

    fs.rmSync(path.join(dir, 'specs', 'foo.md'));
    await cg!.sync();

    assertFooGone();
    const after = sq.getLinkById(link.id)!;
    expect(after).not.toBeNull();
    expect(after.state).toBe('verified');
    expect(after.driftAxis).toBeNull();
    expect(after.metadata).toEqual(evidence);
    // Nothing but the resolver's own bookkeeping may move.
    const { updatedAt: _u1, resolvedNodeId: _r1, ...beforeRest } = before;
    const { updatedAt: _u2, resolvedNodeId: _r2, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
    expect(sq.getSpecById('REQ-BAR-001')).toEqual(barSpec);
    expect(sq.getSpecFileByPath('specs/bar.md')).not.toBeNull();
  });

  it('REQ-MULTIDEV-003.A4 code-only sync removes nothing', async function reqMultidev003A4() {
    await open();
    const specsBefore = sq.getAllSpecs().map((s) => s.id).sort();
    const filesBefore = sq.getAllSpecFiles().map((f) => `${f.path}:${f.contentHash}`);
    const linksBefore = sq.getAllLinks().map((l) => l.id).sort();

    write(dir, 'src/a.ts', SRC_A + `export function extra(): number {\n  return 3;\n}\n`);
    await cg!.sync();

    expect(sq.getAllSpecs().map((s) => s.id).sort()).toEqual(specsBefore);
    expect(sq.getAllSpecFiles().map((f) => `${f.path}:${f.contentHash}`)).toEqual(filesBefore);
    expect(sq.getAllLinks().map((l) => l.id).sort()).toEqual(linksBefore);
  });
});
