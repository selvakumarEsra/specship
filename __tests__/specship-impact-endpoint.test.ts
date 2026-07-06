/**
 * Tests for computeSpecshipImpact() + GET /api/claude/specship-impact.
 *
 * Uses an in-memory SQLite DB seeded with minimal schema rows so the function
 * can be called without a real SpecShip instance.
 */

import { describe, it, expect } from 'vitest';
import { openMemoryDb } from './helpers/memory-db';
import { computeSpecshipImpact } from '../server/src/ingest/impact-query';

// ---------------------------------------------------------------------------
// Schema builder — mirrors the real schema (v9) for the tables we touch.
// ---------------------------------------------------------------------------
function buildSchema(db: ReturnType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claude_sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT,
      source_file TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      prompt_count INTEGER DEFAULT 0,
      last_model TEXT,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_creation_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS claude_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id TEXT,
      session_id TEXT,
      assistant_uuid TEXT,
      tool_use_id TEXT,
      tool_name TEXT,
      input_summary TEXT,
      input_json TEXT,
      result_length INTEGER DEFAULT 0,
      ts INTEGER,
      is_specship INTEGER NOT NULL DEFAULT 0,
      displaced_files TEXT,
      resolution TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_pricing (
      model TEXT PRIMARY KEY,
      input_per_mtok REAL,
      output_per_mtok REAL,
      cache_creation_per_mtok REAL,
      cache_read_per_mtok REAL,
      updated_at INTEGER
    );
  `);
}

// ---------------------------------------------------------------------------
// Helpers for seeding
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let promptCounter = 0;
let callCounter = 0;

function insertSession(
  db: ReturnType<typeof Database>,
  opts: {
    id?: string;
    project_path: string;
    last_model?: string;
    started_at?: number;
  },
): string {
  const id = opts.id ?? `sess-${++sessionCounter}`;
  db.prepare(`
    INSERT INTO claude_sessions (id, project_path, last_model, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, opts.project_path, opts.last_model ?? null, opts.started_at ?? Date.now(), Date.now());
  return id;
}

