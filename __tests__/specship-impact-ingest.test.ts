import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { ingestAll } from '../packages/server/src/ingest/ingestor';
import SpecShip from '../src/index';

// ---------------------------------------------------------------------------
// Minimal smoke-test: cross-package import
// ---------------------------------------------------------------------------
it('cross-package import resolves', () => { expect(typeof ingestAll).toBe('function'); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the minimal schema the ingestor needs. */
function buildSchema(db: ReturnType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_projects (
      path TEXT PRIMARY KEY,
      name TEXT,
      first_seen INTEGER,
      last_seen INTEGER
    );
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
    CREATE TABLE IF NOT EXISTS claude_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      text TEXT,
      ts INTEGER,
      leaf_uuid TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      is_sidechain INTEGER DEFAULT 0,
      assistant_text TEXT,
      thinking_text TEXT
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
    CREATE TABLE IF NOT EXISTS claude_ingest_state (
      file_path TEXT PRIMARY KEY,
      last_offset INTEGER,
      last_ingested_at INTEGER,
      file_size INTEGER,
      session_id TEXT
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

/**
 * Write a synthetic Claude JSONL transcript.
 * The JSONL format: each line is one JSON object with `type` field.
 *
 * For a user prompt + assistant turn with a specship_node tool call:
 *   1. user entry (the prompt)
 *   2. assistant entry (tool_use block)
 *   3. user entry (tool_result block — same promptId)
 */
function writeTranscript(dir: string, sessionId: string, promptId: string): string {
  const ts = new Date().toISOString();
  const toolUseId = 'toolu_specship01';
  const readToolUseId = 'toolu_read01';
  const assistantUuid = 'asst-uuid-01';

  const lines = [
    // 1. User prompt (initial)
    JSON.stringify({
      type: 'user',
      sessionId,
      uuid: 'user-uuid-01',
      promptId,
      timestamp: ts,
      message: {
        content: [{ type: 'text', text: 'How does alpha work?' }],
      },
    }),
    // 2. Assistant turn — two tool_use blocks: specship_node and Read
    JSON.stringify({
      type: 'assistant',
      sessionId,
      uuid: assistantUuid,
      promptId,
      timestamp: ts,
      message: {
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'mcp__specship__specship_node',
            input: { symbol: 'alpha' },
          },
          {
            type: 'tool_use',
            id: readToolUseId,
            name: 'Read',
            input: { file_path: '/some/file.ts' },
          },
        ],
      },
    }),
    // 3. User follow-up — tool_result blocks (same promptId)
    JSON.stringify({
      type: 'user',
      sessionId,
      uuid: 'user-uuid-02',
      promptId,
      timestamp: ts,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: 'export function alpha() { return 1; }  // 40 chars of source result',
          },
          {
            type: 'tool_result',
            tool_use_id: readToolUseId,
            content: 'content of /some/file.ts here',
          },
        ],
      },
    }),
  ];

  const projectSlug = '-tmp-specship-ingest-test';
  const slugDir = path.join(dir, projectSlug);
  fs.mkdirSync(slugDir, { recursive: true });
  const jsonlPath = path.join(slugDir, `${sessionId}.jsonl`);
  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
  return dir; // claudeRoot = dir
}

