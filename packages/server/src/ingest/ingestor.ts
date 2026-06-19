/**
 * JSONL → SQLite ingestor for Claude Code transcripts.
 *
 * Each Claude Code session lives in `~/.claude/projects/<slug>/<sessionId>.jsonl`,
 * where `<slug>` is the slash-escaped absolute path of the user's project.
 * Files are append-only (Claude Code writes one JSON line per assistant/user
 * turn), so we resume from the last byte offset on every pass — no re-parse
 * of the whole file.
 *
 * Pipeline per file:
 *   1. Read state from `claude_ingest_state` (offset, last_size). If file
 *      grew, open it and seek to offset; otherwise skip.
 *   2. Parse each line with parseLine(). Group entries by promptId.
 *   3. For each user entry: upsert claude_prompts row. For each assistant
 *      entry: aggregate usage, compute cost, accumulate tool_use blocks.
 *   4. For each tool_use block: insert into claude_tool_calls with
 *      input_summary + result_length (matched from the next user entry's
 *      tool_result content).
 *   5. Update claude_sessions aggregates (prompt_count, totals).
 *   6. Persist new offset + file_size to claude_ingest_state.
 *
 * The ingestor is idempotent — re-running on the same offset is a no-op.
 * Crash-safe — partial writes use a transaction per file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ClaudeRawEntry,
  ClaudeContentBlock,
  PricingRow,
  IngestStats,
} from './types.js';
import { computeCost, resolvePricing } from './pricing.js';
import {
  parseLine,
  toEpochMs,
  extractUserPrompt,
  summarizeToolInput,
  toolResultLength,
} from './parser.js';

/** SQLite handle shape we depend on. Matches specship's SqliteDatabase. */
export interface IngestDb {
  prepare(sql: string): {
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  exec(sql: string): void;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
}

export interface IngestOptions {
  /** Override Claude projects root. Defaults to `~/.claude/projects`. */
  claudeRoot?: string;
  /** Only re-ingest files whose mtime is newer than this many ms ago. */
  sinceMs?: number;
  /** Verbose logging. */
  verbose?: boolean;
}

/**
 * Convert Claude's slash-escaped project dir name back into a real path.
 * `~/.claude/projects/-Users-alice-projects-foo` → `/Users/alice/projects/foo`
 */
export function decodeProjectSlug(slug: string): string {
  return slug.startsWith('-') ? '/' + slug.slice(1).replace(/-/g, '/') : slug;
}

/**
 * List every JSONL file inside `<claudeRoot>/<slug>/<sessionId>.jsonl`.
 * Returns the absolute file path + the decoded project path.
 */
export function listTranscriptFiles(claudeRoot: string): Array<{ filePath: string; projectPath: string; projectSlug: string }> {
  const out: Array<{ filePath: string; projectPath: string; projectSlug: string }> = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(claudeRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(claudeRoot, p.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.isFile() && f.name.toLowerCase().endsWith('.jsonl')) {
        out.push({
          filePath: path.join(dir, f.name),
          projectPath: decodeProjectSlug(p.name),
          projectSlug: p.name,
        });
      }
    }
  }
  return out;
}

/**
 * Default Anthropic pricing tiers (USD per 1M tokens) — used to seed the
 * pricing table on first run if it's empty. Keeping these here (not just
 * in the v6 migration) makes ingest self-sufficient: if a user upgrades
 * specship but their migration ran in an older binary that didn't seed,
 * the ingestor seeds on first pass instead of failing silently.
 */
const DEFAULT_PRICING: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['claude-opus-4-7',    15.0, 75.0, 18.75, 1.5],
  ['claude-opus-4',      15.0, 75.0, 18.75, 1.5],
  ['claude-sonnet-4-6',   3.0, 15.0,  3.75, 0.3],
  ['claude-sonnet-4-7',   3.0, 15.0,  3.75, 0.3],
  ['claude-sonnet-4',     3.0, 15.0,  3.75, 0.3],
  ['claude-haiku-4-5',    0.80, 4.0,  1.0,  0.08],
  ['claude-haiku-4',      0.80, 4.0,  1.0,  0.08],
];

