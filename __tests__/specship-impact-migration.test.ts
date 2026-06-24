import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../src/db/migrations';

describe('v9 specship-impact migration', () => {
  it('adds columns and backfills is_specship from tool_name', () => {
    const db = new Database(':memory:');
    // minimal prerequisite tables (schema_versions is required — runMigrations -> recordMigration INSERTs into it)
    // unresolved_refs + edges: required by migration v2 (ALTER TABLE ... ADD COLUMN)
    // claude_sessions: required by migration v8 (UPDATE claude_sessions SET prompt_count = ...)
    db.exec(`
      CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER, description TEXT);
      CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, qualified_name TEXT);
      CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY, from_node_id TEXT, reference_name TEXT, reference_kind TEXT, line INTEGER, col INTEGER, candidates TEXT);
      CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, kind TEXT);
      CREATE TABLE claude_sessions (id TEXT PRIMARY KEY, project_path TEXT, started_at INTEGER, prompt_count INTEGER DEFAULT 0);
      CREATE TABLE claude_prompts (id TEXT PRIMARY KEY, session_id TEXT, ts INTEGER, is_sidechain INTEGER DEFAULT 0);
      CREATE TABLE claude_tool_calls (id INTEGER PRIMARY KEY, prompt_id TEXT, session_id TEXT, tool_name TEXT, result_length INTEGER DEFAULT 0);
    `);
    db.exec(`INSERT INTO claude_tool_calls (tool_name) VALUES
             ('mcp__specship__specship_explore'), ('Read'), ('mcp__specship__designer_session');`);
    runMigrations(db as any, 0); // fromVersion=0 -> applies ALL migrations up to CURRENT_SCHEMA_VERSION
    const cols = db.prepare(`PRAGMA table_info(claude_tool_calls)`).all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['is_specship', 'displaced_files', 'resolution']));
    const flags = db.prepare(`SELECT tool_name, is_specship FROM claude_tool_calls ORDER BY id`).all();
    expect(flags).toEqual([
      { tool_name: 'mcp__specship__specship_explore', is_specship: 1 },
      { tool_name: 'Read', is_specship: 0 },
      { tool_name: 'mcp__specship__designer_session', is_specship: 1 },
    ]);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
  });
});
