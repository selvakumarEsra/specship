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
 * Gemini CLI 0.33.0 changed both (REQ-AGENTSWITCH-018; verified against
 * 0.67.0 services/chatRecordingService and config/storage):
 *
 *   - a session is JSON Lines (`session-*.jsonl`): a metadata record
 *     (`sessionId`, `projectHash`, `startTime`, …, optionally `messages`),
 *     then message records (keyed by `id`, the last one for an id wins),
 *     `{ $set }` metadata updates (a `$set.messages` replaces the list),
 *     `{ $patch }` records (`content` and tool-call `result`s for an id,
 *     `updates[]`, `removeIds[]`, `orderIds[]`) and `{ $rewindTo }`;
 *   - the folder is a short project name from Gemini's project registry, so
 *     the project is resolved from the header's `projectHash` (still
 *     sha256 of the root);
 *   - MCP tools are named `mcp_<server>_<tool>`;
 *   - tool responses and Gemini's `<session_context>` / `<hook_context>`
 *     turns are also `user` messages (they open no prompt), and a prompt's
 *     own text is in `displayContent` when Gemini added context to it.
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
import { summarizeToolInput, toEpochMs } from './shared.js';
import {
  normalizeToolName,
  type DiscoveredProject,
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
/** The collision-qualified form Gemini used before 0.33.0: `<server>__<tool>`. */
const QUALIFIED_RE = /^([A-Za-z0-9_-]+?)__(.+)$/;
/** The form Gemini uses from 0.33.0: `mcp_<server>_<tool>` (server names carry no `_`). */
const MCP_PREFIXED_RE = /^mcp_([^_]+)_(.+)$/;

/** Map one Gemini tool name onto the shared set. */
export function normalizeGeminiToolName(raw: string): string {
  const builtin = normalizeToolName(GEMINI_TOOL_NAMES, raw);
  if (builtin !== raw) return builtin;
  const p = raw.match(MCP_PREFIXED_RE);
  if (p) return canonicalMcpToolName(p[1]!, p[2]!);
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

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const strProp = (o: Rec, k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined);

/**
 * Fold a JSON Lines session (Gemini CLI >= 0.33.0) into the single-document
 * shape, applying records in order the way Gemini's own loader does.
 * Malformed lines are skipped; null when no metadata record is found.
 */
export function foldGeminiJsonl(text: string): Rec | null {
  let meta: Rec | null = null;
  const messages = new Map<string, Rec>();
  const setMessages = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const m of list) if (isRec(m) && strProp(m, 'id')) messages.set(m['id'] as string, m);
  };
  const patchOne = (patch: Rec): void => {
    const existing = messages.get(patch['id'] as string);
    if (!existing) return;
    if (patch['content'] !== undefined) existing['content'] = patch['content'];
    const calls = existing['toolCalls'];
    if (Array.isArray(patch['toolCalls']) && Array.isArray(calls)) {
      for (const tp of patch['toolCalls'] as unknown[]) {
        if (!isRec(tp) || !('result' in tp)) continue;
        const tc = calls.find((c) => isRec(c) && c['id'] === tp['id']);
        if (isRec(tc)) tc['result'] = tp['result'];
      }
    }
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r: unknown;
    try { r = JSON.parse(line); } catch { continue; }
    if (!isRec(r)) continue;
    const rewind = strProp(r, '$rewindTo');
    if (rewind !== undefined) {
      let found = false;
      for (const id of [...messages.keys()]) {
        if (id === rewind) found = true;
        if (found) messages.delete(id);
      }
      if (!found) messages.clear();
    } else if (isRec(r['$patch'])) {
      const p = r['$patch'] as Rec;
      if (strProp(p, 'id')) patchOne(p);
      if (Array.isArray(p['updates'])) for (const u of p['updates']) if (isRec(u) && strProp(u, 'id')) patchOne(u);
      if (Array.isArray(p['removeIds'])) for (const id of p['removeIds']) if (typeof id === 'string') messages.delete(id);
      if (Array.isArray(p['orderIds'])) {
        const ordered = (p['orderIds'] as unknown[]).filter((id): id is string => typeof id === 'string' && messages.has(id));
        const keep = new Set(ordered);
        const entries = [...messages.entries()];
        messages.clear();
        for (const [id, m] of entries) if (!keep.has(id)) messages.set(id, m);
        for (const id of ordered) messages.set(id, entries.find(([k]) => k === id)![1]);
      }
    } else if (strProp(r, 'id')) {
      messages.set(r['id'] as string, r);
    } else if (isRec(r['$set'])) {
      const set = r['$set'] as Rec;
      if (Array.isArray(set['messages'])) { messages.clear(); setMessages(set['messages']); }
      meta = { ...(meta ?? {}), ...set };
    } else if (strProp(r, 'sessionId') && strProp(r, 'projectHash')) {
      meta = { ...(meta ?? {}), ...r };
      setMessages(r['messages']);
    }
  }
  if (!meta) return null;
  return { ...meta, messages: [...messages.values()] };
}