function insertToolCall(
  db: ReturnType<typeof Database>,
  opts: {
    session_id: string;
    prompt_id?: string;
    tool_name?: string;
    result_length?: number;
    is_specship?: 0 | 1;
    displaced_files?: Array<[string, number]> | null;
    resolution?: 'resolved' | 'unresolved' | 'n/a' | null;
    ts?: number;
  },
): void {
  const prompt_id = opts.prompt_id ?? `prompt-${++promptCounter}`;
  db.prepare(`
    INSERT INTO claude_tool_calls
      (prompt_id, session_id, tool_name, result_length, ts, is_specship, displaced_files, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    prompt_id,
    opts.session_id,
    opts.tool_name ?? 'mcp__specship__specship_node',
    opts.result_length ?? 0,
    opts.ts ?? Date.now(),
    opts.is_specship ?? 1,
    opts.displaced_files != null ? JSON.stringify(opts.displaced_files) : null,
    opts.resolution ?? null,
  );
  callCounter++;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeSpecshipImpact', () => {
  it('returns zeros for empty DB', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendTokens).toBe(0);
    expect(result.savedTokens).toBe(0);
    expect(result.totalSpecshipCalls).toBe(0);
    expect(result.unresolvedCalls).toBe(0);
    expect(result.netTokens).toBe(0);
    expect(result.byTool).toEqual([]);
    expect(result.byProject).toEqual([]);
    expect(result.trend).toEqual([]);
  });

  it('computes spendTokens from result_length of is_specship=1 rows', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/a' });
    // result_length=400 chars → 100 tokens (4 chars/token)
    insertToolCall(db, {
      session_id: sessId,
      result_length: 400,
      is_specship: 1,
      displaced_files: null,
      resolution: 'unresolved',
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendTokens).toBe(100); // ceil(400/4)
    expect(result.totalSpecshipCalls).toBe(1);
  });

  it('ignores is_specship=0 rows in spend', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/b' });
    // Non-specship call with large result — should NOT count toward spend
    insertToolCall(db, {
      session_id: sessId,
      tool_name: 'Read',
      result_length: 8000,
      is_specship: 0,
      displaced_files: null,
      resolution: null,
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendTokens).toBe(0);
    expect(result.totalSpecshipCalls).toBe(0);
  });

  it('savedTokens: single resolved call with displaced_files', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/c' });
    const pid = 'prompt-save-1';
    // displaced_files = one file of 1200 bytes, result_length = 400 chars
    // savedChars = max(0, 1200 - 400) = 800 → 200 tokens
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: pid,
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/c/a.ts', 1200]],
      resolution: 'resolved',
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendTokens).toBe(100); // 400/4
    expect(result.savedTokens).toBe(200); // ceil(800/4)
  });

  it('savedTokens: per-prompt dedup — shared file counts only once per prompt', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/d' });
    const pid = 'prompt-dedup-1';
    // TWO resolved specship calls in the same prompt, both referencing SAME file
    // File size = 2000 bytes. Should be counted ONCE.
    // Call 1: result_length=400, displaced=['/proj/d/shared.ts', 2000]
    // Call 2: result_length=200, displaced=['/proj/d/shared.ts', 2000]
    // Combined spend = 600 chars → 150 tokens
    // Union of displaced = {shared.ts: 2000} → promptReadEquivChars = 2000
    // promptSpendChars = 600
    // promptSavedChars = max(0, 2000 - 600) = 1400 → 350 tokens
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: pid,
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/d/shared.ts', 2000]],
      resolution: 'resolved',
    });
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: pid,
      result_length: 200,
      is_specship: 1,
      displaced_files: [['/proj/d/shared.ts', 2000]],
      resolution: 'resolved',
    });

    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendTokens).toBe(150); // ceil((400+200)/4)
    expect(result.savedTokens).toBe(350); // ceil(1400/4)
    expect(result.totalSpecshipCalls).toBe(2);
  });

  it('savedTokens: two prompts, same file — dedup within each prompt, sum across prompts', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/e' });
    // Prompt 1: single resolved call, file 1000 bytes, spend 200 chars
    // → saved = max(0, 1000 - 200) = 800 chars
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: 'p-e-1',
      result_length: 200,
      is_specship: 1,
      displaced_files: [['/proj/e/a.ts', 1000]],
      resolution: 'resolved',
    });
    // Prompt 2: single resolved call, same file 1000 bytes, spend 100 chars
    // → saved = max(0, 1000 - 100) = 900 chars (file dedup within THIS prompt only)
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: 'p-e-2',
      result_length: 100,
      is_specship: 1,
      displaced_files: [['/proj/e/a.ts', 1000]],
      resolution: 'resolved',
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    // spendTokens: ceil((200+100)/4) = 75
    expect(result.spendTokens).toBe(75);
    // savedTokens: ceil((800+900)/4) = ceil(1700/4) = 425
    expect(result.savedTokens).toBe(425);
  });

  it('unresolvedCalls counts resolution=unresolved rows', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/f' });
    insertToolCall(db, {
      session_id: sessId,
      result_length: 100,
      is_specship: 1,
      resolution: 'resolved',
      displaced_files: [['/proj/f/x.ts', 500]],
    });
    insertToolCall(db, {
      session_id: sessId,
      result_length: 50,
      is_specship: 1,
      resolution: 'unresolved',
      displaced_files: null,
    });
    insertToolCall(db, {
      session_id: sessId,
      result_length: 80,
      is_specship: 1,
      resolution: 'unresolved',
      displaced_files: null,
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.unresolvedCalls).toBe(2);
    expect(result.totalSpecshipCalls).toBe(3);
  });

  it('netTokens = savedTokens - spendTokens - overheadTokens', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/g' });
    const pid = 'prompt-net-1';
    // spend=400 chars=100 tokens; saved=1200 chars=300 tokens
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: pid,
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/g/a.ts', 1600]],
      resolution: 'resolved',
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    // overhead = ceil(SPECSHIP_TOOLDEF_CHARS/4) * sessions_with_specship
    // sessions_with_specship = 1
    // SPECSHIP_TOOLDEF_CHARS = 10047 (measured constant) → ceil(10047/4) = 2512 tokens per session
    expect(result.netTokens).toBe(result.savedTokens - result.spendTokens - result.overheadTokens);
    // basic sanity: saved > spend
    expect(result.savedTokens).toBeGreaterThan(result.spendTokens);
  });

  it('byTool groups spend and savedTokens per tool name (best-effort)', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/h' });
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: 'p-h-1',
      tool_name: 'mcp__specship__specship_node',
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/h/a.ts', 800]],
      resolution: 'resolved',
    });
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: 'p-h-2',
      tool_name: 'mcp__specship__specship_explore',
      result_length: 800,
      is_specship: 1,
      displaced_files: [['/proj/h/b.ts', 2000]],
      resolution: 'resolved',
    });
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.byTool.length).toBeGreaterThanOrEqual(2);
    const nodeEntry = result.byTool.find(t => t.tool === 'mcp__specship__specship_node');
    const exploreEntry = result.byTool.find(t => t.tool === 'mcp__specship__specship_explore');
    expect(nodeEntry).toBeDefined();
    expect(exploreEntry).toBeDefined();
    expect(nodeEntry!.calls).toBe(1);
    expect(nodeEntry!.spendTokens).toBe(100); // 400/4
    expect(exploreEntry!.calls).toBe(1);
    expect(exploreEntry!.spendTokens).toBe(200); // 800/4
    // saved ≥ 0 for both
    expect(nodeEntry!.savedTokens).toBeGreaterThanOrEqual(0);
    expect(exploreEntry!.savedTokens).toBeGreaterThanOrEqual(0);
  });

  it('byProject present when no project filter, absent when project is specified', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sess1 = insertSession(db, { project_path: '/proj/i1' });
    const sess2 = insertSession(db, { project_path: '/proj/i2' });
    insertToolCall(db, {
      session_id: sess1,
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/i1/a.ts', 800]],
      resolution: 'resolved',
    });
    insertToolCall(db, {
      session_id: sess2,
      result_length: 200,
      is_specship: 1,
      displaced_files: [['/proj/i2/b.ts', 600]],
      resolution: 'resolved',
    });

    // Without project filter → byProject should have 2 entries
    const allResult = computeSpecshipImpact(db as any, { since: 0 });
    expect(allResult.byProject.length).toBe(2);

    // With project filter → byProject should be empty array
    const filteredResult = computeSpecshipImpact(db as any, { since: 0, project: '/proj/i1' });
    expect(filteredResult.byProject).toEqual([]);
  });

  it('project filter scopes spend/saved to single project', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sess1 = insertSession(db, { project_path: '/proj/j1' });
    const sess2 = insertSession(db, { project_path: '/proj/j2' });
    insertToolCall(db, {
      session_id: sess1,
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/j1/a.ts', 800]],
      resolution: 'resolved',
    });
    insertToolCall(db, {
      session_id: sess2,
      result_length: 200,
      is_specship: 1,
      displaced_files: null,
      resolution: 'unresolved',
    });

    const proj1Result = computeSpecshipImpact(db as any, { since: 0, project: '/proj/j1' });
    expect(proj1Result.spendTokens).toBe(100); // only sess1 row
    expect(proj1Result.totalSpecshipCalls).toBe(1);

    const proj2Result = computeSpecshipImpact(db as any, { since: 0, project: '/proj/j2' });
    expect(proj2Result.spendTokens).toBe(50); // only sess2 row
    expect(proj2Result.unresolvedCalls).toBe(1);
  });

  it('trend: daily buckets have spendTokens and savedTokens', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/k' });
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const todayStart = Math.floor(now / dayMs) * dayMs;
    const yesterdayStart = todayStart - dayMs;

    // One call today
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: 'p-k-today',
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/k/a.ts', 800]],
      resolution: 'resolved',
      ts: todayStart + 1000,
    });
    // One call yesterday
    insertToolCall(db, {
      session_id: sessId,
      prompt_id: 'p-k-yesterday',
      result_length: 200,
      is_specship: 1,
      displaced_files: null,
      resolution: 'unresolved',
      ts: yesterdayStart + 1000,
    });

    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.trend.length).toBe(2); // two distinct days
    const sortedTrend = [...result.trend].sort((a, b) => a.ts - b.ts);
    // Yesterday's bucket
    const yday = sortedTrend[0];
    expect(yday.spendTokens).toBe(50); // 200/4
    expect(yday.savedTokens).toBe(0);  // unresolved
    // Today's bucket
    const tod = sortedTrend[1];
    expect(tod.spendTokens).toBe(100); // 400/4
    expect(tod.savedTokens).toBe(100); // max(0, 800-400)/4 = 400/4
  });

  it('since filter excludes old rows', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/l' });
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const oldTs = now - 10 * dayMs;

    insertToolCall(db, {
      session_id: sessId,
      result_length: 400,
      is_specship: 1,
      resolution: 'unresolved',
      ts: oldTs,
    });

    // since=now means old row is excluded
    const result = computeSpecshipImpact(db as any, { since: now });
    expect(result.totalSpecshipCalls).toBe(0);
    expect(result.spendTokens).toBe(0);
  });

  it('costUsd: >=0 always; 0 when no pricing rows present', () => {
    const db = openMemoryDb();
    buildSchema(db);
    const sessId = insertSession(db, { project_path: '/proj/m', last_model: 'claude-sonnet-4' });
    insertToolCall(db, {
      session_id: sessId,
      result_length: 4000,
      is_specship: 1,
      displaced_files: [['/proj/m/a.ts', 8000]],
      resolution: 'resolved',
    });

    // No pricing rows seeded → cost should be 0
    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendCostUsd).toBe(0);
    expect(result.savedCostUsd).toBe(0);
    expect(result.netCostUsd).toBeGreaterThanOrEqual(-(result.spendCostUsd));
  });

  it('costUsd: positive when pricing rows are seeded', () => {
    const db = openMemoryDb();
    buildSchema(db);
    // Seed pricing
    db.prepare(`
      INSERT INTO claude_pricing (model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok, updated_at)
      VALUES ('claude-sonnet-4', 3.0, 15.0, 3.75, 0.3, ?)
    `).run(Date.now());

    const sessId = insertSession(db, { project_path: '/proj/n', last_model: 'claude-sonnet-4' });
    insertToolCall(db, {
      session_id: sessId,
      result_length: 4000, // 1000 tokens spend
      is_specship: 1,
      displaced_files: [['/proj/n/a.ts', 12000]], // 3000 tokens equiv
      resolution: 'resolved',
      prompt_id: 'p-n-1',
    });

    const result = computeSpecshipImpact(db as any, { since: 0 });
    expect(result.spendCostUsd).toBeGreaterThan(0);
    expect(result.savedCostUsd).toBeGreaterThan(0);
    // spendTokens = ceil(4000/4) = 1000 tokens; cost = 1000 * $3/1M = $0.003
    expect(result.spendCostUsd).toBeCloseTo(0.003, 6);
    // savedTokens = ceil(max(0, 12000-4000)/4) = ceil(8000/4) = 2000 tokens → $0.006
    expect(result.savedCostUsd).toBeCloseTo(0.006, 6);
  });

  it('overheadTokens: ceil(TOOLDEF_CHARS/4) * distinct_sessions_with_specship_calls', () => {
    const db = openMemoryDb();
    buildSchema(db);
    // Two sessions, both with specship calls
    const sess1 = insertSession(db, { project_path: '/proj/o1' });
    const sess2 = insertSession(db, { project_path: '/proj/o2' });
    insertToolCall(db, { session_id: sess1, result_length: 100, is_specship: 1, resolution: 'unresolved' });
    insertToolCall(db, { session_id: sess2, result_length: 100, is_specship: 1, resolution: 'unresolved' });

    const result = computeSpecshipImpact(db as any, { since: 0 });
    // overheadTokens should be overhead_per_session * 2
    expect(result.overheadTokens).toBeGreaterThan(0);
    // 2 sessions: overhead must be exactly 2× single-session overhead
    const singleSess = computeSpecshipImpact(db as any, { since: 0, project: '/proj/o1' });
    expect(result.overheadTokens).toBe(singleSess.overheadTokens * 2);
  });

  // ---------------------------------------------------------------------------
  // Task 7: sessionId filter
  // ---------------------------------------------------------------------------

  it('sessionId filter scopes spend/saved to a single session, ignoring other sessions', () => {
    const db = openMemoryDb();
    buildSchema(db);

    // Two sessions with different specship activity
    const sess1 = insertSession(db, { id: 'task7-sess-1', project_path: '/proj/t7a' });
    const sess2 = insertSession(db, { id: 'task7-sess-2', project_path: '/proj/t7a' });

    // Session 1: one resolved call, displaced file 2000 bytes, spend 400 chars
    insertToolCall(db, {
      session_id: sess1,
      prompt_id: 'p-t7-1',
      result_length: 400,
      is_specship: 1,
      displaced_files: [['/proj/t7a/foo.ts', 2000]],
      resolution: 'resolved',
    });

    // Session 2: one unresolved call, different size
    insertToolCall(db, {
      session_id: sess2,
      prompt_id: 'p-t7-2',
      result_length: 800,
      is_specship: 1,
      displaced_files: null,
      resolution: 'unresolved',
    });

    // Filter to session 1 only
    const s1Result = computeSpecshipImpact(db as any, { since: 0, sessionId: 'task7-sess-1' });
    expect(s1Result.spendTokens).toBe(100);      // ceil(400/4)
    expect(s1Result.totalSpecshipCalls).toBe(1);
    expect(s1Result.unresolvedCalls).toBe(0);
    // saved = max(0, 2000-400)/4 = 400 tokens
    expect(s1Result.savedTokens).toBe(400);

    // Filter to session 2 only
    const s2Result = computeSpecshipImpact(db as any, { since: 0, sessionId: 'task7-sess-2' });
    expect(s2Result.spendTokens).toBe(200);      // ceil(800/4)
    expect(s2Result.totalSpecshipCalls).toBe(1);
    expect(s2Result.unresolvedCalls).toBe(1);
    expect(s2Result.savedTokens).toBe(0);        // unresolved, no displaced files

    // Global (no filter) sees both
    const allResult = computeSpecshipImpact(db as any, { since: 0 });
    expect(allResult.totalSpecshipCalls).toBe(2);
    expect(allResult.spendTokens).toBe(300);     // 100+200
  });

  it('sessionId filter: session with no specship calls returns zeros', () => {
    const db = openMemoryDb();
    buildSchema(db);

    const sess = insertSession(db, { id: 'task7-empty', project_path: '/proj/t7b' });
    // Only a non-specship Read call
    insertToolCall(db, {
      session_id: sess,
      tool_name: 'Read',
      result_length: 5000,
      is_specship: 0,
      displaced_files: null,
      resolution: null,
    });

    const result = computeSpecshipImpact(db as any, { since: 0, sessionId: 'task7-empty' });
    expect(result.spendTokens).toBe(0);
    expect(result.savedTokens).toBe(0);
    expect(result.totalSpecshipCalls).toBe(0);
    expect(result.netTokens).toBe(0);
  });

  it('sessionId filter does not leak rows from other sessions', () => {
    const db = openMemoryDb();
    buildSchema(db);

    // Three sessions; we query only the middle one
    const sessA = insertSession(db, { id: 'task7-leak-A', project_path: '/proj/t7c' });
    const sessB = insertSession(db, { id: 'task7-leak-B', project_path: '/proj/t7c' });
    const sessC = insertSession(db, { id: 'task7-leak-C', project_path: '/proj/t7c' });

    // Seeding same project so a project filter would include all three
    insertToolCall(db, { session_id: sessA, result_length: 400, is_specship: 1, resolution: 'unresolved' });
    insertToolCall(db, { session_id: sessB, result_length: 200, is_specship: 1, resolution: 'unresolved' });
    insertToolCall(db, { session_id: sessC, result_length: 100, is_specship: 1, resolution: 'unresolved' });

    // Querying sessB must return only sessB's 200-char spend (50 tokens)
    const result = computeSpecshipImpact(db as any, { since: 0, sessionId: 'task7-leak-B' });
    expect(result.spendTokens).toBe(50);
    expect(result.totalSpecshipCalls).toBe(1);
  });
});
