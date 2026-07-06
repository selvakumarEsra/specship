/**
 * JSONL line parser — converts one line of a Claude Code transcript into a
 * structured ClaudeRawEntry, or null for unparseable / unrecognised lines.
 *
 * Tolerant: a malformed line never throws; the worker logs and skips it.
 */

import type { ClaudeRawEntry, ClaudeContentBlock } from './types.js';

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

/** Convert a timestamp field (ISO string or epoch number) to epoch ms. */
export function toEpochMs(ts: string | number | undefined): number {
  if (ts == null) return Date.now();
  if (typeof ts === 'number') {
    // Heuristic: 10-digit values are seconds, 13-digit are ms.
    return ts > 1e12 ? ts : ts * 1000;
  }
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : Date.now();
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

/**
 * For a tool_use block, build a short, format-aware input summary:
 *   - Read/Edit/Write → file path
 *   - Bash → first 200 chars of command
 *   - others → JSON of input, truncated to 200 chars
 *
 * This is what shows up in the heatmap drill-down and the tips engine.
 */
export function summarizeToolInput(name: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  const n = name.toLowerCase();
  // File-targeted tools
  if (n === 'read' || n === 'edit' || n === 'write' || n === 'notebookedit') {
    const p = (input.file_path ?? input.path ?? input.notebook_path) as string | undefined;
    if (typeof p === 'string') return p.slice(0, 400);
  }
  if (n === 'glob') {
    const p = (input.pattern ?? input.glob) as string | undefined;
    if (typeof p === 'string') return p.slice(0, 400);
  }
  if (n === 'grep') {
    const p = (input.pattern ?? input.query) as string | undefined;
    if (typeof p === 'string') return p.slice(0, 400);
  }
  if (n === 'bash' || n === 'shell') {
    const c = (input.command ?? input.cmd) as string | undefined;
    if (typeof c === 'string') return c.slice(0, 400);
  }
  // MCP tool — input.tool_name + JSON keys
  try {
    const j = JSON.stringify(input);
    return j.length > 400 ? j.slice(0, 400) + '…' : j;
  } catch {
    return '';
  }
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
