/**
 * REQ-AGENTSWITCH-004 (specs/agent-switch.md): session data is read through
 * one transcript adapter per agent, each normalising its tool names to the
 * shared set before anything counts them.
 *
 * Real files and real SQLite (the shipped schema.sql) — no DB mocking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openMemoryDb } from './helpers/memory-db';
import { ingestAll, getLastIngestStats, resolveIngestRoots } from '../server/src/ingest/ingestor';
import type { IngestDb } from '../server/src/ingest/ingestor';
import { classifyToolCall } from '../server/src/ingest/specship-classify';
import {
  geminiProjectHash,
  normalizeGeminiToolName,
  parseGeminiSession,
} from '../server/src/ingest/transcripts/index';
import { CANONICAL_TOOLS as SERVER_TOOLS, specshipToolPrefix as SERVER_SHARED_PREFIX } from '../server/src/canonical-tools';
import { CANONICAL_TOOLS, specshipToolPrefix } from '../src/analytics/canonical-tools';
import { sessionsTouchingFiles } from '../src/reflect/session-outcomes';
import type { SqliteDatabase } from '../src/db/sqlite-adapter';
import { runMigrations, getCurrentVersion } from '../src/db/migrations';

const FIXTURES = path.join(__dirname, 'fixtures', 'transcripts');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf-8');

let tmp: string;
let db: IngestDb;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-adapters-'));
  db = openMemoryDb() as unknown as IngestDb;
  db.exec(SCHEMA);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Lay a Gemini session out as `<root>/<sha256(project)>/chats/session-….json`. */
function writeGeminiSession(projectRoot: string, body: string): { root: string; file: string } {
  const root = path.join(tmp, 'gemini-tmp');
  const chats = path.join(root, geminiProjectHash(projectRoot), 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const file = path.join(chats, 'session-2026-11-02T09-00-9f3c2a1b.json');
  fs.writeFileSync(file, body, 'utf-8');
  return { root, file };
}

const rowCount = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function reqAgentswitch004A1(): void {
  const project = '/tmp/a1-project';
  const { root } = writeGeminiSession(project, fs.readFileSync(path.join(FIXTURES, 'gemini-session.json'), 'utf-8'));

  const stats = ingestAll(db, { roots: { gemini: root }, projectPaths: [project] });
  expect(stats.errors).toBe(0);
  expect(stats.filesUnreadable).toBe(0);

  // Tool names are normalised to the shared set before anything counts them.
  const rows = db
    .prepare(`SELECT tool_name, raw_tool_name, host, is_specship, result_length FROM claude_tool_calls ORDER BY tool_use_id`)
    .all() as Array<{ tool_name: string; raw_tool_name: string; host: string; is_specship: number; result_length: number }>;
  expect(rows.map((r) => [r.raw_tool_name, r.tool_name])).toEqual([
    ['specship_explore', `${specshipToolPrefix}specship_explore`],
    ['specship_explore', `${specshipToolPrefix}specship_explore`],
    ['read_file', CANONICAL_TOOLS.read],
  ]);
  expect(rows.every((r) => r.host === 'gemini')).toBe(true);
  expect(rows.every((r) => r.result_length > 0)).toBe(true);

  // Two SpecShip calls and one file read — by the classifier and by the counts.
  const specshipByClassifier = rows.filter(
    (r) => classifyToolCall({ toolName: r.tool_name, inputJson: null, resultLength: r.result_length }, null).isSpecship === 1,
  ).length;
  expect(specshipByClassifier).toBe(2);
  expect((db.prepare(`SELECT COUNT(*) AS n FROM claude_tool_calls WHERE is_specship = 1`).get() as { n: number }).n).toBe(2);
  expect((db.prepare(`SELECT COUNT(*) AS n FROM claude_tool_calls WHERE tool_name = ?`).get(CANONICAL_TOOLS.read) as { n: number }).n).toBe(1);

  // The session resolves to the real project path via the Gemini project hash.
  const session = db.prepare(`SELECT project_path, host, prompt_count, last_model FROM claude_sessions`).get() as {
    project_path: string; host: string; prompt_count: number; last_model: string;
  };
  expect(session).toEqual({ project_path: project, host: 'gemini', prompt_count: 1, last_model: 'gemini-3.5-flash' });
}

function reqAgentswitch004A2(): void {
  const before = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'claude-session.snapshot.json'), 'utf-8'));
  const slugDir = path.join(tmp, '-tmp-a2-project');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'claude-session.jsonl'), path.join(slugDir, 'sess-claude-a2.jsonl'));

  const stats = ingestAll(db, { claudeRoot: tmp });
  // The same projection the pre-change snapshot was taken with (commit "taken before the adapter change").
  const after = {
    stats: {
      filesScanned: stats.filesScanned, linesParsed: stats.linesParsed, linesSkipped: stats.linesSkipped,
      promptsInserted: stats.promptsInserted, toolCallsInserted: stats.toolCallsInserted, errors: stats.errors,
    },
    sessions: db.prepare(`SELECT id, project_path, prompt_count, total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens, round(total_cost_usd, 9) AS total_cost_usd, last_model FROM claude_sessions ORDER BY id`).all(),
    prompts: db.prepare(`SELECT id, text, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, round(cost_usd, 9) AS cost_usd, assistant_text, thinking_text FROM claude_prompts ORDER BY id`).all(),
    toolCalls: db.prepare(`SELECT prompt_id, tool_use_id, tool_name, input_summary, input_json, result_length, is_specship, displaced_files, resolution FROM claude_tool_calls ORDER BY tool_use_id`).all(),
    counts: db.prepare(`SELECT tool_name, COUNT(*) AS n FROM claude_tool_calls GROUP BY tool_name ORDER BY tool_name`).all(),
  };
  expect(JSON.parse(JSON.stringify(after))).toEqual(before);

  // Claude rows are tagged with their agent; the raw name equals the shared one.
  const tagged = db.prepare(`SELECT DISTINCT host FROM claude_tool_calls WHERE raw_tool_name = tool_name`).all() as Array<{ host: string }>;
  expect(tagged).toEqual([{ host: 'claude' }]);
}

