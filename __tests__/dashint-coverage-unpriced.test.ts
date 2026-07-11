import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openMemoryDb } from './helpers/memory-db';
import { ingestAll, getLastIngestStats } from '../server/src/ingest/ingestor';
import type { IngestDb } from '../server/src/ingest/ingestor';

/**
 * REQ-DASHINT-007 / REQ-DASHINT-008 (specs/dashboard-data-integrity.md):
 * unpriced usage is detectable (never a confident $0), and every ingest pass
 * counts the lines it could not parse instead of swallowing them.
 */

function buildSchema(db: IngestDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claude_projects (
      path TEXT PRIMARY KEY, name TEXT, first_seen INTEGER, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS claude_sessions (
      id TEXT PRIMARY KEY, project_path TEXT, source_file TEXT,
      started_at INTEGER, ended_at INTEGER, prompt_count INTEGER DEFAULT 0,
      last_model TEXT,
      total_input_tokens INTEGER DEFAULT 0, total_output_tokens INTEGER DEFAULT 0,
      total_cache_creation_tokens INTEGER DEFAULT 0, total_cache_read_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS claude_prompts (
      id TEXT PRIMARY KEY, session_id TEXT, text TEXT, ts INTEGER, leaf_uuid TEXT,
      model TEXT, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0, is_sidechain INTEGER DEFAULT 0,
      assistant_text TEXT, thinking_text TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, prompt_id TEXT, session_id TEXT,
      assistant_uuid TEXT, tool_use_id TEXT, tool_name TEXT, input_summary TEXT,
      input_json TEXT, result_length INTEGER DEFAULT 0, ts INTEGER,
      is_specship INTEGER NOT NULL DEFAULT 0, displaced_files TEXT, resolution TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_ingest_state (
      file_path TEXT PRIMARY KEY, last_offset INTEGER, last_ingested_at INTEGER,
      file_size INTEGER, session_id TEXT
    );
    CREATE TABLE IF NOT EXISTS claude_pricing (
      model TEXT PRIMARY KEY, input_per_mtok REAL, output_per_mtok REAL,
      cache_creation_per_mtok REAL, cache_read_per_mtok REAL, updated_at INTEGER
    );
  `);
}

/** A transcript with one prompt answered by `model`, plus optional garbage lines. */
function writeTranscript(root: string, sessionId: string, model: string, garbageLines: string[] = []): void {
  const ts = new Date().toISOString();
  const promptId = `prompt-${sessionId}`;
  const lines = [
    JSON.stringify({
      type: 'user', sessionId, uuid: `u-${sessionId}`, promptId, timestamp: ts,
      message: { content: [{ type: 'text', text: 'hello' }] },
    }),
    ...garbageLines,
    JSON.stringify({
      type: 'assistant', sessionId, uuid: `a-${sessionId}`, promptId, timestamp: ts,
      message: {
        model,
        usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        content: [{ type: 'text', text: 'hi' }],
      },
    }),
  ];
  const slugDir = path.join(root, '-tmp-dashint-test');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');
}

/** The same derivation the /api/claude/sessions route uses. */
const UNPRICED_SQL = `
  SELECT id,
    CASE WHEN total_cost_usd = 0
              AND (total_input_tokens + total_output_tokens + total_cache_creation_tokens + total_cache_read_tokens) > 0
         THEN (total_input_tokens + total_output_tokens + total_cache_creation_tokens + total_cache_read_tokens)
         ELSE 0 END AS unpriced_tokens
  FROM claude_sessions WHERE id = ?
`;

describe('ingest parse coverage + unpriced detection (REQ-DASHINT-007/008)', () => {
  let tmp: string;
  let db: IngestDb;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashint-'));
    db = openMemoryDb() as unknown as IngestDb;
    buildSchema(db);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('008.A1: counts non-empty unparseable lines as skipped without failing the file', () => {
    writeTranscript(tmp, 's-cov', 'claude-sonnet-4-6', [
      'this is not json at all',
      '{"no_type_field": true}',
      '', // blank — not an event, must NOT count as skipped
    ]);
    const stats = ingestAll(db, { claudeRoot: tmp });
    expect(stats.errors).toBe(0);
    expect(stats.linesSkipped).toBe(2);
    // parsed excludes the skipped lines (blank line still consumed as a line).
    expect(stats.promptsInserted).toBe(1);
  });

  it('008.A2: the latest pass stats are queryable (zero skips = full coverage, stat still present)', () => {
    writeTranscript(tmp, 's-clean', 'claude-sonnet-4-6');
    ingestAll(db, { claudeRoot: tmp });
    const last = getLastIngestStats();
    expect(last).not.toBeNull();
    expect(last!.linesSkipped).toBe(0);
    expect(last!.linesParsed).toBeGreaterThan(0);
    expect(last!.at).toBeGreaterThan(0);
  });

  it('007.A1: a session on an unpriced model derives non-zero unpriced_tokens', () => {
    writeTranscript(tmp, 's-unpriced', 'claude-quasar-9'); // no pricing row, no family
    ingestAll(db, { claudeRoot: tmp });
    const row = db.prepare(UNPRICED_SQL).get('s-unpriced') as { unpriced_tokens: number };
    expect(row.unpriced_tokens).toBe(1500); // 1000 in + 500 out, cost stayed 0
  });

  it('007: a priced session derives unpriced_tokens = 0 (marker never shows on real costs)', () => {
    writeTranscript(tmp, 's-priced', 'claude-sonnet-4-6'); // seeded default pricing resolves
    ingestAll(db, { claudeRoot: tmp });
    const row = db.prepare(UNPRICED_SQL).get('s-priced') as { unpriced_tokens: number };
    expect(row.unpriced_tokens).toBe(0);
  });
});
