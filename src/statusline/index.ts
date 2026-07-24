/**
 * SpecShip status-line segment — public entry (SHIP-STATUSLINE-DOC).
 *
 * `buildSegment` is the whole read path: it takes Claude Code's status-line
 * JSON (as a raw string), locates the project from `workspace.current_dir`,
 * reads the two cache files, and renders one line. It opens no database,
 * spawns no process, and never throws — every failure degrades to a minimal
 * valid line (REQ-STATUSLINE-001/002).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SPECSHIP_DIR } from '../directory';
import { readStatuslineCache } from './cache';
import { readSessionMarker } from './session-marker';
import { readActiveRun } from './active-run';
import { readUsageLimits, usageFromStatuslineInput, contextFromStatuslineInput, resolveCtxWarnPct } from './usage-limits';
import { recordSessionModel, detectModelTier } from '../mcp/model-context';
import { renderSegment } from './render';
import { selectStatuslineTip } from './tips';

export * from './types';
export { writeStatuslineCache } from './cache';
export type { StatuslineCacheInput } from './cache';
export { initSession, recordCall, readSessionMarker } from './session-marker';
export { writeActiveRun, clearActiveRun, readActiveRun } from './active-run';
export { renderSegment } from './render';

/**
 * Walk up from `startDir` to the nearest directory containing a `.specship/`
 * folder. Unlike `findNearestSpecShipRoot`, this does NOT require `specship.db`
 * to exist — the status-line reader is cache-based and must resolve the project
 * even when the database is absent or locked (REQ-STATUSLINE-002.A2).
 */
function findSpecShipRootForRead(startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (true) {
    try {
      if (fs.existsSync(path.join(current, SPECSHIP_DIR))) return current;
    } catch {
      /* unreadable — keep walking up */
    }
    if (current === root) return null;
    current = path.dirname(current);
  }
}

/** Pull the project directory Claude is in out of the status-line JSON. */
function projectDirFromInput(raw: string): string {
  try {
    const json = JSON.parse(raw) as { workspace?: { current_dir?: string }; cwd?: string };
    return json.workspace?.current_dir || json.cwd || process.cwd();
  } catch {
    return process.cwd();
  }
}

/**
 * Session identity from the status-line JSON (REQ-STATUSLINE-012): the model's
 * display name (falling back to its id) and the Claude Code version. Both null
 * when stdin is empty / unparseable / omits them — which is the signal to render
 * no header line at all (REQ-STATUSLINE-001.A2). Never throws.
 */
export function identityFromInput(raw: string): { model: string | null; version: string | null } {
  try {
    const json = JSON.parse(raw) as {
      model?: { display_name?: string; id?: string };
      version?: string;
    };
    const model = json.model?.display_name || json.model?.id || null;
    const version = typeof json.version === 'string' && json.version ? json.version : null;
    return { model, version };
  } catch {
    return { model: null, version: null };
  }
}

/** Abbreviate the user's home directory to `~` for the header's directory element. */
function abbreviateHome(dir: string): string {
  try {
    const home = os.homedir();
    if (home && (dir === home || dir.startsWith(home + path.sep))) {
      return '~' + dir.slice(home.length);
    }
  } catch {
    /* no home — show the path as-is */
  }
  return dir;
}

/**
 * Current git branch for the header (REQ-STATUSLINE-012), derived WITHOUT
 * spawning a process (REQ-STATUSLINE-002): walk up from `startDir` to the
 * nearest `.git`, follow a linked-worktree `.git` file's `gitdir:` pointer, and
 * read `HEAD`. Returns the branch for a `ref: refs/heads/…` HEAD, a short SHA
 * for a detached HEAD, and null when not inside a git repo (or on any error —
 * this never throws).
 */
