/**
 * Claude Code transcript adapter (REQ-AGENTSWITCH-004).
 *
 * Sessions live in `~/.claude/projects/<slug>/<sessionId>.jsonl`, where
 * `<slug>` is the slash-escaped absolute project path. Files are append-only
 * JSON lines, so the ingestor resumes from the last byte offset.
 *
 * Claude Code's tool names ARE the shared set (`Read`, `Bash`,
 * `mcp__<server>__<tool>` …), so normalisation is the identity — which is
 * what keeps existing rows and counts unchanged (REQ-AGENTSWITCH-004.A2).
 */
import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_PROFILE } from '../../host-profiles.js';
import { extractUserPrompt, parseLine, toolResultLength } from './claude-jsonl.js';
import { summarizeToolInput } from './shared.js';
import type { JsonlTranscriptAdapter, TranscriptFile } from './types.js';

/**
 * Convert Claude's slash-escaped project dir name back into a real path.
 * `-Users-alice-projects-foo` → `/Users/alice/projects/foo`
 */
export function decodeProjectSlug(slug: string): string {
  return slug.startsWith('-') ? '/' + slug.slice(1).replace(/-/g, '/') : slug;
}

/** Every `<root>/<slug>/<sessionId>.jsonl`, with the decoded project path. */
export function listClaudeTranscriptFiles(root: string): Array<TranscriptFile & { projectSlug: string }> {
  const out: Array<TranscriptFile & { projectSlug: string }> = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(root, p.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.isFile() && f.name.toLowerCase().endsWith('.jsonl')) {
        out.push({ filePath: path.join(dir, f.name), projectPath: decodeProjectSlug(p.name), projectSlug: p.name });
      }
    }
  }
  return out;
}

export const claudeTranscriptAdapter: JsonlTranscriptAdapter = {
  id: CLAUDE_PROFILE.id,
  format: 'jsonl',
  defaultRoot: (home) => path.join(home, CLAUDE_PROFILE.configDir, 'projects'),
  listFiles: (root) => listClaudeTranscriptFiles(root),
  watches: (fileName) => fileName.toLowerCase().endsWith('.jsonl'),
  normalizeToolName: (raw) => raw,
  parseLine,
  summarizeToolInput,
  extractUserPrompt,
  toolResultLength,
};
