/**
 * Type definitions for Claude Code JSONL transcript ingest.
 *
 * These mirror the fields we actually use — Claude Code's JSONL format has
 * many more fields than these (parentUuid, isSidechain, version, gitBranch,
 * userType, …); we capture only what drives analytics + cost. Unknown fields
 * pass through silently.
 */

export type ClaudeEntryType =
  | 'queue-operation'
  | 'attachment'
  | 'user'
  | 'assistant'
  | 'last-prompt';

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
}

export interface ClaudeContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | string;
  text?: string;
  // tool_use:
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result:
  tool_use_id?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  is_error?: boolean;
}

export interface ClaudeAssistantMessage {
  model?: string;
  usage?: ClaudeUsage;
  content?: ClaudeContentBlock[];
}

export interface ClaudeUserMessage {
  content?: ClaudeContentBlock[] | string;
}

/** Raw JSONL row shape (only fields we use). */
export interface ClaudeRawEntry {
  type: ClaudeEntryType | string;
  uuid?: string;
  parentUuid?: string;
  promptId?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string | number;
  isSidechain?: boolean;
  message?: ClaudeAssistantMessage & ClaudeUserMessage;
  // For 'user' entries the `message.content` is the prompt body
  text?: string;
  // For 'last-prompt' entries:
  lastPrompt?: string;
  leafUuid?: string;
}

/** Per-model pricing in USD per 1M tokens. */
export interface PricingRow {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_creation_per_mtok: number;
  cache_read_per_mtok: number;
}

export interface IngestStats {
  filesScanned: number;
  filesSkipped: number;
  bytesIngested: number;
  linesParsed: number;
  promptsInserted: number;
  toolCallsInserted: number;
  errors: number;
  durationMs: number;
}
