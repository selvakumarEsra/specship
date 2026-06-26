/**
 * Helpers used by the Claude target implementation.
 *
 * Historically these were shared across multiple `AgentTarget`
 * implementations (Cursor, Codex, opencode, …); the fork is
 * Claude-only now, but the helpers are kept in their own file so the
 * Claude target stays focused on Claude-specific layout.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * The MCP-server config block specship injects into Claude's MCP
 * config (`~/.claude.json` or `./.mcp.json`).
 */
export function getMcpServerConfig(): { type: string; command: string; args: string[] } {
  return {
    type: 'stdio',
    command: 'specship',
    args: ['serve', '--mcp'],
  };
}

/**
 * Permissions list for Claude `settings.json`. Permission strings
 * follow Claude's `mcp__<server>__<tool>` format.
 */
export function getSpecShipPermissions(): string[] {
  return [
    'mcp__specship__specship_explore',
    'mcp__specship__specship_search',
    'mcp__specship__specship_node',
    'mcp__specship__specship_callers',
    'mcp__specship__specship_callees',
    'mcp__specship__specship_impact',
    'mcp__specship__specship_files',
    'mcp__specship__specship_status',
    // Harness read tools (MAINT-DOC / FITNESS-DOC) — read-only analysis the
    // agent may run while exploring, so auto-allow to avoid a prompt.
    'mcp__specship__specship_maintainability',
    'mcp__specship__specship_fitness',
    // Designer tools (vendored from @pro-vi/designer) — the design loop is
    // human-driven, so auto-allow to avoid a prompt on every taste iteration.
    'mcp__specship__designer_session',
    'mcp__specship__designer_prompt',
    'mcp__specship__designer_ask',
    'mcp__specship__designer_list',
    'mcp__specship__designer_snapshot',
    'mcp__specship__designer_handoff',
  ];
}

/**
 * Read a JSON file, returning `{}` when missing or unparseable.
 *
 * Unparseable files are backed up to `<path>.backup` BEFORE we return
 * `{}` — so an idempotent re-run never silently deletes a user's
 * existing config that happened to break JSON parse temporarily.
 */
export function readJsonFile(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: Could not parse ${path.basename(filePath)}: ${msg}`);
    console.warn(`  A backup will be created before overwriting.`);
    try {
      fs.copyFileSync(filePath, filePath + '.backup');
    } catch { /* ignore backup failure */ }
    return {};
  }
}

/**
 * Write a file atomically: write to `<path>.tmp.<pid>`, then rename.
 *
 * Prevents corruption if the process crashes mid-write. The temp
 * file is cleaned up on rename failure.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Atomic JSON write. Trailing newline matches the convention every
 * existing target had — preserves diff-friendly file shape.
 */
export function writeJsonFile(filePath: string, data: Record<string, any>): void {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Compare two JSON values for deep equality, ignoring key order.
 *
 * Used for idempotency: when the on-disk config already exactly
 * matches what we'd write, return action=`unchanged` instead of
 * re-writing (and emitting a confusing "Updated" log line).
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  if (!ak.every((k, i) => k === bk[i])) return false;
  return ak.every((k) => jsonDeepEqual(ao[k], bo[k]));
}

/**
 * Insert or update a marker-delimited block in a markdown-ish file,
 * idempotently. `block` is the full text including its start/end markers.
 *
 * - File missing → create it with the block. Returns `created`.
 * - Markers present → replace the region between them (inclusive) with `block`.
 *   Returns `unchanged` if the result is byte-identical, else `updated`.
 * - Markers absent → append the block after existing content (blank-line
 *   separated). Returns `updated`.
 *
 * Used to write the spec-driven-development steering rule into CLAUDE.md
 * without disturbing the user's surrounding content (SDD-INSTALL-DOC).
 */
export function upsertMarkedSection(
  filePath: string,
  startMarker: string,
  endMarker: string,
  block: string,
): 'created' | 'updated' | 'unchanged' {
  const exists = fs.existsSync(filePath);
  let content = '';
  if (exists) {
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { content = ''; }
  }

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx !== -1 && endIdx > startIdx) {
    const replaced =
      content.substring(0, startIdx) + block + content.substring(endIdx + endMarker.length);
    if (replaced === content) return 'unchanged';
    atomicWriteFileSync(filePath, replaced);
    return 'updated';
  }

  if (!exists || content.trim() === '') {
    atomicWriteFileSync(filePath, block + '\n');
    return exists ? 'updated' : 'created';
  }
  atomicWriteFileSync(filePath, content.replace(/\s*$/, '') + '\n\n' + block + '\n');
  return 'updated';
}

/**
 * Strip a marker-delimited section from a markdown-ish file. Used by
 * the Claude target's uninstall to remove a legacy `## SpecShip` block
 * a pre-#529 install wrote into CLAUDE.md (between
 * `<!-- SPECSHIP_START -->` / `<!-- SPECSHIP_END -->`). If the file
 * becomes empty after removal, delete it.
 *
 * Returns `removed` when content was stripped, `not-found` when
 * the markers weren't present, `kept` when the file didn't exist.
 */
export function removeMarkedSection(
  filePath: string,
  startMarker: string,
  endMarker: string,
): 'removed' | 'not-found' | 'kept' {
  if (!fs.existsSync(filePath)) return 'kept';

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return 'kept';
  }

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx <= startIdx) return 'not-found';

  const before = content.substring(0, startIdx).trimEnd();
  const after = content.substring(endIdx + endMarker.length).trimStart();
  const joined = before + (before && after ? '\n\n' : '') + after;

  if (joined.trim() === '') {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  } else {
    atomicWriteFileSync(filePath, joined.trim() + '\n');
  }
  return 'removed';
}
