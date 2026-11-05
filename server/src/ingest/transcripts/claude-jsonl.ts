/**
 * Claude transcript line format (REQ-AGENTSWITCH-017): converts one line of a
 * Claude Code JSONL transcript into a
 * structured ClaudeRawEntry, or null for unparseable / unrecognised lines.
 *
 * Tolerant: a malformed line never throws; the worker logs and skips it.
 */

import type { ClaudeRawEntry, ClaudeContentBlock } from '../types.js';

export function parseLine(line: string): ClaudeRawEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as ClaudeRawEntry;
    if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}


/** Extract the user-visible prompt text from a user-entry message. */
export function extractUserPrompt(entry: ClaudeRawEntry): string {
  // Some user entries store text at the top level; most use message.content.
  if (typeof entry.text === 'string' && entry.text.length > 0) return entry.text;
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is ClaudeContentBlock => b && typeof b === 'object')
      .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .filter((t) => t.length > 0)
      .join('\n')
      .trim();
  }
  return '';
}


/** Sum the character length of a tool_result content block. */
export function toolResultLength(block: ClaudeContentBlock | undefined): number {
  if (!block) return 0;
  const c = block.content;
  if (typeof c === 'string') return c.length;
  if (Array.isArray(c)) {
    return c.reduce((sum, item) => sum + (typeof item?.text === 'string' ? item.text.length : 0), 0);
  }
  return 0;
}

// The agent-neutral helpers live in ./shared; re-exported for this adapter's callers.
export { toEpochMs, summarizeToolInput } from './shared.js';
