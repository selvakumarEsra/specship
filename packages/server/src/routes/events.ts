/**
 * GET /api/events — cross-project alert stream (REQ-PWA-002).
 *
 * A single SSE stream that watches EVERY initialized project (not just the
 * selected one) and emits an event when an alert-worthy transition happens:
 *   - `approval`  — a workflow run entered `paused` (an approval gate)
 *   - `runDone`   — a run entered `completed` or `failed`
 *   - `drift`     — a spec→code link newly entered drifted/broken/orphaned
 *
 * Polls the same SQLite the executor/resolver write to (mirrors the workflow
 * SSE's 500ms-poll approach), diffing against per-connection seen-state so only
 * NEW transitions are emitted — never a backlog burst on connect, never a repeat
 * for the same transition. The client (NotificationsService) turns these into
 * desktop notifications, gated on permission + per-type toggles.
 */

import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { enumerate } from './projects.js';

interface AlertEvent {
  kind: 'approval' | 'runDone' | 'drift';
  project: string;
  projectPath: string;
  id: string;
  title: string;
  detail?: string;
  status?: string;
}

const POLL_MS = 3000;
const KEEPALIVE_MS = 15000;

export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  const claudeRoot = path.join(os.homedir(), '.claude', 'projects');

  app.get('/api/events', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.write(': connected\n\n');

    // Per-connection seen-state — emit only NEW transitions.
    const lastStatus = new Map<string, string>(); // `${slug}:${runId}` -> status
    const seenDrift = new Set<string>(); // `${slug}:${linkId}`
    let primed = false; // first pass seeds state silently (no burst on connect)
    let closed = false;

    const send = (ev: AlertEvent): void => {
      if (closed) return;
      try { reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* peer gone */ }
    };

    const poll = async (): Promise<void> => {
      let projects;
      try { projects = await enumerate(claudeRoot); } catch { return; }
      for (const p of projects) {
        if (!p.initialized || closed) continue;
        let cg;
        try { cg = await app.projects.getBySlug(p.slug); } catch { cg = null; }
        if (!cg) continue;
        const sq = cg.getSpecQueries();

        // Workflow run transitions.
        let runs: ReturnType<typeof sq.getAllWorkflowRuns> = [];
        try { runs = sq.getAllWorkflowRuns(50); } catch { /* ignore */ }
        for (const r of runs) {
          const key = `${p.slug}:${r.id}`;
          if (lastStatus.get(key) === r.status) continue;
          lastStatus.set(key, r.status);
          if (!primed) continue;
          if (r.status === 'paused') {
            send({ kind: 'approval', project: p.slug, projectPath: p.path, id: r.id, title: 'Run needs approval', detail: r.workflowName });
          } else if (r.status === 'completed' || r.status === 'failed') {
            send({ kind: 'runDone', project: p.slug, projectPath: p.path, id: r.id, title: `Run ${r.status}`, detail: r.workflowName, status: r.status });
          }
        }

        // Newly-drifted links.
        let links: ReturnType<typeof sq.getLinksByState> = [];
        try { links = sq.getLinksByState(['drifted', 'broken', 'orphaned']); } catch { /* ignore */ }
        for (const l of links) {
          const key = `${p.slug}:${l.id}`;
          if (seenDrift.has(key)) continue;
          seenDrift.add(key);
          if (!primed) continue;
          send({ kind: 'drift', project: p.slug, projectPath: p.path, id: String(l.id), title: 'Drift detected', detail: `${l.specId} → ${l.targetQualifiedName}` });
        }
      }
      primed = true;
    };

    await poll(); // prime: seed seen-state without emitting
    const pollTimer = setInterval(() => { void poll(); }, POLL_MS);
    const kaTimer = setInterval(() => { if (!closed) { try { reply.raw.write(': ka\n\n'); } catch { /* noop */ } } }, KEEPALIVE_MS);

    req.raw.on('close', () => {
      closed = true;
      clearInterval(pollTimer);
      clearInterval(kaTimer);
    });
  });
}
