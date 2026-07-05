/**
 * GET /api/maintainability (REQ-MAINT-003).
 *
 * Returns the active project's graph-derived maintainability report — coupling,
 * size hotspots, dependency cycles, dead-code candidates. Project-scoped (uses
 * the active instance, like the graph/spec routes), driven through the instance
 * method `getMaintainability()` so the server never runtime-imports the package.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export async function registerMaintainabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/maintainability', async (req: FastifyRequest, reply: FastifyReply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      reply.code(409).send({ error: 'no project selected', code: 'no_project' });
      return;
    }
    return cg.getMaintainability();
  });
}
