/**
 * Gemini CLI transcript adapter (REQ-AGENTSWITCH-004, DOM-SPECSHIP-007).
 *
 * Verified against @google/gemini-cli-core 0.28.0
 * (services/chatRecordingService.js, core/geminiChat.js, config/storage.js):
 *
 *   - a session is ONE pretty-printed JSON document at
 *     `~/.gemini/tmp/<project_hash>/chats/session-<timestamp>-<id8>.json`,
 *     rewritten whole on every update — never JSON lines;
 *   - `<project_hash>` is sha256(project root) in hex, so a project is
 *     recognised by hashing the roots the caller knows; otherwise the path is
 *     kept as `gemini:<hash>` (never guessed);
 *   - `messages[]` carry `type` ('user' | 'gemini' | 'info' | …), `content`
 *     (string or parts), and on gemini messages `toolCalls[]`
 *     (`{ id, name, args, result: responseParts | null, timestamp }`),
 *     `thoughts[]` (`{ subject, description }`), `tokens`
 *     (`{ input, output, cached, thoughts, … }`) and `model`;
 *   - an MCP tool is recorded under its bare name (`specship_explore`); the
 *     qualified `<server>__<tool>` form appears only on a name collision.
 *
 * Tool names are mapped onto the shared set; a document that does not parse,
 * or has no `messages` array, is unreadable — `parseFile` returns null and
 * the ingestor counts it.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { GEMINI_PROFILE } from '../../host-profiles.js';
import { CANONICAL_TOOLS, specshipServerName, canonicalMcpToolName } from '../../canonical-tools.js';
import { summarizeToolInput, toEpochMs } from '../parser.js';
import {
  normalizeToolName,
  type DocumentTranscriptAdapter,
  type ListContext,
  type ParsedPrompt,
  type ParsedSession,
  type ParsedToolCall,
  type TranscriptFile,
} from './types.js';

/** Gemini CLI 0.28.0 built-in tool names → shared names. */
export const GEMINI_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  read_file: CANONICAL_TOOLS.read,
  read_many_files: CANONICAL_TOOLS.read,
  run_shell_command: CANONICAL_TOOLS.bash,
  grep_search: CANONICAL_TOOLS.grep,
  glob: CANONICAL_TOOLS.glob,
  write_file: CANONICAL_TOOLS.write,
  replace: CANONICAL_TOOLS.edit,
});

/** Bare SpecShip tools all start with this (tools/mcp-tool.js records the server's own tool name). */
const bareSpecshipPrefix = `${specshipServerName}_`;
/** The collision-qualified form Gemini uses: `<server>__<tool>`. */
const QUALIFIED_RE = /^([A-Za-z0-9_-]+?)__(.+)$/;

/** Map one Gemini tool name onto the shared set. */
export function normalizeGeminiToolName(raw: string): string {
  const builtin = normalizeToolName(GEMINI_TOOL_NAMES, raw);
  if (builtin !== raw) return builtin;
  const q = raw.match(QUALIFIED_RE);
  if (q) return canonicalMcpToolName(q[1]!, q[2]!);
  if (raw.startsWith(bareSpecshipPrefix)) return canonicalMcpToolName(specshipServerName, raw);
  return raw;
}

/** Re-key Gemini args onto the shape the shared summariser reads. */
function summarize(raw: string, name: string, args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== 'object') return '';
  if (raw === 'read_many_files') {
    const inc = args['include'] ?? args['paths'];
    if (Array.isArray(inc)) return inc.filter((x) => typeof x === 'string').join(', ').slice(0, 400);
  }
  const file = args['file_path'] ?? args['absolute_path'] ?? args['path'];
  const keyed = typeof file === 'string' && args['file_path'] === undefined ? { ...args, file_path: file } : args;
  return summarizeToolInput(name, keyed);
}

/** Text carried by a Gemini content / result value (string, part, or part list). */
function textLength(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length;
  if (Array.isArray(v)) return v.reduce((n: number, p) => n + textLength(p), 0);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['text'] === 'string') return (o['text'] as string).length;
    const fr = o['functionResponse'] as { response?: Record<string, unknown> } | undefined;
    if (fr && typeof fr === 'object') {
      const out = fr.response?.['output'];
      if (typeof out === 'string') return out.length;
      try { return JSON.stringify(fr.response ?? null).length; } catch { return 0; }
    }
  }
  return 0;
}