/** Parse one Gemini session (a JSON document, or JSON Lines). Null when it cannot be read. */
export function parseGeminiSession(text: string): ParsedSession | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = null;
  }
  // A JSON Lines session — or one holding only its header line, which parses whole.
  if (!isRec(doc) || !Array.isArray(doc['messages'])) doc = foldGeminiJsonl(text);
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
      // From 0.33.0 Gemini also records tool responses (no text parts) and
      // its own `<session_context>` / `<hook_context>` turns as user
      // messages; like Gemini's own resume logic, those start no prompt.
      const said = contentText(msg['content']);
      if (!said || /^<(session|hook)_context>/.test(said)) return;
      current = openPrompt(id, contentText(msg['displayContent']) || said, ts);
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

const isSessionFile = (name: string): boolean => /\.jsonl?$/i.test(name);

/** The `projectHash` in a JSON Lines session's header, read from its first line. */
function headerProjectHash(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.toString('utf-8', 0, n).split('\n', 1)[0] ?? '';
    const rec = JSON.parse(first) as unknown;
    return isRec(rec) && typeof rec['projectHash'] === 'string' ? (rec['projectHash'] as string) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Every `<root>/<project>/chats/*.json[l]`. The project is resolved when a
 * known root hashes to the folder name (before 0.33.0) or to the session
 * header's `projectHash` (0.33.0 on); otherwise it is kept as `gemini:<id>`.
 */
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
    const byDir = byHash.get(h.name);
    for (const f of files) {
      if (!f.isFile() || !isSessionFile(f.name)) continue;
      const filePath = path.join(chats, f.name);
      let projectPath = byDir;
      if (!projectPath && f.name.toLowerCase().endsWith('.jsonl')) {
        const hash = headerProjectHash(filePath);
        if (hash) projectPath = byHash.get(hash);
      }
      out.push({ filePath, projectPath: projectPath ?? `${GEMINI_PROFILE.id}:${h.name}` });
    }
  }
  return out;
}

/**
 * Projects in Gemini CLI's registry (`~/.gemini/projects.json`, 0.33.0+:
 * `{ projects: { <root>: <short id> } }`), with the session count and newest
 * session under `tmp/<short id>/chats` (REQ-AGENTSWITCH-019.A1).
 */
export function listGeminiProjects(home: string): DiscoveredProject[] {
  const dir = path.join(home, GEMINI_PROFILE.configDir);
  let projects: Record<string, unknown>;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf-8')) as unknown;
    if (!isRec(parsed) || !isRec(parsed['projects'])) return [];
    projects = parsed['projects'] as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: DiscoveredProject[] = [];
  for (const [root, id] of Object.entries(projects)) {
    if (!path.isAbsolute(root)) continue;
    let sessionCount = 0;
    let lastModifiedMs = 0;
    if (typeof id === 'string' && id && !/[\\/]/.test(id)) {
      const chats = path.join(dir, 'tmp', id, 'chats');
      try {
        for (const f of fs.readdirSync(chats, { withFileTypes: true })) {
          if (!f.isFile() || !isSessionFile(f.name)) continue;
          sessionCount++;
          try { lastModifiedMs = Math.max(lastModifiedMs, fs.statSync(path.join(chats, f.name)).mtimeMs); } catch { /* gone */ }
        }
      } catch { /* no sessions yet */ }
    }
    out.push({ path: root, sessionCount, lastModifiedMs });
  }
  return out;
}

export const geminiTranscriptAdapter: DocumentTranscriptAdapter = {
  id: GEMINI_PROFILE.id,
  format: 'document',
  defaultRoot: (home) => path.join(home, GEMINI_PROFILE.configDir, 'tmp'),
  listFiles: listGeminiTranscriptFiles,
  listProjects: listGeminiProjects,
  watches: (fileName) => {
    const parts = fileName.split(/[\\/]/);
    return parts.length >= 2 && parts[parts.length - 2] === 'chats' && isSessionFile(fileName);
  },
  normalizeToolName: normalizeGeminiToolName,
  parseFile: parseGeminiSession,
};
