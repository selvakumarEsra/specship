/**
 * Cache-file paths + a tiny atomic JSON writer for the status-line segment.
 *
 * Kept self-contained (no import from the installer or DB layers) so the
 * read path can pull these helpers without dragging in heavy dependencies —
 * the status line re-renders sub-second and must stay cheap (REQ-STATUSLINE-002).
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSpecShipDir } from '../directory';

/** `.specship/statusline.json` — Tier-A index-state cache. */
export function statuslineCachePath(projectRoot: string): string {
  return path.join(getSpecShipDir(projectRoot), 'statusline.json');
}

/** `.specship/session/marker.json` — per-session call marker. */
export function sessionMarkerPath(projectRoot: string): string {
  return path.join(getSpecShipDir(projectRoot), 'session', 'marker.json');
}

/** `.specship/session/active-run.json` — current workflow run. */
export function activeRunPath(projectRoot: string): string {
  return path.join(getSpecShipDir(projectRoot), 'session', 'active-run.json');
}

/**
 * Atomic JSON write (temp-file + rename) so a concurrent status-line read
 * never observes a half-written file (REQ-STATUSLINE-003.A3). Creates the
 * parent directory if missing. Errors propagate to the caller, which is
 * always a best-effort producer that swallows them.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Read + parse a small JSON cache file. Returns null on any failure
 * (missing, unreadable, corrupt, wrong shape) — the read path treats every
 * failure as "no data" and degrades, never throws (REQ-STATUSLINE-002.A2).
 */
export function readJsonSafe<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
