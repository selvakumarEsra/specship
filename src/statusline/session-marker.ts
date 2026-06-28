/**
 * Tier-B session marker (REQ-STATUSLINE-004).
 *
 * Scoped to one MCP-server process lifetime: Claude Code spawns one MCP
 * server per session, so "calls since this server initialized the marker" is
 * the session's specship-call count. `initSession` resets it once at server
 * start; `recordCall` increments it at the tool-dispatch chokepoint; the
 * status-line reader reads it with `readSessionMarker`.
 *
 * Every write is best-effort and swallows errors — recording a call must
 * never block or fail the underlying tool call (REQ-STATUSLINE-004.A3).
 */

import { SessionMarker } from './types';
import { sessionMarkerPath, writeJsonAtomic, readJsonSafe } from './paths';

/** Per-process guard so a re-attached code graph doesn't reset the count mid-session. */
let sessionStarted = false;

/**
 * Reset the marker to a fresh session (calls: 0). Called once when the MCP
 * server attaches its code graph. Idempotent within a process: subsequent
 * calls are no-ops so the running count is preserved.
 */
export function initSession(projectRoot: string): void {
  if (sessionStarted) return;
  sessionStarted = true;
  const marker: SessionMarker = { v: 1, startedAt: Date.now(), calls: 0, lastTool: null, lastAt: null };
  try {
    writeJsonAtomic(sessionMarkerPath(projectRoot), marker);
  } catch {
    /* best-effort */
  }
}

/**
 * Increment the call count and record the tool name. Reads the current
 * marker (or starts a fresh one if absent) and writes it back atomically.
 * Never throws.
 */
export function recordCall(projectRoot: string, toolName: string): void {
  try {
    const cur = readJsonSafe<SessionMarker>(sessionMarkerPath(projectRoot));
    const base: SessionMarker = cur && cur.v === 1
      ? cur
      : { v: 1, startedAt: Date.now(), calls: 0, lastTool: null, lastAt: null };
    const next: SessionMarker = {
      ...base,
      calls: base.calls + 1,
      lastTool: toolName,
      lastAt: Date.now(),
    };
    writeJsonAtomic(sessionMarkerPath(projectRoot), next);
  } catch {
    /* best-effort — a failed marker write must not affect the tool call */
  }
}

/** Read the session marker, or null when absent/corrupt. */
export function readSessionMarker(projectRoot: string): SessionMarker | null {
  const m = readJsonSafe<SessionMarker>(sessionMarkerPath(projectRoot));
  return m && m.v === 1 ? m : null;
}

/** Test-only: reset the per-process started guard. */
export function __resetSessionGuardForTests(): void {
  sessionStarted = false;
}