// ---------------------------------------------------------------------------
// Temp dir management
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('ingestAll + classifyToolCall integration', () => {
  it('resolved specship_node row has is_specship=1, resolution=resolved, displaced_files set', async () => {
    // 1. Build a tiny project with a symbol 'alpha' and index it.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ingest-proj-'));
    tmpDirs.push(projectDir);
    fs.writeFileSync(path.join(projectDir, 'a.ts'), 'export function alpha(){ return 1 }\n'.repeat(20));
    const ss = await SpecShip.init(projectDir);
    await ss.indexAll();

    // 2. Build the claude transcript root + JSONL.
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ingest-root-'));
    tmpDirs.push(claudeRoot);
    const sessionId = 'sess-integration-01';
    const promptId = 'prompt-integration-01';
    writeTranscript(claudeRoot, sessionId, promptId);

    // 3. Build a minimal DB with the required schema.
    const db = new Database(':memory:');
    buildSchema(db);

    // 4. Run ingestAll with the graph resolver.
    ingestAll(db as any, {
      claudeRoot,
      resolveGraph: (_projectPath: string) => ss,
    });

    // 5. Assert specship_node row.
    const calls = db.prepare(`
      SELECT tool_name, is_specship, resolution, displaced_files, result_length
      FROM claude_tool_calls
      ORDER BY id
    `).all() as Array<{
      tool_name: string;
      is_specship: number;
      resolution: string | null;
      displaced_files: string | null;
      result_length: number;
    }>;

    expect(calls).toHaveLength(2);

    const nodeCall = calls.find(c => c.tool_name === 'mcp__specship__specship_node');
    expect(nodeCall).toBeDefined();
    expect(nodeCall!.is_specship).toBe(1);
    expect(nodeCall!.resolution).toBe('resolved');
    expect(nodeCall!.displaced_files).not.toBeNull();
    const displaced = JSON.parse(nodeCall!.displaced_files!);
    expect(displaced.length).toBeGreaterThan(0); // at least one file (a.ts)
    expect(displaced[0]).toHaveLength(2);         // [path, size]

    // 6. Assert Read row.
    const readCall = calls.find(c => c.tool_name === 'Read');
    expect(readCall).toBeDefined();
    expect(readCall!.is_specship).toBe(0);
    expect(readCall!.resolution).toBeNull();
    expect(readCall!.displaced_files).toBeNull();

    ss.close();
  });

  it('specship_node with resolveGraph:()=>null → resolution=unresolved, displaced_files=null', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ingest-proj2-'));
    tmpDirs.push(projectDir);
    fs.writeFileSync(path.join(projectDir, 'b.ts'), 'export function beta(){ return 2 }\n');

    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ingest-root2-'));
    tmpDirs.push(claudeRoot);
    const sessionId = 'sess-integration-02';
    const promptId = 'prompt-integration-02';
    writeTranscript(claudeRoot, sessionId, promptId);

    const db = new Database(':memory:');
    buildSchema(db);

    // Pass null graph → should classify as unresolved.
    ingestAll(db as any, {
      claudeRoot,
      resolveGraph: () => null,
    });

    const calls = db.prepare(`
      SELECT tool_name, is_specship, resolution, displaced_files
      FROM claude_tool_calls
    `).all() as Array<{
      tool_name: string;
      is_specship: number;
      resolution: string | null;
      displaced_files: string | null;
    }>;

    const nodeCall = calls.find(c => c.tool_name === 'mcp__specship__specship_node');
    expect(nodeCall).toBeDefined();
    expect(nodeCall!.is_specship).toBe(1);
    expect(nodeCall!.resolution).toBe('unresolved');
    expect(nodeCall!.displaced_files).toBeNull();
  });

  it('specship_node with unknown symbol → resolution=unresolved even with live graph', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ingest-proj3-'));
    tmpDirs.push(projectDir);
    // Write a file with a DIFFERENT symbol — 'alpha' won't resolve.
    fs.writeFileSync(path.join(projectDir, 'c.ts'), 'export function gamma(){ return 3 }\n'.repeat(10));
    const ss = await SpecShip.init(projectDir);
    await ss.indexAll();

    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ingest-root3-'));
    tmpDirs.push(claudeRoot);
    const sessionId = 'sess-integration-03';
    const promptId = 'prompt-integration-03';
    // The transcript requests 'alpha', which doesn't exist in this project.
    writeTranscript(claudeRoot, sessionId, promptId);

    const db = new Database(':memory:');
    buildSchema(db);

    ingestAll(db as any, {
      claudeRoot,
      resolveGraph: () => ss,
    });

    const calls = db.prepare(`
      SELECT tool_name, is_specship, resolution, displaced_files
      FROM claude_tool_calls
    `).all() as Array<{
      tool_name: string;
      is_specship: number;
      resolution: string | null;
      displaced_files: string | null;
    }>;

    const nodeCall = calls.find(c => c.tool_name === 'mcp__specship__specship_node');
    expect(nodeCall).toBeDefined();
    expect(nodeCall!.is_specship).toBe(1);
    expect(nodeCall!.resolution).toBe('unresolved');
    expect(nodeCall!.displaced_files).toBeNull();

    ss.close();
  });
});
