/**
 * Fastify HTTP server for specship + SpecShip Desktop UI.
 *
 * Routes follow the design spec — `/api/graph/*`, `/api/spec/*`,
 * `/api/drift`, `/api/workflows/*`, `/api/claude/*`. Each route group lives
 * in its own file under `./routes/` and registers itself on a passed
 * Fastify instance.
 *
 * Why Fastify: lighter than Express, faster, first-class TypeScript types,
 * built-in JSON schema validation, plugins for CORS + SSE. The 30K LoC
 * Archon UI port pulls ~20+ API routes — Fastify's plugin model keeps the
 * registration code tidy.
 */

import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { startWatcher, primaryProjectMatcher, type WatcherHandle } from './ingest/index.js';
import { backfillDisplaced } from './ingest/impact-backfill.js';
import { recostUnpricedPrompts } from './ingest/pricing-backfill.js';
import { ProjectRegistry, type SpecShipInstance } from './project-registry.js';
import { makeStaticHandler, isAssetPath } from './static-handler.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerSpecRoutes } from './routes/spec.js';
import { registerWorkflowRoutes } from './routes/workflow.js';
import { registerClaudeRoutes } from './routes/claude.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerReflectRoutes } from './routes/reflect.js';
import { registerMaintainabilityRoutes } from './routes/maintainability.js';
import { registerDomainRoutes } from './routes/domain.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerConfigRoutes } from './routes/config.js';
import { readServerConfig } from './server-config.js';

export interface ServerOptions {
  /**
   * "Primary" project path — opened at boot, hosts the cross-project
   * analytics SQLite (claude_sessions, claude_prompts, claude_tool_calls)
   * and the JSONL ingest watcher. Specship-scoped routes default to this
   * project when no `?project=<slug>` is provided.
   *
   * When omitted, the server boots projectless: specship-scoped surfaces
   * (status, graph, specs, drift, workflows, memory) wait for the user to
   * pick one via the desktop UI's project picker, and analytics endpoints
   * return 409 until a primary is assigned (the CLI auto-picks one based on
   * recency before getting here in most cases).
   */
  projectRoot?: string;
  /** Host to bind. Default '127.0.0.1' — loopback only. */
  host?: string;
  /** Port to bind. Default 4242. */
  port?: number;
  /** Allow CORS for the Vite dev server (http://localhost:5173). Default true. */
  cors?: boolean;
  /**
   * Start the Claude Code JSONL transcript ingest watcher in-process.
   * Default true — the analytics pages are useless without it. Pass false
   * to skip (e.g. when an external process already runs the watcher
   * against the same DB).
   */
  ingest?: boolean;
  /**
   * Pre-existing watcher handle, if the caller already started one. When
   * provided, `ingest` is ignored and the handle is reused. Kept for
   * callers (like the specship CLI) that own the watcher's lifecycle.
   */
  watcher?: WatcherHandle | null;
  /** Verbose logging. */
  verbose?: boolean;
  /**
   * Directory containing the built desktop SPA (`index.html` + assets, the
   * `ui/` module's `dist/`). When set, the server serves the SPA's files and
   * falls back to `index.html` for any non-API, non-asset GET (so client-side
   * routes like `/memory` work on direct page loads). The SPA is the dashboard's
   * only surface (REQ-DESKTOP-033 — the server-rendered dashboard retired).
   *
   * Leave `undefined` to auto-detect the SPA shipped alongside the server
   * build (`resolveDefaultWebDir()` — the bundle's `dist/ui/`, or the
   * workspace's `ui/dist/`). Pass `null` to serve no SPA at all (API only) —
   * the `specship serve --ui --no-web` CLI does this to run headless.
   */
  webDir?: string | null;
}

export interface ServerHandle {
  app: FastifyInstance;
  url: string;
  port: number;
  host: string;
  stop: () => Promise<void>;
}

/**
 * Lazy-import the specship core. Two delivery shapes are supported:
 *
 *   1. **Bundled** — the platform-specific npm tarball lays the compiled
 *      server out at `<bundle>/lib/dist/server/server.js` and the specship
 *      core at `<bundle>/lib/dist/index.js`. We try this relative path
 *      first so the bundled mode never depends on Node's package
 *      resolution finding `@specship/specship` (it won't, the
 *      bundle stages a single package by name `@specship/specship`).
 *
 *   2. **Workspace / dev** — `server/dist/server.js` imports via
 *      the workspace `file:..` dep. Falls through to the named import.
 *
 * The function caches the resolved module so the lookup only runs once.
 */
