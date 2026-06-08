/**
 * Filesystem watcher that re-runs the ingestor on JSONL changes.
 *
 * Strategy:
 *   - One initial full pass on start (catches everything written while the
 *     watcher wasn't running — same offset state, no duplicates).
 *   - fs.watch on the ~/.claude/projects/ tree, debounced 300ms — Claude
 *     Code writes one line at a time during a session, so we don't want to
 *     re-ingest on every keystroke.
 *   - On change, re-run ingestAll. The state table makes this cheap: only
 *     new bytes are read + parsed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IngestDb, IngestOptions } from './ingestor.js';
import { ingestAll } from './ingestor.js';

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
  const claudeRoot = options.claudeRoot ?? path.join(os.homedir(), '.claude', 'projects');
  const debounceMs = options.debounceMs ?? 300;
  const verbose = options.verbose ?? false;

  let pending: NodeJS.Timeout | null = null;
  const triggerSoon = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      try {
        ingestAll(db, { ...options, claudeRoot });
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

  // fs.watch on the root, recursive. On macOS + Linux this gives us per-file
  // events; on Windows the recursive flag is supported as of recent Node.
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(claudeRoot, { recursive: true, persistent: true }, (eventType, filename) => {
      if (!filename) return;
      const f = filename.toString();
      if (!f.toLowerCase().endsWith('.jsonl')) return;
      triggerSoon();
    });
  } catch (err) {
    // Directory doesn't exist (user hasn't run Claude Code) — just no-op.
    if (verbose) {
      // eslint-disable-next-line no-console
      console.error('[ingest watcher] could not watch', claudeRoot, ':', err instanceof Error ? err.message : String(err));
    }
  }

  return {
    stop: () => {
      if (pending) { clearTimeout(pending); pending = null; }
      if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
    },
    ingestNow: () => ingestAll(db, { ...options, claudeRoot }),
  };
}
