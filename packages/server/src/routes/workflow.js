"use strict";
/**
 * Workflow routes — discover / run / resume / cancel / approve / reject /
 * runs list / run detail + SSE event stream.
 *
 * The SSE endpoint streams workflow_events as they're appended to the DB.
 * Implementation: poll the events table every 500ms, send only rows newer
 * than the last sent id. This is intentionally simple — for v1, polling the
 * same SQLite the executor writes to is faster + more reliable than wiring
 * an in-process event bus across packages.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkflowRoutes = registerWorkflowRoutes;
async function registerWorkflowRoutes(app) {
    // Lazy import — keeps the server bootable even if the workflow engine
    // is disabled in the current build profile.
    const { discoverWorkflows, loadWorkflowByName } = await Promise.resolve().then(() => __importStar(require('@selvakumaresra/specship/dist/workflows/discovery.js')));
    const { WorkflowExecutor } = await Promise.resolve().then(() => __importStar(require('@selvakumaresra/specship/dist/workflows/executor.js')));
    const { WorktreeProvider } = await Promise.resolve().then(() => __importStar(require('@selvakumaresra/specship/dist/isolation/worktree.js')));
    const sq = app.cg.getSpecQueries();
    const projectRoot = app.cg.getProjectRoot ? app.cg.getProjectRoot() : process.cwd();
    const worktrees = new WorktreeProvider(sq);
    const executor = new WorkflowExecutor(sq, worktrees);
    app.get('/api/workflows', async () => {
        const result = discoverWorkflows(projectRoot);
        return result;
    });
    app.post('/api/workflows/runs', async (req, reply) => {
        const body = req.body;
        if (!body?.workflowName)
            return reply.code(400).send({ error: 'workflowName required' });
        const loaded = loadWorkflowByName(projectRoot, body.workflowName);
        if (!loaded)
            return reply.code(404).send({ error: 'workflow not found' });
        // Run async — return immediately with the run id. The UI polls / SSEs
        // for status; blocking the HTTP call until completion would tie up the
        // connection for long-running workflows (e.g. spec-implement with code edits).
        const startPromise = executor.start(loaded.workflow, {
            projectRoot,
            inputs: body.inputs,
            variables: body.variables,
        });
        // We need the runId before returning. The executor inserts the run row
        // synchronously inside start(), but the function is async — wait one
        // tick for the runId to land, then return.
        const result = await Promise.race([
            startPromise,
            new Promise((resolve) => setTimeout(() => resolve({ run: { id: 'pending', status: 'starting' } }), 50)),
        ]);
        // Detach: if startPromise hasn't resolved yet, continue executing in the background.
        startPromise.catch(() => { });
        return { runId: result.run.id, status: result.run.status };
    });
    app.get('/api/workflows/runs', async (req) => {
        const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 500);
        return { runs: sq.getAllWorkflowRuns(limit) };
    });
    app.get('/api/workflows/runs/:id', async (req, reply) => {
        const run = sq.getWorkflowRunById(req.params.id);
        if (!run)
            return reply.code(404).send({ error: 'run not found' });
        const events = sq.getEventsByRun(req.params.id, 500);
        return { run, events };
    });
    /**
     * SSE event stream. Polls the events table every 500ms for any events
     * newer than the last id sent. Closes when the run hits a terminal state.
     */
    app.get('/api/workflows/runs/:id/events', async (req, reply) => {
        const runId = req.params.id;
        let lastId = parseInt(req.query.since ?? '0', 10) || 0;
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders();
        let closed = false;
        req.raw.on('close', () => { closed = true; });
        const tick = async () => {
            if (closed)
                return;
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
    app.post('/api/workflows/runs/:id/approve', async (req, reply) => {
        try {
            executor.approve(req.params.id, req.body?.comment);
            return { ok: true };
        }
        catch (err) {
            return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post('/api/workflows/runs/:id/reject', async (req, reply) => {
        try {
            executor.reject(req.params.id, req.body?.reason);
            return { ok: true };
        }
        catch (err) {
            return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post('/api/workflows/runs/:id/cancel', async (req, reply) => {
        try {
            executor.cancel(req.params.id, req.body?.reason);
            return { ok: true };
        }
        catch (err) {
            return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post('/api/workflows/runs/:id/resume', async (req, reply) => {
        const run = sq.getWorkflowRunById(req.params.id);
        if (!run)
            return reply.code(404).send({ error: 'run not found' });
        const loaded = loadWorkflowByName(projectRoot, run.workflowName);
        if (!loaded)
            return reply.code(404).send({ error: 'workflow definition missing' });
        const promise = executor.resume(loaded.workflow, req.params.id, { projectRoot });
        promise.catch(() => { });
        return { ok: true };
    });
}
//# sourceMappingURL=workflow.js.map