/** Load the pricing table once per ingest pass. Seeds defaults if empty. */
function loadPricing(db: IngestDb): PricingRow[] {
  let rows = db
    .prepare('SELECT model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok FROM claude_pricing')
    .all() as PricingRow[];
  if (rows.length === 0) {
    const now = Date.now();
    const ins = db.prepare(`
      INSERT OR IGNORE INTO claude_pricing
        (model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of DEFAULT_PRICING) ins.run(r[0], r[1], r[2], r[3], r[4], now);
    rows = db
      .prepare('SELECT model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok FROM claude_pricing')
      .all() as PricingRow[];
  }
  return rows;
}

/**
 * Read a file's tail from `fromOffset` to end. Returns the full text plus
 * the new file size. We read the whole tail at once — JSONL transcripts are
 * usually < 5MB even for long sessions, well within Node's sync read budget.
 */
function readTail(filePath: string, fromOffset: number): { text: string; size: number } {
  const stat = fs.statSync(filePath);
  if (stat.size <= fromOffset) return { text: '', size: stat.size };
  const fd = fs.openSync(filePath, 'r');
  try {
    const length = stat.size - fromOffset;
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, fromOffset);
    return { text: buf.toString('utf-8'), size: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Walk every transcript file under claudeRoot, ingest any new bytes, and
 * return aggregate stats. Synchronous: the caller controls cadence.
 */
export function ingestAll(db: IngestDb, options: IngestOptions = {}): IngestStats {
  const start = Date.now();
  const claudeRoot = options.claudeRoot ?? path.join(os.homedir(), '.claude', 'projects');
  const verbose = options.verbose ?? false;
  const stats: IngestStats = {
    filesScanned: 0,
    filesSkipped: 0,
    bytesIngested: 0,
    linesParsed: 0,
    promptsInserted: 0,
    toolCallsInserted: 0,
    errors: 0,
    durationMs: 0,
  };

  const pricing = loadPricing(db);
  const files = listTranscriptFiles(claudeRoot);
  for (const f of files) {
    stats.filesScanned++;
    try {
      const wasIngested = ingestFile(db, f.filePath, f.projectPath, pricing, options);
      if (!wasIngested.modified) {
        stats.filesSkipped++;
      } else {
        stats.bytesIngested += wasIngested.bytes;
        stats.linesParsed += wasIngested.lines;
        stats.promptsInserted += wasIngested.prompts;
        stats.toolCallsInserted += wasIngested.toolCalls;
      }
    } catch (err) {
      stats.errors++;
      if (verbose) {
        // eslint-disable-next-line no-console
        console.error('[ingest] failed:', f.filePath, err instanceof Error ? err.message : String(err));
      }
    }
  }
  stats.durationMs = Date.now() - start;
  return stats;
}

interface FileResult {
  modified: boolean;
  bytes: number;
  lines: number;
  prompts: number;
  toolCalls: number;
}

function ingestFile(
  db: IngestDb,
  filePath: string,
  projectPath: string,
  pricing: PricingRow[],
  options: IngestOptions
): FileResult {
  // Load state.
  const stateRow = db
    .prepare('SELECT last_offset, file_size, session_id FROM claude_ingest_state WHERE file_path = ?')
    .get(filePath) as { last_offset: number; file_size: number; session_id: string | null } | undefined;
  const lastOffset = stateRow?.last_offset ?? 0;

  const { text, size } = readTail(filePath, lastOffset);
  if (text.length === 0) {
    return { modified: false, bytes: 0, lines: 0, prompts: 0, toolCalls: 0 };
  }

  const lines = text.split('\n');
  // The last fragment may be a partial line (the JSONL is append-only — Claude
  // might be mid-write). Only consume complete lines; remember where the last
  // complete newline ends so we resume from there.
  let consumedLen = 0;
  const completeLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    // Last entry: if there's no trailing newline, treat as incomplete.
    if (i === lines.length - 1) {
      // If text ends with "\n", the last split element is "" — already complete.
      if (line === '') {
        consumedLen += 0; // already accounted for
      } else if (text.endsWith('\n')) {
        completeLines.push(line);
        consumedLen += line.length + 1;
      } else {
        // partial — leave for next pass
      }
      continue;
    }
    completeLines.push(line);
    consumedLen += line.length + 1; // +1 for the newline
  }

  const newOffset = lastOffset + consumedLen;
  if (completeLines.length === 0) {
    return { modified: false, bytes: 0, lines: 0, prompts: 0, toolCalls: 0 };
  }

  // Project lazy upsert — keep first_seen on insert, bump last_seen on update.
  const projectSlug = path.basename(path.dirname(filePath));
  const projectName = decodeProjectSlug(projectSlug);
  const now = Date.now();
  db.prepare(`
    INSERT INTO claude_projects (path, name, first_seen, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET last_seen = excluded.last_seen
  `).run(projectPath, projectName, now, now);

  // Per-file ingest in a transaction.
  const txn = db.transaction(() => {
    return processLines(db, filePath, projectPath, completeLines, pricing);
  }) as () => ProcessResult;
  const result = txn();

  // Persist new offset.
  db.prepare(`
    INSERT INTO claude_ingest_state (file_path, last_offset, last_ingested_at, file_size, session_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      last_offset = excluded.last_offset,
      last_ingested_at = excluded.last_ingested_at,
      file_size = excluded.file_size,
      session_id = excluded.session_id
  `).run(filePath, newOffset, now, size, result.lastSessionId);

  if (options.verbose) {
    // eslint-disable-next-line no-console
    console.error(
      `[ingest] ${path.basename(filePath)}: +${result.prompts} prompts, +${result.toolCalls} tools, +${consumedLen}b`
    );
  }

  return {
    modified: true,
    bytes: consumedLen,
    lines: completeLines.length,
    prompts: result.prompts,
    toolCalls: result.toolCalls,
  };
}

interface ProcessResult extends FileResult {
  lastSessionId: string | null;
}

/**
 * Single-pass over the entries in this file batch. We need to relate
 * tool_use blocks (in assistant entries) to their tool_result blocks (in
 * the next user entry) so result_length is captured. Maintain a map of
 * pending tool_use_id → { promptId, name, summary, ts } as we walk.
 */
function processLines(
  db: IngestDb,
  filePath: string,
  projectPath: string,
  completeLines: string[],
  pricing: PricingRow[]
): ProcessResult {
  const insSession = db.prepare(`
    INSERT INTO claude_sessions (id, project_path, source_file, started_at, ended_at, prompt_count, last_model)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      last_model = COALESCE(excluded.last_model, claude_sessions.last_model)
  `);
  const incSessionAggregates = db.prepare(`
    UPDATE claude_sessions SET
      prompt_count = prompt_count + ?,
      total_input_tokens = total_input_tokens + ?,
      total_output_tokens = total_output_tokens + ?,
      total_cache_creation_tokens = total_cache_creation_tokens + ?,
      total_cache_read_tokens = total_cache_read_tokens + ?,
      total_cost_usd = total_cost_usd + ?
    WHERE id = ?
  `);
  const insPrompt = db.prepare(`
    INSERT INTO claude_prompts (id, session_id, text, ts, leaf_uuid, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, is_sidechain)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      text = COALESCE(excluded.text, claude_prompts.text),
      model = COALESCE(excluded.model, claude_prompts.model),
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cost_usd = excluded.cost_usd
  `);
  const insToolCall = db.prepare(`
    INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_use_id, tool_name, input_summary, input_json, result_length, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  /**
   * Append the assistant's text + thinking blocks from one assistant turn
   * onto the prompt row. A single user prompt can span multiple assistant
   * turns (model re-renders / continues after a tool round-trip), so we
   * concatenate with `||` instead of overwriting. Empty contributions
   * (e.g. an assistant turn that's all tool_use) leave the column NULL
   * if nothing was previously accumulated — kept as NULL so the UI can
   * cleanly hide the section.
   */
  const appendPromptText = db.prepare(`
    UPDATE claude_prompts SET
      assistant_text = CASE
        WHEN ? = '' THEN assistant_text
        WHEN assistant_text IS NULL THEN ?
        ELSE assistant_text || ?
      END,
      thinking_text = CASE
        WHEN ? = '' THEN thinking_text
        WHEN thinking_text IS NULL THEN ?
        ELSE thinking_text || ?
      END
    WHERE id = ?
  `);

  let lastSessionId: string | null = null;
  let promptsInserted = 0;
  let toolCallsInserted = 0;

  // Dedupe state for "user entries that share a promptId with one we
  // already inserted." `insertedPromptIds` covers the in-batch case
  // (sequential tool_results inside the same JSONL chunk); the prepared
  // `existsPromptStmt` covers the cross-batch case (tool_results that
  // arrive after the original prompt landed in a previous batch).
  const insertedPromptIds = new Set<string>();
  const existsPromptStmt = db.prepare(
    `SELECT 1 FROM claude_prompts WHERE id = ?`
  );

  // Track active prompt context. Only user entries carry a `promptId` in the
  // JSONL — assistant entries belong to whichever prompt the most-recent user
  // entry started. When we resume from a saved offset, the first lines in the
  // batch are typically assistant turns answering a prompt whose user entry
  // landed in an earlier batch, so `activePromptId` starts null and we must
  // recover it from the DB; otherwise tool_use blocks queue with a fabricated
  // promptId and the eventual tool_result insert violates the prompt_id FK,
  // rolling back the whole batch transaction and stalling the file forever.
  let activePromptId: string | null = null;
  const lookupLatestPrompt = db.prepare(
    `SELECT id FROM claude_prompts WHERE session_id = ? ORDER BY ts DESC LIMIT 1`
  );
  const resolveActivePromptId = (sessionId: string): string | null => {
    if (activePromptId) return activePromptId;
    const row = lookupLatestPrompt.get(sessionId) as { id: string } | undefined;
    if (row?.id) activePromptId = row.id;
    return activePromptId;
  };

  // Tool_use waiting for a tool_result: tool_use_id → pending row.
  // `inputJson` carries the verbatim JSON-stringified `input` field so the
  // dashboard can show the full tool input alongside the truncated display
  // summary. Captured at queue-time (when the assistant emits the tool_use)
  // so it lands together with the matched tool_result.
  interface PendingTool {
    promptId: string;
    sessionId: string;
    assistantUuid: string;
    toolName: string;
    summary: string;
    inputJson: string | null;
    ts: number;
  }
  const pendingTools = new Map<string, PendingTool>();

  for (const raw of completeLines) {
    const entry = parseLine(raw);
    if (!entry) continue;
    const sessionId = entry.sessionId ?? '';
    if (!sessionId) continue;
    lastSessionId = sessionId;

    const ts = toEpochMs(entry.timestamp);

    if (entry.type === 'user') {
      // Bookkeep session row first.
      insSession.run(sessionId, projectPath, filePath, ts, ts, null);

      const text = extractUserPrompt(entry);
      const promptId = entry.promptId ?? entry.uuid ?? null;
      const isSidechain = entry.isSidechain ? 1 : 0;

      if (promptId) {
        activePromptId = promptId;
        // Claude Code emits MULTIPLE user-type entries per logical prompt:
        // the initial user message + one entry per tool_result the assistant
        // requested. All share the same `promptId`. The original ingestor
        // ran insPrompt + bumped prompt_count for every one of them — so a
        // 50-prompt session with ~15 tool calls each landed in the DB as
        // 800+ "prompts" and the per-prompt token columns were repeatedly
        // reset to 0 via the ON CONFLICT DO UPDATE clause. Detect follow-up
        // tool_result entries by checking whether the prompt row already
        // exists (in this batch or persisted from an earlier batch) and
        // skip both the upsert and the aggregate bump for them.
        const isFollowUp =
          insertedPromptIds.has(promptId) ||
          !!existsPromptStmt.get(promptId);

        if (!isFollowUp) {
          // First time we've seen this promptId — INSERT, count it, mark seen.
          insPrompt.run(
            promptId, sessionId,
            text || null,
            ts,
            entry.leafUuid ?? null,
            null,
            0, 0, 0, 0, 0,
            isSidechain
          );
          promptsInserted++;
          insertedPromptIds.add(promptId);
          incSessionAggregates.run(1, 0, 0, 0, 0, 0, sessionId);
        }
      }

      // Handle tool_result blocks: scan content for tool_result entries and
      // update the matching pending tool_call row's result_length.
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && block.type === 'tool_result' && block.tool_use_id) {
            const len = toolResultLength(block);
            const pending = pendingTools.get(block.tool_use_id);
            if (pending) {
              insToolCall.run(
                pending.promptId,
                pending.sessionId,
                pending.assistantUuid,
                block.tool_use_id,
                pending.toolName,
                pending.summary,
                pending.inputJson,
                len,
                pending.ts
              );
              toolCallsInserted++;
              pendingTools.delete(block.tool_use_id);
            }
          }
        }
      }
    } else if (entry.type === 'assistant') {
      // Make sure session row exists.
      insSession.run(sessionId, projectPath, filePath, ts, ts, entry.message?.model ?? null);

      // Resolve the prompt this assistant turn belongs to. Never fall back to
      // `entry.uuid` — that's the assistant's per-message id, not a row in
      // claude_prompts, and using it would re-introduce the FK violation that
      // caused this entire path to stall.
      const promptId = resolveActivePromptId(sessionId);
      if (!promptId) continue;

      const usage = entry.message?.usage;
      const inputTok = usage?.input_tokens ?? 0;
      const outputTok = usage?.output_tokens ?? 0;
      const cacheCreate = usage?.cache_creation_input_tokens ?? 0;
      const cacheRead = usage?.cache_read_input_tokens ?? 0;

      const pricingRow = resolvePricing(entry.message?.model, pricing);
      const cost = computeCost(usage, pricingRow);

      // Update prompt's running usage. Re-uses ON CONFLICT to ADD to existing.
      // Since INSERT...ON CONFLICT DO UPDATE replaces (not increments), do an
      // explicit UPDATE here for the additive case.
      db.prepare(`
        UPDATE claude_prompts SET
          input_tokens = input_tokens + ?,
          output_tokens = output_tokens + ?,
          cache_creation_tokens = cache_creation_tokens + ?,
          cache_read_tokens = cache_read_tokens + ?,
          cost_usd = cost_usd + ?,
          model = COALESCE(?, model)
        WHERE id = ?
      `).run(inputTok, outputTok, cacheCreate, cacheRead, cost, entry.message?.model ?? null, promptId);

      // Session aggregates: only token totals + cost. prompt_count was bumped
      // when the user entry landed.
      incSessionAggregates.run(0, inputTok, outputTok, cacheCreate, cacheRead, cost, sessionId);

      // Scan content for tool_use, text, and thinking blocks. tool_use →
      // queued for a later tool_result match; text + thinking → appended
      // onto the prompt row so the dashboard can show the assistant's
      // actual response, not just token counts. One pass over the array
      // so we don't iterate twice on what can be a large list.
      const content = entry.message?.content;
      const assistantUuid = entry.uuid ?? '';
      let assistantTextChunk = '';
      let thinkingTextChunk = '';
      if (Array.isArray(content)) {
        for (const block of content as ClaudeContentBlock[]) {
          if (!block) continue;
          if (block.type === 'tool_use' && block.id && block.name && assistantUuid) {
            // JSON-stringify the full input. Schema column is TEXT;
            // large inputs (e.g. Bash with long heredocs) are fine as-is.
            // Falsy / undefined / circular inputs degrade to a quiet null
            // rather than throwing — the summary column still captures
            // a display value.
            let inputJson: string | null = null;
            try {
              inputJson = JSON.stringify(block.input ?? null);
            } catch { inputJson = null; }
            pendingTools.set(block.id, {
              promptId,
              sessionId,
              assistantUuid,
              toolName: block.name,
              summary: summarizeToolInput(block.name, block.input),
              inputJson,
              ts,
            });
          } else if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
            // The assistant's prose response. Concatenated with the
            // existing assistant_text via the appendPromptText UPDATE
            // below — one prompt can span multiple assistant turns.
            assistantTextChunk += (block as { text: string }).text;
          } else if (block.type === 'thinking' && typeof (block as { text?: unknown }).text === 'string') {
            // Extended thinking. Same accumulation pattern as text.
            thinkingTextChunk += (block as { text: string }).text;
          }
        }
      }
      if (assistantTextChunk || thinkingTextChunk) {
        // Separate consecutive turn contributions with a blank line so
        // multi-turn responses render with paragraph breaks instead of
        // collapsing into a single run-on block.
        const at = assistantTextChunk ? assistantTextChunk + '\n\n' : '';
        const tt = thinkingTextChunk ? thinkingTextChunk + '\n\n' : '';
        appendPromptText.run(at, at, at, tt, tt, tt, promptId);
      }
    }
    // attachment / queue-operation / last-prompt entries are ignored for v1.
  }

  // Any remaining pendingTools didn't have a tool_result yet — they'll be
  // matched on the next pass when the user reply arrives. We flush them with
  // result_length=0 so the tool call still shows up in analytics (better to
  // show "0 tokens returned" than to omit the call).
  for (const [toolUseId, pending] of pendingTools) {
    insToolCall.run(
      pending.promptId,
      pending.sessionId,
      pending.assistantUuid,
      toolUseId,
      pending.toolName,
      pending.summary,
      pending.inputJson,
      0,
      pending.ts
    );
    toolCallsInserted++;
  }

  return {
    modified: true,
    bytes: 0,
    lines: completeLines.length,
    prompts: promptsInserted,
    toolCalls: toolCallsInserted,
    lastSessionId,
  };
}
