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
import * as path from 'path';
import { SPECSHIP_DIR } from '../directory';
import { readStatuslineCache } from './cache';
import { readSessionMarker } from './session-marker';
import { readActiveRun } from './active-run';
import { readUsageLimits, usageFromStatuslineInput } from './usage-limits';
import { renderSegment } from './render';

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
 * Build the segment line from Claude Code's raw stdin JSON. Always returns a
 * single line; never throws.
 *
 * @param rawStdin  The status-line JSON string Claude Code pipes in.
 * @param noColor   Whether to strip ANSI (defaults to honoring `NO_COLOR`).
 */
export function buildSegment(rawStdin: string, noColor = !!process.env.NO_COLOR): string {
  let root: string | null = null;
  try {
    root = findSpecShipRootForRead(projectDirFromInput(rawStdin));
  } catch {
    root = null;
  }

  // Usage limits are account-wide (not per-project), so resolve them regardless
  // of whether we found a SpecShip project. Primary source is Claude's own
  // status-line `rate_limits` on stdin (real, includes reset times); an external
  // file is an optional override for setups where stdin lacks them. `now`
  // formats reset times in local time.
  const usage = usageFromStatuslineInput(rawStdin) ?? readUsageLimits();
  const now = Date.now();

  if (!root) {
    // No SpecShip project here — render the idle degraded line.
    return renderSegment({ cache: null, marker: null, run: null, usage, now, noColor });
  }

  return renderSegment({
    cache: readStatuslineCache(root),
    marker: readSessionMarker(root),
    run: readActiveRun(root),
    usage,
    now,
    noColor,
  });
}