function reqAgentswitch004A3(): void {
  const whole = fs.readFileSync(path.join(FIXTURES, 'gemini-session.json'), 'utf-8');
  const { root, file } = writeGeminiSession('/tmp/a3-project', whole.slice(0, Math.floor(whole.length / 2)));

  const stats = ingestAll(db, { roots: { gemini: root }, projectPaths: ['/tmp/a3-project'] });
  expect(stats.filesScanned).toBe(1);
  expect(stats.filesUnreadable).toBe(1);
  expect(stats.errors).toBe(0);
  // Skipped, never guessed at: nothing is written for it.
  for (const t of ['claude_sessions', 'claude_prompts', 'claude_tool_calls', 'claude_ingest_state']) {
    expect(rowCount(t)).toBe(0);
  }
  // The skip count is reported where the dashboard reads parse coverage.
  expect(getLastIngestStats()?.filesUnreadable).toBe(1);

  // A document without a messages array is unreadable too; a repaired file then ingests.
  fs.writeFileSync(file, JSON.stringify({ sessionId: 'x' }), 'utf-8');
  expect(ingestAll(db, { roots: { gemini: root } }).filesUnreadable).toBe(1);
  fs.writeFileSync(file, whole, 'utf-8');
  const repaired = ingestAll(db, { roots: { gemini: root } });
  expect(repaired.filesUnreadable).toBe(0);
  expect(rowCount('claude_tool_calls')).toBe(3);
}