/**
 * Locate the built desktop SPA (REQ-DESKTOP-017.A1) when the caller didn't
 * pass an explicit `webDir`. Two delivery shapes, probed relative to this
 * file so cwd never matters:
 *
 *   1. **Bundled** — `build-server-bundle.mjs` copies `ui/dist/**` to the
 *      root `dist/ui/`, which the platform tarball ships as
 *      `<bundle>/lib/dist/ui/` next to `dist/server/` (this file).
 *   2. **Workspace / dev** — `server/{src,dist}/server.*` →
 *      repo root → `ui/dist/` (present only after `cd ui && npm run build`).
 *
 * Returns null when neither exists — the server then simply has no SPA
 * mount, same as `webDir: null`.
 */
export function resolveDefaultWebDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'ui'), // bundled: dist/server → dist/ui
    path.resolve(here, '..', '..', 'ui', 'dist'), // workspace: server/dist → <root>/ui/dist
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

let cachedSpecShip: typeof import('@specship/specship') | null = null;
async function loadSpecShip(): Promise<typeof import('@specship/specship')> {
  if (cachedSpecShip) return cachedSpecShip;
  // Bundled mode: dist/server/server.js → ../index.js (root dist/index.js).
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(here, '..', 'index.js');
    if (existsSync(candidate)) {
      cachedSpecShip = (await import(pathToFileURL(candidate).href)) as typeof import('@specship/specship');
      return cachedSpecShip;
    }
  } catch { /* fall through */ }
  // Workspace/dev: resolve via the named dep.
  cachedSpecShip = await import('@specship/specship');
  return cachedSpecShip;
}

