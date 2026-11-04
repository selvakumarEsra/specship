/**
 * Links derived from code comments are removed when their comment is gone
 * (REQ-MULTIDEV-006) — the code-side sibling of REQ-MULTIDEV-003.
 *
 * A `code-comment` link comes from an `@implements` / `@verifies` marker or a
 * requirement id in a test title. Deleting the file or the marker used to
 * leave the link behind, where it surfaced as orphaned drift that no reindex
 * cleared. These tests drive the real path: write files → init → indexAll →
 * change the code → sync.
 *
 * Skipped without FTS5 in the system SQLite (same pattern as the sibling spec
 * suites) — SpecShip.init runs the full schema.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecQueries } from '../src/db/spec-queries';

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

const MARKED = `/**\n * Returns one.\n * @implements REQ-FOO-001\n */\nexport function foo(): number {\n  return 1;\n}\n`;
const UNMARKED = `/**\n * Returns one.\n */\nexport function foo(): number {\n  return 1;\n}\n`;
const KEEP = `/**\n * Returns two.\n * @implements REQ-FOO-001\n */\nexport function bar(): number {\n  return 2;\n}\n`;
const TITLE_TEST = `import { it } from 'vitest';\nit('REQ-FOO-001 foo returns one', () => {});\n`;

const spec = (declared: string[]) => `---
id: FOO-DOC
title: Foo
---

<!-- id: FOO-DOC -->
# Foo

<!-- id: REQ-FOO-001 -->
## Foo returns one

Foo MUST return one.
${declared.length ? `\nimplementations:\n${declared.map((d) => `  - ${d}`).join('\n')}\n` : ''}`;

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe.skipIf(!fts5Available)('code-comment links follow their comment (REQ-MULTIDEV-006)', () => {
  let dir: string;
  let cg: SpecShip | undefined;
  let sq: SpecQueries;

  const linksTo = (file: string) =>
    sq.getLinksBySpec('REQ-FOO-001').filter((l) => l.targetFilePath === file);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-comment-links-'));
    write(dir, 'src/a.ts', MARKED);
    write(dir, 'src/b.ts', KEEP);
    write(dir, 'tests/foo.test.ts', TITLE_TEST);
    write(dir, 'specs/foo.md', spec([]));
  });

  afterEach(() => {
    cg?.close();
    cg = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const open = async () => {
    cg = await SpecShip.init(dir);
    sq = cg.getSpecQueries();
    await cg.indexAll();
  };

  it('REQ-MULTIDEV-006.A1 deleting the file removes its comment link', async function reqMultidev006A1() {
    await open();
    expect(linksTo('src/a.ts').map((l) => l.provenance)).toEqual(['code-comment']);

    fs.rmSync(path.join(dir, 'src', 'a.ts'));
    await cg!.sync();

    expect(linksTo('src/a.ts')).toEqual([]);
    expect(sq.getLinksByState(['orphaned', 'drifted']).filter((l) => l.specId === 'REQ-FOO-001')).toEqual([]);
    // The other file's marker still links.
    expect(linksTo('src/b.ts').length).toBe(1);
  });

  it('REQ-MULTIDEV-006.A2 removing the marker removes the link, not the symbol', async function reqMultidev006A2() {
    await open();
    expect(linksTo('src/a.ts').length).toBe(1);

    write(dir, 'src/a.ts', UNMARKED);
    await cg!.sync();

    expect(linksTo('src/a.ts')).toEqual([]);
    expect(cg!.searchNodes('foo').some((r) => r.node.name === 'foo' && r.node.filePath === 'src/a.ts')).toBe(true);
  });

  it('REQ-MULTIDEV-006.A3 deleting a test file removes its test-title link', async function reqMultidev006A3() {
    await open();
    const titled = linksTo('tests/foo.test.ts');
    expect(titled.length).toBe(1);
    expect(titled[0]!.kind).toBe('tests');

    fs.rmSync(path.join(dir, 'tests', 'foo.test.ts'));
    await cg!.sync();

    expect(linksTo('tests/foo.test.ts')).toEqual([]);
  });

  it('REQ-MULTIDEV-006.A4 a still-declared target survives as a declared link', async function reqMultidev006A4() {
    write(dir, 'specs/foo.md', spec(['src/a.ts:foo']));
    await open();
    const [link] = linksTo('src/a.ts');
    expect(link).toBeDefined();
    sq.updateSpecLinkState(link!.id, 'verified');
    sq.updateSpecLinkMetadata?.(link!.id, { verification: { result: 'pass', at: 1 } });

    write(dir, 'src/a.ts', UNMARKED);
    await cg!.sync();

    const after = linksTo('src/a.ts');
    expect(after.length).toBe(1);
    expect(after[0]!.id).toBe(link!.id);
    expect(after[0]!.provenance).toBe('spec-declaration');
    expect(after[0]!.state).toBe('verified');
  });

  it('REQ-MULTIDEV-006.A5 a sync with no change removes nothing', async function reqMultidev006A5() {
    await open();
    const before = sq.getLinksBySpec('REQ-FOO-001');
    sq.updateSpecLinkState(linksTo('src/b.ts')[0]!.id, 'verified');

    await cg!.sync();
    await cg!.indexAll();

    const after = sq.getLinksBySpec('REQ-FOO-001');
    expect(after.map((l) => l.id).sort()).toEqual(before.map((l) => l.id).sort());
    expect(linksTo('src/b.ts')[0]!.state).toBe('verified');
  });
});
