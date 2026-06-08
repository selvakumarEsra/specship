/**
 * GET /api/status — backend, journal mode, node/edge counts, drift count,
 * last index time. Drives the UI's persistent status strip.
 *
 * Project-scoped: accepts `?project=<slug>` and serves the matching
 * SpecShip instance from the registry. When no project is selectable
 * (no `?project=`, no primary), returns a 409 with `code: 'no_project'`
 * so the UI can show the picker without blowing up.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

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
}
