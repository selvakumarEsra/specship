/**
 * Transcript adapter registry (REQ-AGENTSWITCH-004) — one adapter per agent,
 * Claude Code first (the default host). Mirrors `src/workflows/agents/index.ts`.
 */
import { claudeTranscriptAdapter } from './claude.js';
import { geminiTranscriptAdapter } from './gemini.js';
import type { TranscriptAdapter } from './types.js';

const ADAPTERS: readonly TranscriptAdapter[] = [claudeTranscriptAdapter, geminiTranscriptAdapter];

/** Every transcript adapter. */
export function transcriptAdapters(): readonly TranscriptAdapter[] {
  return ADAPTERS;
}

export { claudeTranscriptAdapter, decodeProjectSlug, listClaudeTranscriptFiles } from './claude.js';
export { geminiTranscriptAdapter, normalizeGeminiToolName, parseGeminiSession, geminiProjectHash, GEMINI_TOOL_NAMES } from './gemini.js';
export { normalizeToolName } from './types.js';
export type { TranscriptAdapter, JsonlTranscriptAdapter, DocumentTranscriptAdapter, ParsedSession, ParsedPrompt, ParsedToolCall, TranscriptFile, ListContext } from './types.js';
