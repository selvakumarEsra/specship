/**
 * GET/PUT /api/config — the dashboard-visible server runtime configuration
 * (REQ-DESKTOP-028.A2/.A3). Currently one knob: the Claude Code transcript
 * ingest toggle, persisted to `~/.specship/server-config.json` so it
 * survives restarts, plus the real product version for the About section.
 *
 * PUT flips the live watcher through `app.ingestControl` (server.ts): off
 * stops the JSONL watcher immediately, on starts it (when a primary project
 * with a DB handle exists — otherwise the intent is recorded and honored on
 * the next boot with a primary).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { productVersion } from '../product-version.js';
import { writeServerConfig } from '../server-config.js';

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async () => ({
    ingestEnabled: app.ingestControl.enabled(),
    version: productVersion(),
  }));

  app.put('/api/config', async (req: FastifyRequest<{ Body: { ingestEnabled?: unknown } }>, reply) => {
    const body = (req.body ?? {}) as { ingestEnabled?: unknown };
    if (typeof body.ingestEnabled !== 'boolean') {
      return reply.code(400).send({ error: 'ingestEnabled must be a boolean', code: 'bad_request' });
    }
    writeServerConfig({ ingestEnabled: body.ingestEnabled });
    if (body.ingestEnabled) await app.ingestControl.start();
    else app.ingestControl.stop();
    return {
      ok: true,
      ingestEnabled: app.ingestControl.enabled(),
      version: productVersion(),
    };
  });
}
