/**
 * ProjectRegistry — lazy-opens and caches SpecShip instances per project
 * path, keyed by absolute path. LRU evicts when the cache exceeds maxOpen
 * so a long-running server doesn't hold every project's SQLite handle
 * forever.
 *
 * Used by the Fastify routes (via `app.activeCg(req)`) to back the desktop
 * app's project picker: when the user switches projects in the UI, the
 * specship-scoped surfaces (graph, specs, drift, workflows, status) start
 * reading from the matching instance — opened on demand if it isn't
 * already cached.
 *
 * Analytics endpoints (`/api/claude/*`, `/api/memory`) read from a single
 * "primary" instance instead, since their data (JSONL ingest, CLAUDE.md
 * hierarchy) is global to the user, not scoped to one project.
 */

import { createSlugResolver } from './ingest/project-paths.js';

type SpecShipInstance = Awaited<ReturnType<typeof import('@specship/specship').SpecShip.open>>;

interface CacheEntry {
  cg: SpecShipInstance;
  lastAccess: number;
}

export interface ProjectRegistryOptions {
  /** Cap on concurrently-open instances. Default 5. */
  maxOpen?: number;
  /** Log open/evict events to stderr. */
  verbose?: boolean;
  /**
   * Injected loader (so tests can mock SpecShip.open). Defaults to the
   * real `@specship/specship` import resolved the same way the
   * server itself resolves it.
   */
  openImpl?: (projectPath: string) => Promise<SpecShipInstance>;
  /**
   * Injected slug→path resolver (so tests can pin claude.json / claudeRoot).
   * Defaults to the real resolver over `~/.claude.json` + transcript cwds
   * (REQ-SLUGRES-003).
   */
  resolveSlug?: (slug: string) => string;
}

export class ProjectRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pinned = new Set<string>();
  private readonly maxOpen: number;
  private readonly verbose: boolean;
  private readonly openImpl: (projectPath: string) => Promise<SpecShipInstance>;
  private readonly resolveSlug: (slug: string) => string;

  constructor(opts: ProjectRegistryOptions, defaultOpenImpl: (projectPath: string) => Promise<SpecShipInstance>) {
    this.maxOpen = opts.maxOpen ?? 5;
    this.verbose = opts.verbose ?? false;
    this.openImpl = opts.openImpl ?? defaultOpenImpl;
    this.resolveSlug = opts.resolveSlug ?? createSlugResolver();
  }

  /**
   * Return the cached SpecShip for `projectPath`, opening it on demand.
   * Returns null when the path isn't initialized (no `.specship/`) or
   * the open throws — callers surface a friendly UI error.
   */
  async get(projectPath: string): Promise<SpecShipInstance | null> {
    const existing = this.cache.get(projectPath);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing.cg;
    }
    try {
      const cg = await this.openImpl(projectPath);
      this.cache.set(projectPath, { cg, lastAccess: Date.now() });
      this.evictIfNeeded();
      if (this.verbose) console.error(`[registry] opened ${projectPath} (cache size ${this.cache.size})`);
      return cg;
    } catch (err) {
      if (this.verbose) console.error(`[registry] open failed for ${projectPath}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Look up by Claude Code's slug-encoded project name
   * (`-Users-alice-foo` → `/Users/alice/foo`).
   */
  async getBySlug(slug: string): Promise<SpecShipInstance | null> {
    return this.get(this.resolveSlug(slug));
  }

  /** Currently-cached project paths (most-recent-access first). */
  openPaths(): string[] {
    return [...this.cache.entries()]
      .sort((a, b) => b[1].lastAccess - a[1].lastAccess)
      .map(([k]) => k);
  }

  has(projectPath: string): boolean { return this.cache.has(projectPath); }

  /**
   * Exempt `projectPath` from LRU eviction. The server pins its primary:
   * routes capture the primary instance by reference (`app.primaryCg`), so
   * an eviction CLOSES a handle they still use and every request 500s with
   * "database connection is not open". Surfaced when the /api/events sweep
   * started opening many projects through this cache.
   */
  pin(projectPath: string): void { this.pinned.add(projectPath); }

  /** Close + drop every cached instance. Called on server shutdown. */
  closeAll(): void {
    for (const [, v] of this.cache) {
      try { v.cg.close(); } catch { /* ignore */ }
    }
    this.cache.clear();
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxOpen) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of this.cache) {
      if (this.pinned.has(k)) continue; // never close a pinned instance
      if (v.lastAccess < oldestTime) {
        oldestTime = v.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        try { entry.cg.close(); } catch { /* ignore */ }
      }
      this.cache.delete(oldestKey);
      if (this.verbose) console.error(`[registry] evicted ${oldestKey}`);
    }
  }
}

export type { SpecShipInstance };
