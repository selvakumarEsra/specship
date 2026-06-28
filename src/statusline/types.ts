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

/** The active (or most recent) workflow run for the project. */
export interface ActiveRun {
  v: 1;
  /** The spec ID the run targets, e.g. `REQ-STATUSLINE-001`. */
  specId: string | null;
  /** Run lifecycle status, e.g. `running`, `awaiting-approval`, `completed`, `failed`. */
  status: string;
  /** ms epoch of the last status change. */
  updatedAt: number;
}