function contentText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .filter(Boolean).join('\n').trim();
  }
  if (v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string') return (v as { text: string }).text;
  return '';
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Parse one Gemini session document. Null when it cannot be read. */
export function parseGeminiSession(text: string): ParsedSession | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const d = doc as { sessionId?: unknown; startTime?: unknown; lastUpdated?: unknown; messages?: unknown };
  if (typeof d.sessionId !== 'string' || !d.sessionId || !Array.isArray(d.messages)) return null;

  const sessionId = d.sessionId;
  const startedAt = typeof d.startTime === 'string' ? toEpochMs(d.startTime) : 0;
  const prompts: ParsedPrompt[] = [];
  let current: ParsedPrompt | null = null;
  let lastModel: string | null = null;
  let lastTs = startedAt;

  const openPrompt = (id: string, text: string | null, ts: number): ParsedPrompt => {
    const p: ParsedPrompt = {
      id, text, ts, model: null,
      inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      assistantText: null, thinkingText: null, toolCalls: [],
    };
    prompts.push(p);
    return p;
  };

  d.messages.forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as Record<string, unknown>;
    const ts = typeof msg['timestamp'] === 'string' ? toEpochMs(msg['timestamp'] as string) : lastTs;
    lastTs = Math.max(lastTs, ts);
    const id = typeof msg['id'] === 'string' && msg['id'] ? (msg['id'] as string) : `${sessionId}:${i}`;

    if (msg['type'] === 'user') {
      current = openPrompt(id, contentText(msg['content']) || null, ts);
      return;
    }
    if (msg['type'] !== 'gemini') return;
    // A gemini turn before any user message still belongs to a prompt row.
    const prompt: ParsedPrompt = current ?? (current = openPrompt(`${sessionId}:prompt`, null, ts));

    const model = typeof msg['model'] === 'string' && msg['model'] ? (msg['model'] as string) : null;
    if (model) { prompt.model = model; lastModel = model; }

    const tokens = (msg['tokens'] ?? null) as Record<string, unknown> | null;
    if (tokens && typeof tokens === 'object') {
      const cached = num(tokens['cached']);
      prompt.inputTokens += Math.max(0, num(tokens['input']) - cached);
      prompt.cacheReadTokens += cached;
      prompt.outputTokens += num(tokens['output']) + num(tokens['thoughts']);
    }

    const said = contentText(msg['content']);
    if (said) prompt.assistantText = (prompt.assistantText ?? '') + said + '\n\n';
    const thoughts = msg['thoughts'];
    if (Array.isArray(thoughts)) {
      const t = thoughts
        .map((th) => (th && typeof th === 'object'
          ? [(th as { subject?: unknown }).subject, (th as { description?: unknown }).description]
              .filter((x): x is string => typeof x === 'string' && x.length > 0).join(': ')
          : ''))
        .filter(Boolean).join('\n');
      if (t) prompt.thinkingText = (prompt.thinkingText ?? '') + t + '\n\n';
    }

    const calls = msg['toolCalls'];
    if (!Array.isArray(calls)) return;
    calls.forEach((c, j) => {
      if (!c || typeof c !== 'object') return;
      const call = c as Record<string, unknown>;
      const rawName = typeof call['name'] === 'string' ? (call['name'] as string) : '';
      if (!rawName) return;
      const name = normalizeGeminiToolName(rawName);
      const args = call['args'] && typeof call['args'] === 'object' ? (call['args'] as Record<string, unknown>) : undefined;
      let inputJson: string | null = null;
      try { inputJson = JSON.stringify(call['args'] ?? null); } catch { inputJson = null; }
      const tc: ParsedToolCall = {
        id: typeof call['id'] === 'string' && call['id'] ? (call['id'] as string) : `${id}:${j}`,
        rawName,
        name,
        summary: summarize(rawName, name, args),
        inputJson,
        resultLength: textLength(call['result']),
        ts: typeof call['timestamp'] === 'string' ? toEpochMs(call['timestamp'] as string) : ts,
      };
      prompt.toolCalls.push(tc);
    });
  });

  const endedAt = typeof d.lastUpdated === 'string' ? Math.max(toEpochMs(d.lastUpdated), lastTs) : lastTs;
  return { sessionId, startedAt: startedAt || (prompts[0]?.ts ?? endedAt), endedAt, model: lastModel, prompts };
}

/** sha256(root) in hex — Gemini's project hash (config/storage.js getFilePathHash). */
export function geminiProjectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(projectRoot).digest('hex');
}

/** Every `<root>/<project_hash>/chats/*.json`, with the project resolved when a known root hashes to it. */
export function listGeminiTranscriptFiles(root: string, ctx: ListContext = {}): TranscriptFile[] {
  const byHash = new Map<string, string>();
  for (const p of ctx.projectPaths ?? []) byHash.set(geminiProjectHash(p), p);
  const out: TranscriptFile[] = [];
  let hashes: fs.Dirent[];
  try {
    hashes = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const h of hashes) {
    if (!h.isDirectory()) continue;
    const chats = path.join(root, h.name, 'chats');
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(chats, { withFileTypes: true });
    } catch {
      continue;
    }
    const projectPath = byHash.get(h.name) ?? `${GEMINI_PROFILE.id}:${h.name}`;
    for (const f of files) {
      if (f.isFile() && f.name.toLowerCase().endsWith('.json')) {
        out.push({ filePath: path.join(chats, f.name), projectPath });
      }
    }
  }
  return out;
}

export const geminiTranscriptAdapter: DocumentTranscriptAdapter = {
  id: GEMINI_PROFILE.id,
  format: 'document',
  defaultRoot: (home) => path.join(home, GEMINI_PROFILE.configDir, 'tmp'),
  listFiles: listGeminiTranscriptFiles,
  watches: (fileName) => {
    const parts = fileName.split(/[\\/]/);
    return parts.length >= 2 && parts[parts.length - 2] === 'chats' && fileName.toLowerCase().endsWith('.json');
  },
  normalizeToolName: normalizeGeminiToolName,
  parseFile: parseGeminiSession,
};
