/**
 * Per-agent transcript adapters (REQ-AGENTSWITCH-004).
 *
 * Analytics, reflect mining and the explore "prior work" section read
 * sessions only through one adapter per agent. Each adapter knows where its
 * agent keeps transcripts, how to parse them, and how to map its tool names
 * onto the shared set (`../../canonical-tools.ts`) before anything counts
 * them. Shared ingest code never names an agent.
 *
 * Two transcript shapes exist:
 *   - `jsonl`    — append-only JSON lines, ingested incrementally from the
 *                  last byte offset (Claude Code);
 *   - `document` — one JSON document per session, rewritten whole, parsed
 *                  in one go and re-ingested when it changes (Gemini CLI,
 *                  DOM-SPECSHIP-007).
 */
import type { HostId } from '../../host-profiles.js';
import type { ClaudeRawEntry, ClaudeContentBlock } from '../types.js';

/** One transcript file and the project it belongs to. */
export interface TranscriptFile {
  filePath: string;
  projectPath: string;
}

/** Context an adapter may use to resolve a file's project. */
export interface ListContext {
  /** Real project roots the caller knows about (e.g. the dashboard's primary project). */
  projectPaths?: readonly string[];
}

/** One tool call, already normalised. */
export interface ParsedToolCall {
  id: string;
  /** The agent's own tool name. */
  rawName: string;
  /** The shared tool name (`normalizeToolName`). */
  name: string;
  summary: string;
  inputJson: string | null;
  resultLength: number;
  ts: number;
}

/** One user prompt and everything the agent did to answer it. */
export interface ParsedPrompt {
  id: string;
  text: string | null;
  ts: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  assistantText: string | null;
  thinkingText: string | null;
  toolCalls: ParsedToolCall[];
}

/** A whole session parsed from one document transcript. */
export interface ParsedSession {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  model: string | null;
  prompts: ParsedPrompt[];
}

interface AdapterBase {
  id: HostId;
  /** Default transcript root for a home directory. */
  defaultRoot(home: string): string;
  /** Every transcript file under `root`. */
  listFiles(root: string, ctx?: ListContext): TranscriptFile[];
  /** True when a changed file name (relative to the root) is one of this adapter's transcripts. */
  watches(fileName: string): boolean;
  /** Map the agent's tool name onto the shared set. */
  normalizeToolName(raw: string): string;
}

export interface JsonlTranscriptAdapter extends AdapterBase {
  format: 'jsonl';
  parseLine(line: string): ClaudeRawEntry | null;
  summarizeToolInput(name: string, input: Record<string, unknown> | undefined): string;
  /** The user-visible prompt text of a user entry (REQ-AGENTSWITCH-017). */
  extractUserPrompt(entry: ClaudeRawEntry): string;
  /** Size of a tool-result block, for the result-length analytics. */
  toolResultLength(block: ClaudeContentBlock | undefined): number;
}

export interface DocumentTranscriptAdapter extends AdapterBase {
  format: 'document';
  /** The parsed session, or `null` when the document cannot be read — never a guess. */
  parseFile(text: string): ParsedSession | null;
}

export type TranscriptAdapter = JsonlTranscriptAdapter | DocumentTranscriptAdapter;

/** Look `raw` up in an adapter's name map; an unmapped name passes through. */
export function normalizeToolName(map: Readonly<Record<string, string>>, raw: string): string {
  return Object.prototype.hasOwnProperty.call(map, raw) ? map[raw]! : raw;
}