export async function createServer(options: ServerOptions): Promise<ServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4242;
  const verbose = options.verbose ?? false;

  const app = Fastify({
    logger: verbose
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
      : false,
  });

  if (options.cors !== false) {
    // Permissive CORS for local dev. The server is bound to loopback by
    // default, so the broad allowlist is fine — Browsers won't get to it
    // from a non-localhost origin without explicit user override.
    await app.register(cors, {
      origin: true,
      credentials: false,
    });
  }

  // Lazy-load specship. Used as the open() impl for the registry, and
  // (only when a primary path is set) to open the primary instance below.
  const cgMod = await loadSpecShip();
  // maxOpen must exceed the /api/events cross-project sweep size (10) plus
  // the primary and a user-picked project, or the sweep churns open/close
  // cycles through the LRU on every poll.
  const registry = new ProjectRegistry({ verbose, maxOpen: 16 }, (p) => cgMod.SpecShip.open(p));

  // Primary project (optional). When set, specship-scoped routes default to
  // it when no `?project=<slug>` is provided, and the analytics ingest
  // hooks into its SQLite handle.
  let primaryCg: SpecShipInstance | null = null;
  if (options.projectRoot) {
    primaryCg = await registry.get(options.projectRoot);
    if (primaryCg) {
      // Routes capture this instance by reference — it must never be LRU
      // evicted (eviction closes the SQLite handle and every request 500s).
      registry.pin(options.projectRoot);
    } else if (verbose) {
      console.error(`[specship-server] primary project ${options.projectRoot} not initialized — booting projectless`);
    }
  }

  // Start the JSONL ingest watcher in-process unless the caller already
  // provided one or explicitly opted out. Hooks into the primary project's
  // SQLite handle — when there's no primary, analytics endpoints will return
  // 409 until one is set (typically the next server restart with -p).
  //
  // The persisted runtime config (~/.specship/server-config.json) gates the
  // start too: the Settings ingest toggle must survive a restart
  // (REQ-DESKTOP-028.A2). CLI `--no-ingest` still wins over everything.
  let watcher: WatcherHandle | null = options.watcher ?? null;
  let ownedWatcher = false;
  let ingestEnabled = watcher != null
    || (options.ingest !== false && readServerConfig().ingestEnabled !== false);

  const startIngestWatcher = (): boolean => {
    if (watcher) return true;
    if (!primaryCg) return false;
    const cgAny = primaryCg as unknown as { db?: { getDb?: () => unknown }; queries?: { db?: unknown } };
    const dbHandle = cgAny.db?.getDb ? cgAny.db.getDb() : cgAny.queries?.db;
    if (!dbHandle) return false;
    // Build a sync resolveGraph: for the primary project path return the
    // already-open SpecShip instance (which satisfies GraphLike).
    // Sessions from other project paths resolve to null — they'll be left
    // as 'unresolved' and retried on the next boot when that project is primary.
    // The stored project_path is the lossy-decoded slug (every '-' → '/'), so
    // an exact compare against the real primaryPath never matched and savings
    // stayed 0. primaryProjectMatcher accepts both the real path and its
    // mangled stored form. Sessions from OTHER projects still resolve to null
    // (left 'unresolved', retried when that project is primary).
    const primaryPath = options.projectRoot ?? null;
    const isPrimary = primaryPath ? primaryProjectMatcher(primaryPath) : () => false;
    const resolveGraph = (projectPath: string) =>
      primaryPath && isPrimary(projectPath) ? primaryCg : null;

    watcher = startWatcher(dbHandle as Parameters<typeof startWatcher>[0], { verbose, resolveGraph });
    ownedWatcher = true;
    if (verbose) console.error('[specship-server] JSONL ingest watcher started');

    // Backfill displaced_files / resolution for pre-upgrade rows (is_specship=1,
    // resolution IS NULL). Idempotent — safe to run on every boot. Non-fatal:
    // a failure here must never abort server startup.
    try {
      backfillDisplaced(dbHandle as Parameters<typeof startWatcher>[0], resolveGraph);
      if (verbose) console.error('[specship-server] specship-impact backfill complete');
    } catch (err) {
      console.error('[specship-server] specship-impact backfill failed (non-fatal):',
        err instanceof Error ? err.message : String(err));
    }

    // Re-cost prompts ingested while their model family was unpriced,
    // e.g. fable sessions stuck at $0 (REQ-DASHINT-001.A2). Idempotent.
    try {
      const recosted = recostUnpricedPrompts(dbHandle as Parameters<typeof recostUnpricedPrompts>[0]);
      if (verbose && recosted > 0) console.error(`[specship-server] re-costed ${recosted} unpriced prompts`);
    } catch (err) {
      console.error('[specship-server] pricing backfill failed (non-fatal):',
        err instanceof Error ? err.message : String(err));
    }
    return true;
  };

  if (!watcher && ingestEnabled) {
    if (primaryCg) {
      startIngestWatcher();
    } else if (verbose) {
      console.error('[specship-server] no primary project — analytics will be empty until one is set');
    }
  }

  // Decorate the Fastify instance so route handlers can access shared state
  // without globals or DI containers.
  app.decorate('projects', registry);
  app.decorate('primaryCg', primaryCg);
  app.decorate('watcher', watcher);
  // Runtime ingest control for GET/PUT /api/config (REQ-DESKTOP-028.A2).
  // `enabled` is the configured intent (round-trips even when no primary
  // project can host a watcher yet); `active` is whether one is running.
  // start/stop keep `app.watcher` in sync so /api/refresh always sees the
  // live handle.
  app.decorate('ingestControl', {
    enabled: () => ingestEnabled,
    active: () => watcher != null,
    start: () => {
      ingestEnabled = true;
      const started = startIngestWatcher();
      app.watcher = watcher;
      return started;
    },
    stop: () => {
      ingestEnabled = false;
      if (watcher) { try { watcher.stop(); } catch { /* ignore */ } }
      watcher = null;
      ownedWatcher = false;
      app.watcher = null;
    },
  });
  // activeCg(req): resolve `?project=<slug>` → SpecShip instance, with the
  // primary as fallback. Returns null when nothing is selectable; route
  // handlers respond 409 in that case.
  app.decorate('activeCg', async function (this: FastifyInstance, req: FastifyRequest): Promise<SpecShipInstance | null> {
    const q = (req.query ?? {}) as { project?: string; projectPath?: string };
    if (q.project) {
      const bySlug = await registry.getBySlug(q.project);
      if (bySlug) return bySlug;
    }
    if (q.projectPath) {
      const byPath = await registry.get(q.projectPath);
      if (byPath) return byPath;
    }
    return primaryCg;
  });

  // Register route groups.
  await registerStatusRoutes(app);
  await registerGraphRoutes(app);
  await registerSpecRoutes(app);
  await registerWorkflowRoutes(app);
  await registerClaudeRoutes(app);
  await registerMemoryRoutes(app);
  await registerProjectsRoutes(app);
  await registerEventsRoutes(app);
  await registerReflectRoutes(app);
  await registerMaintainabilityRoutes(app);
  await registerDomainRoutes(app);
  await registerChatRoutes(app);
  await registerMcpRoutes(app);
  await registerConfigRoutes(app);

  // Serve the built desktop SPA (the `ui/` module) from `webDir` and fall back
  // to index.html for client-side routes. This is the dashboard's only surface
  // (REQ-DESKTOP-033 — the server-rendered dashboard retired). Must register
  // AFTER the /api/* routes so they take precedence over the SPA wildcard. When
  // the caller passed no webDir at all, auto-detect the SPA shipped next to the
  // server build; `null` explicitly opts out (headless / API only).
  const webDir = options.webDir === undefined ? resolveDefaultWebDir() : options.webDir;
  if (webDir) {
    const indexPath = path.join(webDir, 'index.html');
    let indexBuffer: Buffer | null = null;
    try {
      indexBuffer = await fs.readFile(indexPath);
    } catch {
      if (verbose) {
        console.error(`[specship-server] webDir provided but index.html not found at ${indexPath} — skipping static mount`);
      }
    }
    if (indexBuffer) {
      const cachedIndex = indexBuffer;
      const serveStatic = makeStaticHandler(webDir);
      // A single 404 handler does both jobs:
      //   1. Try the requested URL as a real file under webDir → serve it
      //      with the right content-type. Covers the SPA's chunk-*.js,
      //      styles.css, favicons, fonts, etc.
      //   2. Fall through to index.html for any other GET so the SPA's
      //      client-side router can take over (`/memory`, `/graph`, …).
      // Non-GET methods and `/api/*` paths still 404 cleanly so the UI
      // can surface them. A MISSING asset path (e.g. a stale build's old
      // content-hashed bundle) must also 404, never receive the shell —
      // HTML under an asset URL poisons the offline service worker's cache
      // (REQ-OFFLINE-005).
      app.setNotFoundHandler((request, reply) => {
        if (request.method !== 'GET') {
          reply.code(404).send({ error: 'not found' });
          return;
        }
        if (request.url.startsWith('/api/')) {
          reply.code(404).send({ error: 'not found' });
          return;
        }
        const hit = serveStatic(request.url);
        if (hit) {
          reply.code(200).type(hit.contentType).send(hit.body);
          return;
        }
        if (isAssetPath(request.url)) {
          reply.code(404).send({ error: 'not found' });
          return;
        }
        reply.code(200).type('text/html').send(cachedIndex);
      });
      if (verbose) console.error(`[specship-server] serving SPA from ${webDir}`);
    }
  }

  await app.listen({ host, port });
  const url = `http://${host}:${port}`;

  return {
    app,
    url,
    host,
    port,
    stop: async () => {
      if (ownedWatcher && watcher) { try { watcher.stop(); } catch { /* ignore */ } }
      registry.closeAll();
      await app.close();
    },
  };
}

/** Runtime control over the JSONL ingest watcher (GET/PUT /api/config). */
export interface IngestControl {
  /** Configured intent — mirrors ~/.specship/server-config.json. */
  enabled: () => boolean;
  /** Whether a watcher is actually running right now. */
  active: () => boolean;
  /** Record intent = on and start the watcher when a primary DB exists. */
  start: () => boolean | Promise<boolean>;
  /** Record intent = off and stop any running watcher. */
  stop: () => void;
}

// Fastify type augmentation. Route handlers read shared state via these.
declare module 'fastify' {
  interface FastifyInstance {
    projects: ProjectRegistry;
    primaryCg: SpecShipInstance | null;
    activeCg: (req: FastifyRequest) => Promise<SpecShipInstance | null>;
    watcher: WatcherHandle | null;
    ingestControl: IngestControl;
  }
}
