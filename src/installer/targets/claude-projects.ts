/**
 * Claude Code's recently used projects (REQ-AGENTSWITCH-019): its per-project
 * transcript folders under `~/.claude/projects/<slug>/`, newest transcript
 * first. Moved out of shared code so discovery asks every target.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_CODE_TRAITS } from '../../activation/hook-output';
import type { RecentProject } from './types';

/**
 * Claude Code's slug encoding (every non-alphanumeric char → '-') is lossy,
 * so decoding by mapping '-' back to '/' mangles any path containing
 * hyphens/dots/underscores. Recover real paths from `~/.claude.json` (its
 * `projects` object is keyed by real absolute paths), then from a `"cwd"`
 * value in the slug's newest transcript, before falling back to the lossy
 * decode. Mirrors `server/src/ingest/project-paths.ts`
 * (REQ-SLUGRES-004) — the server package depends on this one, so the CLI
 * can't import it.
 */
function buildClaudeSlugIndex(home: string): Map<string, string> {
  const bySlug = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(home, CLAUDE_CODE_TRAITS.userConfigFile), 'utf8');
    const parsed = JSON.parse(raw) as { projects?: Record<string, unknown> };
    for (const realPath of Object.keys(parsed.projects ?? {})) {
      bySlug.set(realPath.replace(/[^A-Za-z0-9]/g, '-'), realPath);
    }
  } catch { /* missing or malformed — sniff/fallback below still work */ }
  return bySlug;
}

function sniffClaudeSlugCwd(claudeRoot: string, slug: string): string | null {
  const dir = path.join(claudeRoot, slug);
  let newest: { file: string; mtimeMs: number } | null = null;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.toLowerCase().endsWith('.jsonl')) continue;
      const st = fs.statSync(path.join(dir, f.name));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { file: f.name, mtimeMs: st.mtimeMs };
    }
  } catch { return null; }
  if (!newest) return null;
  try {
    const fd = fs.openSync(path.join(dir, newest.file), 'r');
    let chunk: string;
    try {
      const buf = Buffer.alloc(64 * 1024);
      const read = fs.readSync(fd, buf, 0, buf.length, 0);
      chunk = buf.toString('utf8', 0, read);
    } finally { fs.closeSync(fd); }
    const m = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
    if (!m) return null;
    let cwd = JSON.parse(`"${m[1]}"`) as string;
    // Accept the cwd or an ancestor of it — sessions may record a subdir.
    for (; ;) {
      if (cwd.replace(/[^A-Za-z0-9]/g, '-') === slug) return cwd;
      const parent = path.dirname(cwd);
      if (parent === cwd) return null;
      cwd = parent;
    }
  } catch { return null; }
}

/** Every Claude Code transcript folder that decodes to an existing directory. */
export function claudeRecentProjects(home: string): RecentProject[] {
  const claudeRoot = path.join(home, CLAUDE_CODE_TRAITS.configDir, 'projects');
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(claudeRoot, { withFileTypes: true });
  } catch { return []; }
  const slugIndex = buildClaudeSlugIndex(home);
  const out: RecentProject[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    const root =
      slugIndex.get(slug) ??
      sniffClaudeSlugCwd(claudeRoot, slug) ??
      (slug.startsWith('-') ? '/' + slug.slice(1).replace(/-/g, '/') : slug);
    // The newest transcript's mtime is the activity signal.
    let lastTouched = 0;
    try {
      for (const f of fs.readdirSync(path.join(claudeRoot, slug), { withFileTypes: true })) {
        if (!f.isFile() || !f.name.toLowerCase().endsWith('.jsonl')) continue;
        try {
          const st = fs.statSync(path.join(claudeRoot, slug, f.name));
          if (st.mtimeMs > lastTouched) lastTouched = st.mtimeMs;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    out.push({ root, lastTouched });
  }
  return out;
}
