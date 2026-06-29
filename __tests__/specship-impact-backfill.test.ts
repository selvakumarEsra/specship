/**
 * Task 5: backfillDisplaced
 *
 * Tests that `backfillDisplaced(db, resolveGraph)` correctly fills in
 * `resolution` and `displaced_files` for existing `is_specship=1` rows
 * that have `resolution IS NULL` (i.e. pre-upgrade rows from the v9 migration).
 *
 * Also verifies:
 *   - non-specship rows are left untouched
 *   - already-resolved rows are left untouched (idempotent)
 *   - a second run is a no-op (idempotent)
 *   - previously-'unresolved' rows ARE retried (resolver/extractor were fixed)
 */

import { describe, it, expect } from 'vitest';
import { openMemoryDb } from './helpers/memory-db';
import type { GraphLike } from '../src/analytics/specship-impact';
import { backfillDisplaced } from '../packages/server/src/ingest/impact-backfill';

// ---------------------------------------------------------------------------
// Minimal schema builder (mirrors what the real migrations create)
// ---------------------------------------------------------------------------

function buildSchema(db: ReturnType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claude_sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id TEXT,
      session_id TEXT,
      tool_name TEXT,
      input_json TEXT,
      result_length INTEGER DEFAULT 0,
      is_specship INTEGER NOT NULL DEFAULT 0,
      displaced_files TEXT,
      resolution TEXT
    );
  `);
}

// ---------------------------------------------------------------------------
// Stub GraphLike that resolves 'alpha' → a fake file list
// ---------------------------------------------------------------------------

const STUB_FILES = [{ path: '/proj/a.ts', size: 1024 }];

function makeGraph(): GraphLike {
  return {
    estimateReadEquivalent: (symbols: string[]) => {
      // If any symbol is 'alpha', simulate a resolved hit.
      if (symbols.some(s => s === 'alpha')) {
        return { files: STUB_FILES, resolved: true };
      }
      return { files: [], resolved: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers to insert seed rows
// ---------------------------------------------------------------------------

function insertSession(db: ReturnType<typeof Database>, id: string, projectPath: string): void {
  db.prepare('INSERT INTO claude_sessions (id, project_path) VALUES (?, ?)').run(id, projectPath);
}

function insertPrompt(db: ReturnType<typeof Database>, id: string, sessionId: string): void {
  db.prepare('INSERT INTO claude_prompts (id, session_id) VALUES (?, ?)').run(id, sessionId);
}

function insertToolCall(
  db: ReturnType<typeof Database>,
  opts: {
    promptId: string;
    sessionId: string;
    toolName: string;
    inputJson: string | null;
    resultLength: number;
    isSpecship: 0 | 1;
    resolution: string | null;
    displacedFiles: string | null;
  }
): number {
  const result = db.prepare(`
    INSERT INTO claude_tool_calls
      (prompt_id, session_id, tool_name, input_json, result_length, is_specship, displaced_files, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.promptId,
    opts.sessionId,
    opts.toolName,
    opts.inputJson,
    opts.resultLength,
    opts.isSpecship,
    opts.displacedFiles,
    opts.resolution,
  ) as { lastInsertRowid: number | bigint };
  return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backfillDisplaced', () => {
  it('fills resolution+displaced_files for null-resolution specship rows', () => {
    const db = openMemoryDb();
    buildSchema(db);

    const PROJECT_PATH = '/proj/alpha-project';

    // Seed a session
    insertSession(db, 'sess-01', PROJECT_PATH);
    insertPrompt(db, 'prompt-01', 'sess-01');

    // Row A: source-returning specship_node call — should become 'resolved'
    const idA = insertToolCall(db, {
      promptId: 'prompt-01',
      sessionId: 'sess-01',
      toolName: 'mcp__specship__specship_node',
      inputJson: JSON.stringify({ symbol: 'alpha' }),
      resultLength: 500,
      isSpecship: 1,
      resolution: null,
      displacedFiles: null,
    });

    // Row B: designer specship call — should become 'n/a'
    const idB = insertToolCall(db, {
      promptId: 'prompt-01',
      sessionId: 'sess-01',
      toolName: 'mcp__specship__designer_prompt',
      inputJson: JSON.stringify({ prompt: 'design something' }),
      resultLength: 200,
      isSpecship: 1,
      resolution: null,
      displacedFiles: null,
    });

    // Row C: non-specship Read — must be left untouched
    const idC = insertToolCall(db, {
      promptId: 'prompt-01',
      sessionId: 'sess-01',
      toolName: 'Read',
      inputJson: JSON.stringify({ file_path: '/some/file.ts' }),
      resultLength: 300,
      isSpecship: 0,
      resolution: null,
      displacedFiles: null,
    });

    // Row D: already-resolved specship row — must be left untouched
    const idD = insertToolCall(db, {
      promptId: 'prompt-01',
      sessionId: 'sess-01',
      toolName: 'mcp__specship__specship_node',
      inputJson: JSON.stringify({ symbol: 'alpha' }),
      resultLength: 400,
      isSpecship: 1,
      resolution: 'resolved',
      displacedFiles: JSON.stringify([['/proj/a.ts', 1024]]),
    });

    // Run backfill with a stub graph resolver
    backfillDisplaced(db as any, (projectPath: string) => {
      if (projectPath === PROJECT_PATH) return makeGraph();
      return null;
    });

    type Row = {
      id: number;
      tool_name: string;
      is_specship: number;
      resolution: string | null;
      displaced_files: string | null;
    };

    const rows = db.prepare('SELECT id, tool_name, is_specship, resolution, displaced_files FROM claude_tool_calls ORDER BY id').all() as Row[];

    // Row A: specship_node with 'alpha' → resolved + displaced_files set
    const rowA = rows.find(r => r.id === idA)!;
    expect(rowA.resolution).toBe('resolved');
    expect(rowA.displaced_files).not.toBeNull();
    const displaced = JSON.parse(rowA.displaced_files!);
    expect(displaced.length).toBeGreaterThan(0);
    expect(displaced[0]).toHaveLength(2); // [path, size]

    // Row B: designer tool → n/a
    const rowB = rows.find(r => r.id === idB)!;
    expect(rowB.resolution).toBe('n/a');
    // displaced_files for n/a is null (no files)
    expect(rowB.displaced_files).toBeNull();

    // Row C: non-specship Read → unchanged (resolution still null)
    const rowC = rows.find(r => r.id === idC)!;
    expect(rowC.resolution).toBeNull();
    expect(rowC.displaced_files).toBeNull();

    // Row D: already-resolved → unchanged
    const rowD = rows.find(r => r.id === idD)!;
    expect(rowD.resolution).toBe('resolved');
    expect(JSON.parse(rowD.displaced_files!)).toEqual([['/proj/a.ts', 1024]]);
  });

  it('is idempotent — second call is a no-op', () => {
    const db = openMemoryDb();
    buildSchema(db);

    insertSession(db, 'sess-02', '/proj/beta');
    insertPrompt(db, 'prompt-02', 'sess-02');

    const id = insertToolCall(db, {
      promptId: 'prompt-02',
      sessionId: 'sess-02',
      toolName: 'mcp__specship__specship_node',
      inputJson: JSON.stringify({ symbol: 'alpha' }),
      resultLength: 600,
      isSpecship: 1,
      resolution: null,
      displacedFiles: null,
    });

    const graph = makeGraph();
    const resolveGraph = (_p: string) => graph;

    // First run — fills the row.
    backfillDisplaced(db as any, resolveGraph);

    type Row = { id: number; resolution: string | null; displaced_files: string | null };
    const after1 = db.prepare('SELECT id, resolution, displaced_files FROM claude_tool_calls WHERE id = ?').get(id) as Row;
    expect(after1.resolution).not.toBeNull();

    // Second run — finds nothing left with resolution IS NULL AND is_specship=1.
    // Record what estimateReadEquivalent call count would be via a spy wrapper.
    let searchCallCount = 0;
    const spyGraph: GraphLike = {
      estimateReadEquivalent: (symbols) => { searchCallCount++; return graph.estimateReadEquivalent(symbols); },
    };

    backfillDisplaced(db as any, (_p: string) => spyGraph);

    // No rows matched → searchNodes never called.
    expect(searchCallCount).toBe(0);

    // Row unchanged.
    const after2 = db.prepare('SELECT id, resolution, displaced_files FROM claude_tool_calls WHERE id = ?').get(id) as Row;
    expect(after2.resolution).toBe(after1.resolution);
    expect(after2.displaced_files).toBe(after1.displaced_files);
  });

  it("retries a previously-'unresolved' row and upgrades it to resolved", () => {
    const db = openMemoryDb();
    buildSchema(db);
    insertSession(db, 'sess-re', '/proj/retry');
    insertPrompt(db, 'prompt-re', 'sess-re');

    // Simulates the buggy state: a source-returning call that the OLD resolver/
    // extractor left 'unresolved' (graph was null / symbols weren't extracted).
    const id = insertToolCall(db, {
      promptId: 'prompt-re',
      sessionId: 'sess-re',
      toolName: 'mcp__specship__specship_node',
      inputJson: JSON.stringify({ symbol: 'alpha' }),
      resultLength: 500,
      isSpecship: 1,
      resolution: 'unresolved',
      displacedFiles: null,
    });

    // Now the graph resolves it (fixes applied).
    backfillDisplaced(db as any, (_p: string) => makeGraph());

    type Row = { resolution: string | null; displaced_files: string | null };
    const row = db.prepare('SELECT resolution, displaced_files FROM claude_tool_calls WHERE id = ?').get(id) as Row;
    expect(row.resolution).toBe('resolved');
    expect(JSON.parse(row.displaced_files!).length).toBeGreaterThan(0);
  });

  it('handles resolveGraph returning null gracefully (classifies as unresolved)', () => {
    const db = openMemoryDb();
    buildSchema(db);

    insertSession(db, 'sess-03', '/proj/no-graph');
    insertPrompt(db, 'prompt-03', 'sess-03');

    const id = insertToolCall(db, {
      promptId: 'prompt-03',
      sessionId: 'sess-03',
      toolName: 'mcp__specship__specship_node',
      inputJson: JSON.stringify({ symbol: 'alpha' }),
      resultLength: 700,
      isSpecship: 1,
      resolution: null,
      displacedFiles: null,
    });

    backfillDisplaced(db as any, (_p: string) => null);

    type Row = { id: number; resolution: string | null };
    const row = db.prepare('SELECT id, resolution FROM claude_tool_calls WHERE id = ?').get(id) as Row;
    // With no graph, classifyToolCall returns 'unresolved'.
    expect(row.resolution).toBe('unresolved');
  });

  it('handles resolveGraph throwing without crashing', () => {
    const db = openMemoryDb();
    buildSchema(db);

    insertSession(db, 'sess-04', '/proj/throws');
    insertPrompt(db, 'prompt-04', 'sess-04');

    const id = insertToolCall(db, {
      promptId: 'prompt-04',
      sessionId: 'sess-04',
      toolName: 'mcp__specship__specship_node',
      inputJson: JSON.stringify({ symbol: 'alpha' }),
      resultLength: 800,
      isSpecship: 1,
      resolution: null,
      displacedFiles: null,
    });

    // Should not throw
    expect(() => {
      backfillDisplaced(db as any, (_p: string) => { throw new Error('graph exploded'); });
    }).not.toThrow();

    type Row = { id: number; resolution: string | null };
    const row = db.prepare('SELECT id, resolution FROM claude_tool_calls WHERE id = ?').get(id) as Row;
    // Falls back to null graph → 'unresolved'
    expect(row.resolution).toBe('unresolved');
  });
});