describe('REQ-AGENTSWITCH-004 — per-agent transcript adapters', () => {
  it('REQ-AGENTSWITCH-004.A1 — a Gemini session with two specship_explore calls and one read_file counts as two SpecShip calls and one file read', reqAgentswitch004A1);
  it('REQ-AGENTSWITCH-004.A2 — Claude session counts for an unchanged fixture match the pre-change snapshot', reqAgentswitch004A2);
  it('REQ-AGENTSWITCH-004.A3 — an unparseable transcript file is skipped and the skip count is reported', reqAgentswitch004A3);

  it('re-ingesting a rewritten Gemini document replaces its rows instead of duplicating them', () => {
    const project = '/tmp/rewrite-project';
    const whole = fs.readFileSync(path.join(FIXTURES, 'gemini-session.json'), 'utf-8');
    const { root, file } = writeGeminiSession(project, whole);
    ingestAll(db, { roots: { gemini: root }, projectPaths: [project] });
    // Unchanged → skipped.
    expect(ingestAll(db, { roots: { gemini: root }, projectPaths: [project] }).filesSkipped).toBe(1);
    // Rewritten with one more tool call → exactly one more row.
    const doc = JSON.parse(whole);
    doc.messages[3].toolCalls = [{ id: 'tc-4', name: 'replace', args: { file_path: '/tmp/rewrite-project/src/scene.ts' }, result: null }];
    fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf-8');
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(file, future, future);
    ingestAll(db, { roots: { gemini: root }, projectPaths: [project] });
    expect(rowCount('claude_tool_calls')).toBe(4);
    expect(rowCount('claude_prompts')).toBe(1);
    // The explore "prior work" lookup sees the Gemini edit through the shared name.
    const ids = sessionsTouchingFiles(db as unknown as SqliteDatabase, [project, project], ['src/scene.ts'], { excludeActiveWithinMs: 0, now: Date.now() + 60_000 });
    expect(ids).toEqual(['9f3c2a1b-gemini-a1']);
  });

  it('maps Gemini CLI 0.28.0 tool names onto the shared set', () => {
    expect(normalizeGeminiToolName('read_file')).toBe(CANONICAL_TOOLS.read);
    expect(normalizeGeminiToolName('read_many_files')).toBe(CANONICAL_TOOLS.read);
    expect(normalizeGeminiToolName('run_shell_command')).toBe(CANONICAL_TOOLS.bash);
    expect(normalizeGeminiToolName('grep_search')).toBe(CANONICAL_TOOLS.grep);
    expect(normalizeGeminiToolName('glob')).toBe(CANONICAL_TOOLS.glob);
    expect(normalizeGeminiToolName('write_file')).toBe(CANONICAL_TOOLS.write);
    expect(normalizeGeminiToolName('replace')).toBe(CANONICAL_TOOLS.edit);
    expect(normalizeGeminiToolName('specship_node')).toBe(`${specshipToolPrefix}specship_node`);
    expect(normalizeGeminiToolName('specship__specship_node')).toBe(`${specshipToolPrefix}specship_node`);
    expect(normalizeGeminiToolName('context7__query_docs')).toBe('mcp__context7__query_docs');
    expect(normalizeGeminiToolName('web_fetch')).toBe('web_fetch');
    expect(parseGeminiSession('{"sessionId":"s","messages":[]}')).not.toBeNull();
    expect(parseGeminiSession('{"sessionId":"s","messa')).toBeNull();
  });

  it('the server reads the same canonical tool-name file as the core', () => {
    expect(SERVER_TOOLS).toEqual(CANONICAL_TOOLS);
    expect(SERVER_SHARED_PREFIX).toBe(specshipToolPrefix);
  });

  it('a named root restricts the pass to that adapter (tests never read real transcripts)', () => {
    expect(resolveIngestRoots({ claudeRoot: tmp }).map((t) => t.adapter.id)).toEqual(['claude']);
    expect(resolveIngestRoots({ roots: { gemini: tmp } }).map((t) => t.adapter.id)).toEqual(['gemini']);
    expect(resolveIngestRoots({}).map((t) => t.adapter.id)).toEqual(['claude', 'gemini']);
  });
  /** Migration v12 on a database from before the change keeps every existing row as a Claude Code row. */
  function reqAgentswitch004MigratesExistingDb(): void {
    const raw = openMemoryDb();
    raw.exec(SCHEMA);
    runMigrations(raw, 0);
    // Shape the database as it was at v11: without the three v12 columns.
    raw.exec('ALTER TABLE claude_tool_calls DROP COLUMN raw_tool_name;');
    raw.exec('ALTER TABLE claude_tool_calls DROP COLUMN host;');
    raw.exec('ALTER TABLE claude_sessions DROP COLUMN host;');
    raw.exec('DELETE FROM schema_versions WHERE version >= 12;');
    expect(getCurrentVersion(raw)).toBe(11);
    // Fixture rows only: the migration is about columns, not the prompt/session relations.
    raw.exec('PRAGMA foreign_keys = OFF;');
    raw.prepare('INSERT INTO claude_sessions (id, project_path, source_file) VALUES (?, ?, ?)').run('s1', '/p', '/p/s1.jsonl');
    raw.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, result_length, ts)
                 VALUES ('p1', 's1', 'a1', 'Read', 'x.ts', 10, 1)`).run();

    runMigrations(raw, 11);
    expect(getCurrentVersion(raw)).toBe(12);
    expect(raw.prepare('SELECT host FROM claude_sessions WHERE id = ?').get('s1')).toEqual({ host: 'claude' });
    expect(raw.prepare('SELECT host, raw_tool_name, tool_name FROM claude_tool_calls').get()).toEqual({
      host: 'claude',
      raw_tool_name: null,
      tool_name: 'Read',
    });
    // Re-running is a no-op, never a duplicate-column error.
    expect(() => runMigrations(raw, getCurrentVersion(raw))).not.toThrow();
  }
  it('REQ-AGENTSWITCH-004: migration v12 upgrades an existing database without touching its rows', reqAgentswitch004MigratesExistingDb);
});
