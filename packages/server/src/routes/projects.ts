/**
 * GET /api/projects        — enumerate every project visible to Claude Code
 *                            (every dir under ~/.claude/projects/).
 * GET /api/projects/events  — SSE stream that pushes a refresh whenever the
 *                            watcher sees the project list change. Used by
 *                            the desktop UI's Project picker so newly opened
 *                            projects appear without a refresh.
 *
 * Why this lives in its own route file: the rest of the analytics endpoints
 * already read ~/.claude/projects/ via the ingest pipeline. This route adds
 * a *navigation* primitive on top of that data — "what projects does the
 * user have at all?" — without coupling to the specship instance.
 */

import { EventEmitter } from 'node:events';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { decodeProjectSlug } from '../ingest/ingestor.js';

export interface ProjectEntry {
  /** The encoded directory name under ~/.claude/projects/. Stable id. */
  slug: string;
  /** Decoded absolute path. May or may not still exist on disk. */
  path: string;
  /** Whether `path` still resolves to a real directory. */
  exists: boolean;
  /** Whether `path/.specship/` exists (i.e. `specship init` was run). */
  initialized: boolean;
  /** Count of `.jsonl` transcripts inside the project's claude dir. */
  sessionCount: number;
  /** Epoch ms of the newest transcript mtime (0 if none). */
  lastModifiedMs: number;
}

export interface ProjectsResponse {
  claudeRoot: string;
  projects: ProjectEntry[];
}

const projectsBus = new EventEmitter();
projectsBus.setMaxListeners(0); // many SSE subscribers + internal

export async function enumerate(claudeRoot: string): Promise<ProjectEntry[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(claudeRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ProjectEntry[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    const decoded = decodeProjectSlug(slug);
    const projDir = path.join(claudeRoot, slug);

    let sessionCount = 0;
    let lastModifiedMs = 0;
    try {
      const inside = await fs.readdir(projDir, { withFileTypes: true });
      for (const f of inside) {
        if (f.isFile() && f.name.toLowerCase().endsWith('.jsonl')) {
          sessionCount++;
          try {
            const stat = await fs.stat(path.join(projDir, f.name));
            if (stat.mtimeMs > lastModifiedMs) lastModifiedMs = stat.mtimeMs;
          } catch { /* ignore */ }
        }
      }
    } catch { /* project dir disappeared mid-scan — skip its files */ }

    let exists = false;
    let initialized = false;
    try {
      const st = await fs.stat(decoded);
      exists = st.isDirectory();
      if (exists) {
        try {
          const cg = await fs.stat(path.join(decoded, '.specship'));
          initialized = cg.isDirectory();
        } catch { /* not initialized — OK */ }
      }
    } catch { /* path missing — OK, still surface it so UI can flag it */ }

    out.push({ slug, path: decoded, exists, initialized, sessionCount, lastModifiedMs });
  }

  // Recent activity first; ties broken by path.
  out.sort((a, b) => {
    if (b.lastModifiedMs !== a.lastModifiedMs) return b.lastModifiedMs - a.lastModifiedMs;
    return a.path.localeCompare(b.path);
  });
  return out;
}

// --- Watcher (singleton across the process) ---------------------------------

let watcher: FSWatcher | null = null;
let lastSlugs = new Set<string>();
let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let watchedRoot: string | null = null;

function startWatcher(claudeRoot: string, verbose: boolean): void {
  if (watcher) return;
  watchedRoot = claudeRoot;
  try {
    watcher = watch(claudeRoot, { persistent: true }, () => {
      scheduleRescan(claudeRoot);
    });
    if (verbose) console.error(`[projects] watching ${claudeRoot}`);
    // Warm the cache so the first SSE snapshot has accurate state and the
    // first change diff is meaningful.
    void enumerate(claudeRoot).then((list) => {
      lastSlugs = new Set(list.map((p) => p.slug));
    });
  } catch (err) {
    if (verbose) console.error(`[projects] watch failed for ${claudeRoot}:`, err instanceof Error ? err.message : String(err));
    // Directory may not exist yet — that's OK, every /api/projects GET
    // returns [] until it does. We don't retry here; if the watcher is
    // critical the user can restart the server after creating it.
  }
}

function scheduleRescan(claudeRoot: string): void {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(async () => {
    debounceHandle = null;
    const list = await enumerate(claudeRoot);
    const newSlugs = new Set(list.map((p) => p.slug));
    const added: ProjectEntry[] = list.filter((p) => !lastSlugs.has(p.slug));
    const removed: string[] = [...lastSlugs].filter((s) => !newSlugs.has(s));
    lastSlugs = newSlugs;
    if (added.length || removed.length) {
      projectsBus.emit('change', { added, removed, list });
    }
    // Refresh is always emitted so subscribers can pick up lastModified /
    // sessionCount drift even without slug-level changes.
    projectsBus.emit('refresh', { list });
  }, 350);
}

function stopWatcher(): void {
  if (watcher) {
    try { watcher.close(); } catch { /* ignore */ }
    watcher = null;
  }
  if (debounceHandle) { clearTimeout(debounceHandle); debounceHandle = null; }
  watchedRoot = null;
}

// --- Route registration -----------------------------------------------------

export async function registerProjectsRoutes(app: FastifyInstance): Promise<void> {
  const claudeRoot = path.join(os.homedir(), '.claude', 'projects');
  startWatcher(claudeRoot, false);

  app.addHook('onClose', async () => { stopWatcher(); });

  app.get('/api/projects', async (): Promise<ProjectsResponse> => {
    return { claudeRoot, projects: await enumerate(claudeRoot) };
  });

  app.get('/api/projects/events', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    let closed = false;
    const onClose = () => {
      closed = true;
      projectsBus.off('change', onChange);
      projectsBus.off('refresh', onRefresh);
      clearInterval(hb);
    };
    req.raw.on('close', onClose);

    const writeEvent = (event: string, data: unknown): void => {
      if (closed) return;
      try {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch { /* socket gone */ closed = true; }
    };

    const initial = await enumerate(claudeRoot);
    lastSlugs = new Set(initial.map((p) => p.slug));
    writeEvent('snapshot', { claudeRoot, projects: initial });

    const onChange = (payload: { added: ProjectEntry[]; removed: string[]; list: ProjectEntry[] }) => {
      writeEvent('change', payload);
    };
    const onRefresh = (payload: { list: ProjectEntry[] }) => {
      writeEvent('refresh', payload);
    };
    projectsBus.on('change', onChange);
    projectsBus.on('refresh', onRefresh);

    // Heartbeat keeps proxies / NATs from dropping the idle connection.
    const hb = setInterval(() => {
      if (closed) { clearInterval(hb); return; }
      try { reply.raw.write(`: ping\n\n`); } catch { onClose(); }
    }, 30000);
  });
}

/** Test seam — re-export so __tests__ can stop the watcher between cases. */
export const _testing = { stopWatcher, watchedRoot: () => watchedRoot };
