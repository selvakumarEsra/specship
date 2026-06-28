/**
 * Tier-A status-line cache: the producer (`writeStatuslineCache`) and the
 * reader (`readStatuslineCache`) for `.specship/statusline.json`.
 *
 * The producer is called from index/sync/watcher events where the database
 * is already open (REQ-STATUSLINE-003). The reader is called from the
 * `specship statusline` command and does a single `readFileSync` with no
 * database access (REQ-STATUSLINE-002).
 */

import { StatuslineCache } from './types';
import { statuslineCachePath, writeJsonAtomic, readJsonSafe } from './paths';

/** Fields the producer supplies; the writer stamps `v` and `updatedAt`. */
export type StatuslineCacheInput = Omit<StatuslineCache, 'v' | 'updatedAt'>;

/**
 * Atomically write the Tier-A cache. Best-effort: any failure (e.g.
 * read-only filesystem) is swallowed so a cache-write never breaks the
 * index/sync operation that triggered it.
 */
export function writeStatuslineCache(projectRoot: string, input: StatuslineCacheInput): void {
  const data: StatuslineCache = { v: 1, updatedAt: Date.now(), ...input };
  try {
    writeJsonAtomic(statuslineCachePath(projectRoot), data);
  } catch {
    /* best-effort producer — never throw into the indexer */
  }
}

/** Read the Tier-A cache, or null when absent/corrupt (caller degrades). */
export function readStatuslineCache(projectRoot: string): StatuslineCache | null {
  const c = readJsonSafe<StatuslineCache>(statuslineCachePath(projectRoot));
  return c && c.v === 1 ? c : null;
}
