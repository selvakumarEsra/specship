/**
 * Reflection engine HTTP surface (REFLECT-DOC).
 *
 *   GET  /api/reflect                 — list persisted proposals (?state=open|applied|undone|dismissed)
 *   POST /api/reflect/analyze         — run a reflection pass, persist, return open proposals
 *   GET  /api/reflect/:hash/preview   — non-mutating diff of the change a proposal would make
 *   POST /api/reflect/:hash/apply     — preview-confirmed write (idempotent + reversible)
 *   POST /api/reflect/:hash/undo      — reverse a previously applied proposal
 *   POST /api/reflect/:hash/dismiss   — hide a proposal from future sweeps
 *
 * Like the tips engine, reflection reads the cross-project claude_* tables that
 * live in the boot-time "primary" project's DB, so every handler resolves the
 * primary instance and drives it through its `reflect*` methods. These are
 * instance methods on the dynamically-loaded SpecShip — NOT a runtime package
 * import — so the route never trips the stale-build hazard.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';

export async function registerReflectRoutes(app: FastifyInstance): Promise<void> {
  function requirePrimary(reply: FastifyReply): SpecShipInstance | null {
    if (!app.primaryCg) {
      reply.code(409).send({ error: 'reflection unavailable: no primary project configured', code: 'no_primary' });
      return null;
    }
    return app.primaryCg;
  }

  // List persisted proposals, optionally filtered by state.
  app.get('/api/reflect', async (req: FastifyRequest<{ Querystring: { state?: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const state = req.query.state as 'open' | 'applied' | 'undone' | 'dismissed' | undefined;
    return { proposals: cg.reflectList(state) };
  });

  // Run a reflection pass: mine + persist + return the current open proposals.
  app.post('/api/reflect/analyze', async (_req, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const result = cg.reflectAnalyze();
    return { open: result.open, empty: result.empty };
  });

  // Non-mutating preview of a proposal's change (REQ-REFLECT-003).
  app.get('/api/reflect/:hash/preview', async (req: FastifyRequest<{ Params: { hash: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const preview = cg.reflectPreview(req.params.hash);
    if (!preview) { reply.code(404).send({ error: 'proposal not found', code: 'not_found' }); return; }
    return preview;
  });

  // Apply a proposal — preview-confirmed write (REQ-REFLECT-004).
  app.post('/api/reflect/:hash/apply', async (req: FastifyRequest<{ Params: { hash: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const outcome = cg.reflectApply(req.params.hash);
    if (outcome === null) { reply.code(404).send({ error: 'proposal not found', code: 'not_found' }); return; }
    if (outcome === 'conflict') { reply.code(409).send({ error: 'a non-SpecShip file already occupies the target path', code: 'conflict' }); return; }
    return { outcome, proposal: cg.reflectGet(req.params.hash) };
  });

  // Undo a previously applied proposal (REQ-REFLECT-004.A3).
  app.post('/api/reflect/:hash/undo', async (req: FastifyRequest<{ Params: { hash: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const outcome = cg.reflectUndo(req.params.hash);
    if (outcome === null) { reply.code(404).send({ error: 'proposal not found', code: 'not_found' }); return; }
    return { outcome, proposal: cg.reflectGet(req.params.hash) };
  });

  // Dismiss a proposal so it does not resurface on later sweeps (REQ-REFLECT-007.A2).
  app.post('/api/reflect/:hash/dismiss', async (req: FastifyRequest<{ Params: { hash: string } }>, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const ok = cg.reflectDismiss(req.params.hash);
    if (!ok) { reply.code(404).send({ error: 'proposal not found', code: 'not_found' }); return; }
    return { ok: true, proposal: cg.reflectGet(req.params.hash) };
  });
}
