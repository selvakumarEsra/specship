/**
 * Workflow routes — discover / run / resume / cancel / approve / reject /
 * runs list / run detail + SSE event stream.
 *
 * All project-scoped via `?project=<slug>` (falls back to primary). Each
 * handler resolves the active SpecShip instance from the registry and
 * constructs the WorktreeProvider + WorkflowExecutor on demand against
 * that instance's queries. Construction is cheap (both classes just stash
 * references), and pinning a single executor across all projects would
 * tie the entire surface to whichever instance loaded first.
 *
 * The SSE endpoint streams workflow_events as they're appended to the DB
 * (polling 500ms). For v1 polling the same SQLite the executor writes to is
 * faster + more reliable than wiring an in-process event bus across packages.
 */

import path from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';

interface ProjectQuery { project?: string }

interface RunStartBody {
  workflowName: string;
  inputs?: Record<string, string>;
  variables?: Record<string, string>;
}

interface ApproveBody { comment?: string }
interface RejectBody { reason?: string }
interface CancelBody { reason?: string }

async function resolveCg(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<SpecShipInstance | null> {
  const cg = await app.activeCg(req);
  if (!cg) { reply.code(409).send({ error: 'no project selected', code: 'no_project' }); return null; }
  return cg;
}

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  // Lazy import — keeps the server bootable even if the workflow engine
  // is disabled in the current build profile.
  //
  // Two delivery shapes (same pattern as loadSpecShip() in ../server.ts):
  //   1. **Bundled** — `dist/server/routes/workflow.js` sits two levels under
  //      `dist/`, so the core workflow modules live at `../../workflows/*.js`
  //      and `../../isolation/*.js`. We try this relative path first because
  //      the bundled tarball stages the specship core without a resolvable
  //      `@selvakumaresra/specship` package on Node's module graph (offline
  //      installs hit this — see scripts/offline-install.sh).
  //   2. **Workspace / dev** — the `file:../..` workspace dep resolves the
  //      named import via Node's normal package resolution.
  let discovery: typeof import('@selvakumaresra/specship/dist/workflows/discovery.js');
  let executorMod: typeof import('@selvakumaresra/specship/dist/workflows/executor.js');
  let worktreeMod: typeof import('@selvakumaresra/specship/dist/isolation/worktree.js');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundledDiscovery = path.resolve(here, '..', '..', 'workflows', 'discovery.js');
  if (existsSync(bundledDiscovery)) {
    discovery = await import(pathToFileURL(bundledDiscovery).href);
    executorMod = await import(pathToFileURL(path.resolve(here, '..', '..', 'workflows', 'executor.js')).href);
    worktreeMod = await import(pathToFileURL(path.resolve(here, '..', '..', 'isolation', 'worktree.js')).href);
  } else {
    discovery = await import('@selvakumaresra/specship/dist/workflows/discovery.js');
    executorMod = await import('@selvakumaresra/specship/dist/workflows/executor.js');
    worktreeMod = await import('@selvakumaresra/specship/dist/isolation/worktree.js');
  }
  const { discoverWorkflows, loadWorkflowByName } = discovery;
  const { WorkflowExecutor } = executorMod;
  const { WorktreeProvider } = worktreeMod;

  type SQ = ReturnType<SpecShipInstance['getSpecQueries']>;
  type Executor = InstanceType<typeof WorkflowExecutor>;
  const executorCache = new WeakMap<SQ, { executor: Executor; projectRoot: string }>();

  /** Build (or fetch cached) executor + worktree provider for a project. */
  function executorFor(cg: SpecShipInstance): { sq: SQ; executor: Executor; projectRoot: string } {
    const sq = cg.getSpecQueries() as SQ;
    const cached = executorCache.get(sq);
    if (cached) return { sq, executor: cached.executor, projectRoot: cached.projectRoot };
    const projectRoot = cg.getProjectRoot ? cg.getProjectRoot() : process.cwd();
    const worktrees = new WorktreeProvider(sq);
    const executor = new WorkflowExecutor(sq, worktrees);
    executorCache.set(sq, { executor, projectRoot });
    return { sq, executor, projectRoot };
  }

  app.get('/api/workflows', async (req: FastifyRequest<{ Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { projectRoot } = executorFor(cg);
    return discoverWorkflows(projectRoot);
  });

  app.post('/api/workflows/runs', async (req: FastifyRequest<{ Body: RunStartBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { executor, projectRoot } = executorFor(cg);
    const body = req.body;
    if (!body?.workflowName) return reply.code(400).send({ error: 'workflowName required' });
    const loaded = loadWorkflowByName(projectRoot, body.workflowName);
    if (!loaded) return reply.code(404).send({ error: 'workflow not found' });
    const startPromise = executor.start(loaded.workflow, {
      projectRoot,
      inputs: body.inputs,
      variables: body.variables,
    });
    const result = await Promise.race([
      startPromise,
      new Promise<{ run: { id: string; status: string } }>((resolve) =>
        setTimeout(() => resolve({ run: { id: 'pending', status: 'starting' } }), 50)
      ),
    ]) as { run: { id: string; status: string } };
    startPromise.catch(() => { /* errors land in workflow_runs.errorMessage */ });
    return { runId: result.run.id, status: result.run.status };
  });

  app.get('/api/workflows/runs', async (req: FastifyRequest<{ Querystring: ProjectQuery & { limit?: string } }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { sq } = executorFor(cg);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 500);
    return { runs: sq.getAllWorkflowRuns(limit) };
  });

  app.get('/api/workflows/runs/:id', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { sq } = executorFor(cg);
    const run = sq.getWorkflowRunById(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    const events = sq.getEventsByRun(req.params.id, 500);
    return { run, events };
  });

  /**
   * Read-only artifacts for a run. The executor writes each completed node's
   * output to `<.specship>/artifacts/runs/<id>/nodes/<nodeId>.{md,meta.json}`;
   * this lists + returns them (body inline — a run has a handful of nodes). No
   * execution-path change: it only reads what's already on disk.
   */
  app.get('/api/workflows/runs/:id/artifacts', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { projectRoot } = executorFor(cg);
    const dir = path.join(projectRoot, '.specship', 'artifacts', 'runs', req.params.id, 'nodes');
    const artifacts: Array<{ nodeId: string; name: string; kind?: string; outputType?: string; length: number; body: string }> = [];
    if (existsSync(dir)) {
      try {
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
          const stem = file.slice(0, -3);
          let meta: { nodeId?: string; kind?: string; outputType?: string; length?: number } = {};
          try { meta = JSON.parse(readFileSync(path.join(dir, `${stem}.meta.json`), 'utf8')); } catch { /* no/invalid meta */ }
          let body = '';
          try { body = readFileSync(path.join(dir, file), 'utf8'); } catch { /* unreadable */ }
          artifacts.push({
            nodeId: meta.nodeId ?? stem,
            name: file,
            kind: meta.kind,
            outputType: meta.outputType,
            length: meta.length ?? body.length,
            body,
          });
        }
      } catch { /* dir vanished mid-read — return what we have */ }
    }
    return { artifacts };
  });

  /**
   * SSE event stream. Polls the events table every 500ms for any events
   * newer than the last id sent. Closes when the run hits a terminal state.
   */
  app.get('/api/workflows/runs/:id/events', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery & { since?: string } }>, reply: FastifyReply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { sq } = executorFor(cg);
    const runId = req.params.id;
    let lastId = parseInt(req.query.since ?? '0', 10) || 0;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    let closed = false;
    req.raw.on('close', () => { closed = true; });

    const tick = async () => {
      if (closed) return;
      const events = sq.getEventsByRun(runId, 1000);
      const fresh = events.filter((e) => e.id > lastId);
      for (const e of fresh) {
        reply.raw.write(`id: ${e.id}\n`);
        reply.raw.write(`event: ${e.eventType}\n`);
        reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
        lastId = e.id;
      }
      const run = sq.getWorkflowRunById(runId);
      if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) {
        reply.raw.write(`event: done\ndata: ${JSON.stringify({ status: run?.status })}\n\n`);
        reply.raw.end();
        return;
      }
      setTimeout(() => { void tick(); }, 500);
    };
    void tick();
  });

  app.post('/api/workflows/runs/:id/approve', async (req: FastifyRequest<{ Params: { id: string }; Body: ApproveBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { executor } = executorFor(cg);
    try { executor.approve(req.params.id, req.body?.comment); return { ok: true }; }
    catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post('/api/workflows/runs/:id/reject', async (req: FastifyRequest<{ Params: { id: string }; Body: RejectBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { executor } = executorFor(cg);
    try { executor.reject(req.params.id, req.body?.reason); return { ok: true }; }
    catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post('/api/workflows/runs/:id/cancel', async (req: FastifyRequest<{ Params: { id: string }; Body: CancelBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { executor } = executorFor(cg);
    try { executor.cancel(req.params.id, req.body?.reason); return { ok: true }; }
    catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) }); }
  });

  app.post('/api/workflows/runs/:id/resume', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const { sq, executor, projectRoot } = executorFor(cg);
    const run = sq.getWorkflowRunById(req.params.id);
    if (!run) return reply.code(404).send({ error: 'run not found' });
    const loaded = loadWorkflowByName(projectRoot, run.workflowName);
    if (!loaded) return reply.code(404).send({ error: 'workflow definition missing' });
    const promise = executor.resume(loaded.workflow, req.params.id, { projectRoot });
    promise.catch(() => { /* errors persisted */ });
    return { ok: true };
  });
}