export function readGitBranch(startDir: string): string | null {
  try {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;
    let gitEntry: string | null = null;
    while (true) {
      const candidate = path.join(dir, '.git');
      if (fs.existsSync(candidate)) {
        gitEntry = candidate;
        break;
      }
      if (dir === root) return null;
      dir = path.dirname(dir);
    }

    // Resolve the real git directory. A normal repo has a `.git` directory; a
    // linked worktree (or submodule) has a `.git` FILE holding `gitdir: <path>`.
    let gitDir: string;
    const stat = fs.statSync(gitEntry);
    if (stat.isDirectory()) {
      gitDir = gitEntry;
    } else {
      const pointer = fs.readFileSync(gitEntry, 'utf-8').trim();
      const m = /^gitdir:\s*(.+)$/.exec(pointer);
      const target = m?.[1];
      if (!target) return null;
      gitDir = path.isAbsolute(target) ? target : path.resolve(dir, target);
    }

    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref?.[1]) return ref[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7); // detached HEAD
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the segment line from Claude Code's raw stdin JSON. Always returns a
 * single line; never throws.
 *
 * @param rawStdin  The status-line JSON string Claude Code pipes in.
 * @param noColor   Whether to strip ANSI (defaults to honoring `NO_COLOR`).
 */
export function buildSegment(rawStdin: string, noColor = !!process.env.NO_COLOR): string {
  const projectDir = projectDirFromInput(rawStdin);
  let root: string | null = null;
  try {
    root = findSpecShipRootForRead(projectDir);
  } catch {
    root = null;
  }

  // Context header (REQ-STATUSLINE-012): render only when stdin identifies the
  // session (a model or version is present). Empty/unparseable stdin → null →
  // no header line, so the degraded path stays a single line (REQ-STATUSLINE-001.A2).
  const { model, version } = identityFromInput(rawStdin);
  const header =
    model || version
      ? { model, dir: abbreviateHome(projectDir), branch: readGitBranch(projectDir), version }
      : null;

  // Record the session's model so the MCP server can compact its output for
  // lower tiers (MODCTX-DOC, REQ-MODCTX-001). Write-on-change only; failure
  // never affects the rendered line.
  if (root && model) recordSessionModel(root, model);

  // Model-compaction indicator (REQ-MODCTX-005): resolve the tier through the
  // SAME chain the MCP server uses (marker + SPECSHIP_MODEL/SPECSHIP_COMPACT),
  // so the user-facing element only appears when compaction is actually
  // active. Any resolution failure drops the element, never the line (A5).
  let compact: 'haiku' | 'sonnet' | null = null;
  if (root) {
    try {
      const tier = detectModelTier(root);
      if (tier !== 'full') compact = tier;
    } catch {
      compact = null;
    }
  }

  // Usage limits are account-wide (not per-project), so resolve them regardless
  // of whether we found a SpecShip project. Primary source is Claude's own
  // status-line `rate_limits` on stdin (real, includes reset times); an external
  // file is an optional override for setups where stdin lacks them. `now`
  // formats reset times in local time.
  const usage = usageFromStatuslineInput(rawStdin) ?? readUsageLimits();
  const now = Date.now();
  // Context-usage element (REQ-STATUSLINE-009) — from the same stdin.
  const context = contextFromStatuslineInput(rawStdin);
  const ctxWarnPct = resolveCtxWarnPct();

  // Rotating usage tip (REQ-STATUSLINE-013): shown by default, silenced by the
  // `SPECSHIP_NO_STATUSLINE_TIPS` opt-out (matching `SPECSHIP_NO_CHEATSHEET`).
  // Gated on `header` — i.e. an identified session — so empty/unparseable stdin
  // renders no tip and the degraded output stays a single line (A5 / 001.A2).
  // Time-bucketed from `now` so the tip is deterministic and non-flickery (A2).
  const tip = header && !process.env.SPECSHIP_NO_STATUSLINE_TIPS ? selectStatuslineTip(now) : null;

  if (!root) {
    // No SpecShip project here — render the idle degraded line (still with the
    // header when stdin identified the session).
    return renderSegment({ cache: null, marker: null, run: null, usage, now, context, ctxWarnPct, noColor, header, tip });
  }

  return renderSegment({
    cache: readStatuslineCache(root),
    marker: readSessionMarker(root),
    run: readActiveRun(root),
    usage,
    now,
    context,
    ctxWarnPct,
    noColor,
    header,
    tip,
    compact,
  });
}
