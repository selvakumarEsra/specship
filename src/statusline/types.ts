/**
 * Shared types for the SpecShip status-line segment (SHIP-STATUSLINE-DOC).
 *
 * Two cache files back the segment so the read path never opens SQLite:
 *   - `.specship/statusline.json`        — Tier-A index state (this file's
 *     {@link StatuslineCache}); refreshed by index/sync/watcher events.
 *   - `.specship/session/marker.json`    — Tier-B per-session call data
 *     ({@link SessionMarker}); owned by the MCP server process.
 *   - `.specship/session/active-run.json`— the in-flight workflow run
 *     ({@link ActiveRun}); written by the workflow executor.
 *
 * All three are tiny JSON blobs read with a single `readFileSync` each.
 */

/** Tier-A index state. Mirrors the fields `specship status --json` exposes. */
export interface StatuslineCache {
  /** Schema version, so a future shape change is detectable on read. */
  v: 1;
  /** Whether the project is initialized (has an index). */
  initialized: boolean;
  /** ms epoch when this cache was written. */
  updatedAt: number;
  /** Pending file changes not yet synced into the index. */
  pending: { added: number; modified: number; removed: number };
  /** Count of spec→code links in a drifted/broken/orphaned state. */
  drift: number;
  /** Active SQLite backend, e.g. `better-sqlite3` (native) or `node-sqlite` (built-in). */
  backend: string;
  /**
   * Whether the DB is on a degraded/slow path — a non-WAL journal, where reads
   * can block on writes (network mounts, WSL2 /mnt, or the wasm fallback). This
   * is the runtime "backend health" warning the segment surfaces.
   */
  degraded: boolean;
  /** Indexed file count. */
  fileCount: number;
  /** Indexed node count. */
  nodeCount: number;
  /** ms epoch of the last full index, or null if never. */
  lastIndexed: number | null;
}

/** Tier-B per-session call data, scoped to one MCP-server process lifetime. */
export interface SessionMarker {
  v: 1;
  /** ms epoch when this server process initialized the marker. */
  startedAt: number;
  /** Number of specship tool calls handled since {@link startedAt}. */
  calls: number;
  /** Name of the most recently invoked tool, or null before the first call. */
  lastTool: string | null;
  /** ms epoch of the most recent call, or null before the first call. */
  lastAt: number | null;
}

/**
 * A single rolling-window usage limit, as written by the external usage tool
 * (REQ-STATUSLINE-008). SpecShip never computes these — it reflects the file.
 */
export interface UsageWindow {
  /** 0-100, percent of this window's capacity consumed (Claude's `used_percentage`). */
  pctUsed: number;
  /** ms epoch when this window resets (from `resets_at` epoch-s / the file's ISO `resetAt`). */
  resetAt: number;
}

/**
 * Validated usage-limit data. The primary source is Claude Code's status-line
 * stdin `rate_limits` object; an external file (`$SPECSHIP_USAGE_FILE` /
 * `~/.specship/usage-limits.json`) is an optional override. Either window may be
 * independently absent (the docs note `five_hour`/`seven_day` can each be
 * missing); a window is `null` when its data isn't present. The whole object is
 * null when neither window is available, and the segment omits the sub-segment.
 */
export interface UsageLimits {
  /** The 5-hour rolling session window, or null when absent. */
  session: UsageWindow | null;
  /** The weekly (7-day) window, or null when absent. */
  weekly: UsageWindow | null;
}

/**
 * Remaining-time estimate embedded in the run marker (REQ-STATUSLINE-011).
 * Computed by the executor at marker-write time (WORKFLOW-ETA-DOC), so the
 * render path never opens the DB. Absent when no estimate exists.
 */
export type ActiveRunEta =
  | { kind: 'range'; lowMs: number; highMs: number }
  | { kind: 'waiting'; sinceMs?: number };

/** The active (or most recent) workflow run for the project. */
export interface ActiveRun {
  v: 1;
  /** The spec ID the run targets, e.g. `REQ-STATUSLINE-001`. */
  specId: string | null;
  /** Run lifecycle status, e.g. `running`, `awaiting-approval`, `completed`, `failed`. */
  status: string;
  /** ms epoch of the last status change. */
  updatedAt: number;
  /** Remaining-time estimate, when one exists (REQ-STATUSLINE-011). */
  eta?: ActiveRunEta;
}
