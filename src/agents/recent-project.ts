/**
 * The project `specship desktop` opens when none is given (REQ-AGENTSWITCH-011):
 * the most recently active project that still exists and is `specship init`'d,
 * from every source that knows a project path — the installed-agents record
 * (any agent) and Claude Code's per-project transcript folders.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isInitialized } from '../directory';
import { hostTraitsFor } from '../activation/hook-output';
import { readAgentRecord } from '../installer/agent-record';

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
function buildClaudeSlugIndex(): Map<string, string> {
  const bySlug = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), hostTraitsFor('claude').userConfigFile), 'utf8');
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

/**
 * Auto-pick a default project for `specship desktop` when the user
 * didn't pass `-p` and the cwd isn't initialized either. Walks
 * `~/.claude/projects/*` (Claude Code's per-project transcript dirs),
 * resolves each slug back to a real path, and returns the most-recently-
 * touched one that's still on disk AND has been `specship init`'d.
 *
 * Returns null when nothing qualifies — the server boots projectless and
 * the desktop UI prompts the user to pick.
 */
export async function pickRecentInitializedProject(): Promise<string | null> {
  type Candidate = { decoded: string; lastTouched: number };
  const candidates: Candidate[] = [];
  // Projects any agent has SpecShip installed in (REQ-AGENTSWITCH-011) — the
  // only source for an agent whose session folders cannot be mapped back to a
  // path (Gemini CLI names them by a one-way hash).
  try {
    for (const e of readAgentRecord()?.entries ?? []) {
      if (e.scope !== 'local' || !e.projectRoot) continue;
      if (!fs.existsSync(e.projectRoot) || !isInitialized(e.projectRoot)) continue;
      candidates.push({ decoded: e.projectRoot, lastTouched: Date.parse(e.recordedAt) || 0 });
    }
  } catch { /* the record is advisory */ }
  const claudeRoot = path.join(os.homedir(), hostTraitsFor('claude').configDir, 'projects');
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(claudeRoot, { withFileTypes: true });
  } catch { /* no Claude transcripts on this machine */ }
  const slugIndex = buildClaudeSlugIndex();
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    const decoded =
      slugIndex.get(slug) ??
      sniffClaudeSlugCwd(claudeRoot, slug) ??
      (slug.startsWith('-') ? '/' + slug.slice(1).replace(/-/g, '/') : slug);
    try {
      const st = fs.statSync(decoded);
      if (!st.isDirectory()) continue;
    } catch { continue; }
    if (!isInitialized(decoded)) continue;
    // Use the newest .jsonl mtime in the slug dir as the activity signal.
    let lastTouched = 0;
    try {
      const files = fs.readdirSync(path.join(claudeRoot, slug), { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.toLowerCase().endsWith('.jsonl')) continue;
        try {
          const st = fs.statSync(path.join(claudeRoot, slug, f.name));
          if (st.mtimeMs > lastTouched) lastTouched = st.mtimeMs;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    candidates.push({ decoded, lastTouched });
  }
  candidates.sort((a, b) => b.lastTouched - a.lastTouched);
  return candidates[0]?.decoded ?? null;
}
