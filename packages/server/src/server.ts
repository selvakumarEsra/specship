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
import { ProjectRegistry, type SpecShipInstance } from './project-registry.js';
import { makeStaticHandler } from './static-handler.js';
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
   * Directory containing the built Angular UI (`index.html` + assets). When
   * set, the server serves the SPA at `/` and falls back to `index.html`
   * for any non-API GET (so client-side routes like `/memory` work on
   * direct page loads). Omit to run the server headless (API only).
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
 *   2. **Workspace / dev** — `packages/server/dist/server.js` imports via
 *      the workspace `file:../..` dep. Falls through to the named import.
 *
 * The function caches the resolved module so the lookup only runs once.
 */
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
  const registry = new ProjectRegistry({ verbose }, (p) => cgMod.SpecShip.open(p));

  // Primary project (optional). When set, specship-scoped routes default to
  // it when no `?project=<slug>` is provided, and the analytics ingest
  // hooks into its SQLite handle.
  let primaryCg: SpecShipInstance | null = null;
  if (options.projectRoot) {
    primaryCg = await registry.get(options.projectRoot);
    if (!primaryCg && verbose) {
      console.error(`[specship-server] primary project ${options.projectRoot} not initialized — booting projectless`);
    }
  }

  // Start the JSONL ingest watcher in-process unless the caller already
  // provided one or explicitly opted out. Hooks into the primary project's
  // SQLite handle — when there's no primary, analytics endpoints will return
  // 409 until one is set (typically the next server restart with -p).
  let watcher: WatcherHandle | null = options.watcher ?? null;
  let ownedWatcher = false;
  if (!watcher && options.ingest !== false && primaryCg) {
    const cgAny = primaryCg as unknown as { db?: { getDb?: () => unknown }; queries?: { db?: unknown } };
    const dbHandle = cgAny.db?.getDb ? cgAny.db.getDb() : cgAny.queries?.db;
    if (dbHandle) {
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
    }
  } else if (!primaryCg && options.ingest !== false && verbose) {
    console.error('[specship-server] no primary project — analytics will be empty until one is set');
  }

  // Decorate the Fastify instance so route handlers can access shared state
  // without globals or DI containers.
  app.decorate('projects', registry);
  app.decorate('primaryCg', primaryCg);
  app.decorate('watcher', watcher);
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

  // Optional: serve the built Angular UI from `webDir` and fall back to
  // index.html for client-side routes. Must register AFTER the /api/*
  // routes so they take precedence over the SPA wildcard.
  if (options.webDir) {
    const indexPath = path.join(options.webDir, 'index.html');
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
      const serveStatic = makeStaticHandler(options.webDir);
      // A single 404 handler does both jobs:
      //   1. Try the requested URL as a real file under webDir → serve it
      //      with the right content-type. Covers the SPA's chunk-*.js,
      //      styles.css, favicons, fonts, etc.
      //   2. Fall through to index.html for any other GET so Angular's
      //      client-side router can take over (`/memory`, `/graph`, …).
      // Non-GET methods and `/api/*` paths still 404 cleanly so the UI
      // can surface them.
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
        reply.code(200).type('text/html').send(cachedIndex);
      });
      if (verbose) console.error(`[specship-server] serving SPA from ${options.webDir}`);
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

// Fastify type augmentation. Route handlers read shared state via these.
declare module 'fastify' {
  interface FastifyInstance {
    projects: ProjectRegistry;
    primaryCg: SpecShipInstance | null;
    activeCg: (req: FastifyRequest) => Promise<SpecShipInstance | null>;
    watcher: WatcherHandle | null;
  }
}
