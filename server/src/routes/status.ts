/**
 * GET /api/status — backend, journal mode, node/edge counts, drift count,
 * last index time. Drives the UI's persistent status strip.
 *
 * POST /api/refresh — force-sync the SpecShip index AND trigger an
 * immediate Claude Code transcript re-ingest. Wired to the global
 * refresh button in the dashboard's status strip so users can pull
 * Sessions / Heatmap / Costs / Memory current without waiting on the
 * watcher's debounce.
 *
 * Project-scoped: accepts `?project=<slug>` and serves the matching
 * SpecShip instance from the registry. When no project is selectable
 * (no `?project=`, no primary), returns a 409 with `code: 'no_project'`
 * so the UI can show the picker without blowing up.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { productVersion } from '../product-version.js';

interface StatusQuery { project?: string }

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/status', async (req: FastifyRequest<{ Querystring: StatusQuery }>, reply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      return reply.code(409).send({ error: 'no project selected', code: 'no_project' });
    }
    const stats = cg.getStats();
    const lastIndexed = cg.getLastIndexedAt();
    const drift = cg
      .getSpecQueries()
      .getLinksByState(['drifted', 'broken', 'orphaned']).length;
    return {
      projectPath: cg.getProjectRoot ? cg.getProjectRoot() : '',
      backend: cg.getBackend(),
      journalMode: cg.getJournalMode(),
      version: productVersion(),
      nodeCount: stats.nodeCount,
      edgeCount: stats.edgeCount,
      fileCount: stats.fileCount,
      drift,
      lastIndexed: lastIndexed != null ? new Date(lastIndexed).toISOString() : null,
      nodesByKind: stats.nodesByKind,
      filesByLanguage: stats.filesByLanguage,
      dbSizeBytes: stats.dbSizeBytes,
    };
  });

  /**
   * Force a synchronous re-sync of the project's SpecShip index AND a
   * fresh Claude Code transcript ingest pass. The status strip's
   * refresh button calls this so users can pull every project-scoped
   * surface (Sessions, Heatmap, Costs, Memory, Drift, Graph) to
   * current without waiting on the JSONL watcher's debounce window or
   * the next file-watcher tick.
   *
   * Returns the same shape as GET /api/status (so the UI can update
   * its strip and `lastIndexed` label in one round-trip) plus the
   * ingest stats for surfaces interested in "how many new sessions
   * landed."
   *
   * Both steps run sequentially. Errors in either are surfaced under
   * `syncError` / `ingestError` so a transient ingest hiccup doesn't
   * mask a successful index sync (or vice versa) — and the UI can
   * decide whether to retry or surface the failure.
   */
  app.post('/api/refresh', async (req: FastifyRequest<{ Querystring: StatusQuery }>, reply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      return reply.code(409).send({ error: 'no project selected', code: 'no_project' });
    }

    let syncError: string | null = null;
    let ingestError: string | null = null;
    let ingestStats: unknown = null;

    // 1. Re-index the project. Picks up code AND specs/ changes the
    //    auto-sync hook may not have caught yet.
    try {
      await cg.sync();
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e);
    }

    // 2. Re-ingest Claude Code transcripts. Skipped silently when the
    //    server was booted with `--no-ingest` (app.watcher == null).
    if (app.watcher) {
      try {
        ingestStats = await app.watcher.ingestNow();
      } catch (e) {
        ingestError = e instanceof Error ? e.message : String(e);
      }
    }

    // 3. Echo the new status so the UI updates its strip + lastIndexed
    //    label without a separate GET.
    const stats = cg.getStats();
    const lastIndexed = cg.getLastIndexedAt();
    const drift = cg
      .getSpecQueries()
      .getLinksByState(['drifted', 'broken', 'orphaned']).length;

    return {
      ok: syncError === null && ingestError === null,
      syncError,
      ingestError,
      ingestStats,
      status: {
        projectPath: cg.getProjectRoot ? cg.getProjectRoot() : '',
        backend: cg.getBackend(),
        journalMode: cg.getJournalMode(),
        version: productVersion(),
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        fileCount: stats.fileCount,
        drift,
        lastIndexed: lastIndexed != null ? new Date(lastIndexed).toISOString() : null,
        nodesByKind: stats.nodesByKind,
        filesByLanguage: stats.filesByLanguage,
        dbSizeBytes: stats.dbSizeBytes,
      },
    };
  });
}
