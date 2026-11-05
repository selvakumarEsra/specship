/**
 * Filesystem watcher that re-runs the ingestor on transcript changes, one
 * watched root per transcript adapter (REQ-AGENTSWITCH-004).
 *
 * Strategy:
 *   - One initial full pass on start (catches everything written while the
 *     watcher wasn't running — same offset state, no duplicates).
 *   - fs.watch on each adapter's transcript root, debounced 300ms — agents
 *     write a session incrementally, so we don't want to re-ingest on every
 *     keystroke.
 *   - On change, re-run ingestAll. The state table makes this cheap: only
 *     new bytes are read + parsed.
 */

import * as fs from 'fs';
import type { IngestDb, IngestOptions } from './ingestor.js';
import { ingestAll, resolveIngestRoots } from './ingestor.js';

export interface WatcherHandle {
  stop: () => void;
  /** Run one ingest pass synchronously; useful for `specship claude ingest`. */
  ingestNow: () => ReturnType<typeof ingestAll>;
}

export interface WatcherOptions extends IngestOptions {
  /** Debounce ms before running ingest after a change. Default 300. */
  debounceMs?: number;
  /** Run an initial ingest pass on start. Default true. */
  initialIngest?: boolean;
}

export function startWatcher(db: IngestDb, options: WatcherOptions = {}): WatcherHandle {
  const debounceMs = options.debounceMs ?? 300;
  const verbose = options.verbose ?? false;
  // One root per transcript adapter (REQ-AGENTSWITCH-004).
  const targets = resolveIngestRoots(options);

  let pending: NodeJS.Timeout | null = null;
  const triggerSoon = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      try {
        ingestAll(db, options);
      } catch (err) {
        if (verbose) {
          // eslint-disable-next-line no-console
          console.error('[ingest watcher] pass failed:', err instanceof Error ? err.message : String(err));
        }
      }
    }, debounceMs);
  };

  // Initial pass.
  if (options.initialIngest !== false) {
    triggerSoon();
  }

  // fs.watch each adapter's root, recursive. On macOS + Linux this gives us
  // per-file events; on Windows the recursive flag is supported as of recent Node.
  const watchers: fs.FSWatcher[] = [];
  for (const { adapter, root } of targets) {
    try {
      watchers.push(fs.watch(root, { recursive: true, persistent: true }, (_eventType, filename) => {
        if (!filename) return;
        if (!adapter.watches(filename.toString())) return;
        triggerSoon();
      }));
    } catch (err) {
      // Directory doesn't exist (the agent was never used here) — just no-op.
      if (verbose) {
        // eslint-disable-next-line no-console
        console.error('[ingest watcher] could not watch', root, ':', err instanceof Error ? err.message : String(err));
      }
    }
  }

  return {
    stop: () => {
      if (pending) { clearTimeout(pending); pending = null; }
      for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
    },
    ingestNow: () => ingestAll(db, options),
  };
}
