/**
 * DAG workflow executor.
 *
 * Orchestrates a `WorkflowDefinition` end-to-end:
 *   1. Topological sort of nodes (`depends_on` edges).
 *   2. For each node, check its `trigger_rule` against upstream states +
 *      its `when:` condition. Skip when gates fail.
 *   3. Dispatch to the right runner (prompt / bash / script / approval / cancel).
 *   4. On `paused` → persist state and return; resume() picks up later.
 *   5. On `failed` → respect `retry` config (transient vs all).
 *   6. On `cancelled` → mark all unstarted downstreams as skipped and stop.
 *
 * Persisted state: workflow_runs row tracks lifecycle status, completed
 * node IDs, and approval context. workflow_events rows form an append-only
 * audit trail. Artifacts go to `<artifactsDir>/nodes/<id>.{md,meta.json}`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import {
  WorkflowDefinition,
  DagNode,
  PromptNode,
  BashNode,
  ScriptNode,
  ApprovalNode,
  CancelNode,
  TriggerRule,
} from './schemas/workflow';
import {
  WorkflowRun,
  WorkflowNodeState,
  ApprovalContext,
  WorkflowRunStatus,
} from '../types';
import { SpecQueries } from '../db/spec-queries';
import { WorktreeProvider } from '../isolation/worktree';
import { getSpecShipDir } from '../directory';
import { writeActiveRun, clearActiveRun, ActiveRunEta } from '../statusline';
import { estimateRunEta } from './eta';
import {
  NodeOutput,
  substituteRefs,
  evaluateCondition,
  OutputRefError,
} from './condition-evaluator';
import { NodeRunner, RunnerContext, NodeRunResult } from './runners/types';
import { PromptRunner } from './runners/prompt';
import { BashRunner } from './runners/bash';
import { ScriptRunner } from './runners/script';
import { ApprovalRunner } from './runners/approval';
import { CancelRunner } from './runners/cancel';

export interface ExecuteOptions {
  /** Project root (used to derive default cwd + spawn the worktree). */
  projectRoot: string;
  /** Workflow inputs (e.g., SPEC_ID). */
  inputs?: Record<string, string>;
  /** Additional variables ($CONTEXT, etc.). */
  variables?: Record<string, string>;
  /** Verbose logging. */
  verbose?: boolean;
  /** Override the run ID (mostly for resume). Defaults to a fresh UUID. */
  runId?: string;
}

export interface ExecuteResult {
  run: WorkflowRun;
  /** Final node states (id → state). */
  nodeStates: Map<string, WorkflowNodeState>;
  /** Node outputs (for caller inspection). */
  outputs: Map<string, NodeOutput>;
}

export class WorkflowExecutor {
  private specQueries: SpecQueries;
  private worktrees: WorktreeProvider;
  private runners: Map<DagNode['kind'], NodeRunner>;
  /**
   * Project root this executor is bound to. Used to mirror the active run into
   * the status-line marker (REQ-STATUSLINE-005.A4). Optional so existing
   * callers/tests that don't pass it still construct; when absent the marker
   * is simply not written.
   */
  private projectRoot?: string;

  constructor(specQueries: SpecQueries, worktrees: WorktreeProvider, projectRoot?: string) {
    this.specQueries = specQueries;
    this.worktrees = worktrees;
    this.projectRoot = projectRoot;
    this.runners = new Map<DagNode['kind'], NodeRunner>([
      ['prompt', new PromptRunner()],
      ['bash', new BashRunner()],
      ['script', new ScriptRunner()],
      ['approval', new ApprovalRunner()],
      ['cancel', new CancelRunner()],
    ]);
  }

  // ===========================================================================
  // Public entry points: start, resume
  // ===========================================================================

  async start(
    workflow: WorkflowDefinition,
    opts: ExecuteOptions
  ): Promise<ExecuteResult> {
    const runId = opts.runId ?? randomUUID();
    const now = Date.now();

    // Pre-flight: required capabilities. `specship` is always available
    // (we're running inside it); `git` and `tests` are checked lazily by
    // the runner that uses them.
    // (We could lift the check earlier, but per Archon's pattern we fail
    // at first use rather than building a global capability registry.)

    // Worktree setup (if requested).
    let cwd = opts.projectRoot;
    let isolationEnvId: string | undefined;
    if (workflow.worktree?.enabled) {
      try {
        const env = this.worktrees.create({
          repoRoot: opts.projectRoot,
          workflowName: workflow.name,
          workflowRunId: runId,
          baseBranch: workflow.worktree.base_branch,
        });
        cwd = env.workingPath;
        isolationEnvId = env.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const run: WorkflowRun = {
          id: runId,
          workflowName: workflow.name,
          status: 'failed',
          inputs: opts.inputs,
          isolationEnvId: undefined,
          startedAt: now,
          completedAt: now,
          lastActivityAt: now,
          createdAt: now,
          errorMessage: `Worktree setup failed: ${msg}`,
        };
        this.specQueries.insertWorkflowRun(run);
        return {
          run,
          nodeStates: new Map(),
          outputs: new Map(),
        };
      }
    }

    // Set up artifacts + logs dirs.
    const specshipRoot = getSpecShipDir(opts.projectRoot);
    const artifactsDir = path.join(specshipRoot, 'artifacts', 'runs', runId, 'nodes');
    const logsDir = path.join(specshipRoot, 'logs');
    try {
      fs.mkdirSync(artifactsDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });
    } catch {
      // Non-fatal — artifact writes will throw if directory creation actually failed,
      // and the executor catches and surfaces those.
    }

    const run: WorkflowRun = {
      id: runId,
      workflowName: workflow.name,
      status: 'running',
      inputs: opts.inputs,
      isolationEnvId,
      startedAt: now,
      lastActivityAt: now,
      createdAt: now,
      metadata: {
        nodeStates: {},
        completedNodes: [],
      },
    };
    this.specQueries.insertWorkflowRun(run);
    this.syncActiveRunMarker(run.status, run.inputs, run.id);
    this.event(runId, 'run_started', { workflowName: workflow.name, inputs: opts.inputs });

    return this.driveExecution(workflow, run, cwd, artifactsDir, logsDir, opts);
  }

  /**
   * Resume a paused (approved) or failed run. Skips already-completed nodes.
   */
  async resume(
    workflow: WorkflowDefinition,
    runId: string,
    opts: Omit<ExecuteOptions, 'runId'>
  ): Promise<ExecuteResult> {
    const existing = this.specQueries.getWorkflowRunById(runId);
    if (!existing) {
      throw new Error(`Run ${runId} not found`);
    }
    if (existing.status !== 'paused' && existing.status !== 'failed') {
      throw new Error(`Run ${runId} is in state "${existing.status}" — cannot resume`);
    }

    const cwd = existing.isolationEnvId
      ? this.specQueries.getIsolationEnvById(existing.isolationEnvId)?.workingPath ??
        opts.projectRoot
      : opts.projectRoot;

    const artifactsDir = path.join(
      getSpecShipDir(opts.projectRoot),
      'artifacts',
      'runs',
      runId,
      'nodes'
    );
    const logsDir = path.join(getSpecShipDir(opts.projectRoot), 'logs');

    const now = Date.now();
    const refreshed: WorkflowRun = {
      ...existing,
      status: 'running',
      lastActivityAt: now,
      errorMessage: undefined,
    };
    this.specQueries.updateWorkflowRun(refreshed);
    this.syncActiveRunMarker(refreshed.status, refreshed.inputs, refreshed.id);
    this.event(runId, 'run_started', { resumed: true });

    return this.driveExecution(workflow, refreshed, cwd, artifactsDir, logsDir, opts);
  }

  cancel(runId: string, reason: string = 'cancelled by user'): void {
    const run = this.specQueries.getWorkflowRunById(runId);
    if (!run) return;
    if (
      run.status === 'completed' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return;
    }
    const now = Date.now();
    this.specQueries.updateWorkflowRun({
      ...run,
      status: 'cancelled',
      completedAt: now,
      lastActivityAt: now,
      errorMessage: reason,
    });
    this.syncActiveRunMarker('cancelled', run.inputs);
    this.event(runId, 'run_cancelled', { reason });

    // Tear down the worktree if any.
    if (run.isolationEnvId) {
      try {
        this.worktrees.destroy(run.isolationEnvId);
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Approve a paused run. The caller is expected to call `resume` afterwards
   * to actually continue execution. This separation matches Archon's pattern
   * (manage_run.approve only transitions state; resume drives the next step).
   */
  approve(runId: string, comment?: string): void {
    const run = this.specQueries.getWorkflowRunById(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== 'paused') {
      throw new Error(`Run ${runId} is in state "${run.status}" — cannot approve`);
    }
    const meta = (run.metadata as Record<string, unknown>) ?? {};
    const approval = meta.approval as ApprovalContext | undefined;
    // Mark the approval node as completed; capture user's comment as its output
    // if the gate requested it.
    if (approval) {
      const nodeStates = (meta.nodeStates as Record<string, WorkflowNodeState>) ?? {};
      nodeStates[approval.nodeId] = 'completed';
      const outputs = (meta.outputs as Record<string, { text: string }>) ?? {};
      if (approval.captureResponse && comment) {
        outputs[approval.nodeId] = { text: comment };
      } else if (!outputs[approval.nodeId]) {
        outputs[approval.nodeId] = { text: 'approved' };
      }
      const completedNodes = (meta.completedNodes as string[]) ?? [];
      if (!completedNodes.includes(approval.nodeId)) {
        completedNodes.push(approval.nodeId);
      }
      this.specQueries.updateWorkflowRun({
        ...run,
        status: 'failed', // Archon convention: paused → failed → resumable
        lastActivityAt: Date.now(),
        metadata: {
          ...meta,
          nodeStates,
          outputs,
          completedNodes,
          approval: undefined,
        },
      });
      // Archon's paused→failed-but-resumable convention: keep the run visible
      // in the status line (resume drives it back to running).
      this.syncActiveRunMarker('failed', run.inputs, run.id);
      this.event(runId, 'approval_granted', { nodeId: approval.nodeId, comment });
    }
  }

  reject(runId: string, reason?: string): void {
    const run = this.specQueries.getWorkflowRunById(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== 'paused') {
      throw new Error(`Run ${runId} is in state "${run.status}" — cannot reject`);
    }
    const meta = (run.metadata as Record<string, unknown>) ?? {};
    const approval = meta.approval as ApprovalContext | undefined;
    const now = Date.now();
    this.specQueries.updateWorkflowRun({
      ...run,
      status: 'cancelled',
      completedAt: now,
      lastActivityAt: now,
      errorMessage: reason ?? 'rejected at approval gate',
    });
    this.syncActiveRunMarker('cancelled', run.inputs);
    this.event(runId, 'approval_rejected', {
      nodeId: approval?.nodeId,
      reason: reason ?? null,
    });
    if (run.isolationEnvId) {
      try { this.worktrees.destroy(run.isolationEnvId); } catch { /* best-effort */ }
    }
  }

  // ===========================================================================
  // Core execution loop
  // ===========================================================================

  private async driveExecution(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    cwd: string,
    artifactsDir: string,
    logsDir: string,
    opts: ExecuteOptions
  ): Promise<ExecuteResult> {
    const order = topoSort(workflow.nodes);
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
    const meta = (run.metadata as Record<string, unknown>) ?? {};
    const nodeStates: Map<string, WorkflowNodeState> = new Map(
      Object.entries((meta.nodeStates as Record<string, WorkflowNodeState>) ?? {})
    );
    const outputs: Map<string, NodeOutput> = new Map(
      Object.entries((meta.outputs as Record<string, NodeOutput>) ?? {})
    );

    // Initialize states for nodes the resume didn't already cover.
    for (const node of workflow.nodes) {
      if (!nodeStates.has(node.id)) nodeStates.set(node.id, 'pending');
    }

    for (const nodeId of order) {
      const node = nodeById.get(nodeId);
      if (!node) continue;

      // Already settled? Skip.
      const current = nodeStates.get(nodeId);
      if (current === 'completed' || current === 'skipped' || current === 'failed') {
        continue;
      }

      // Check trigger_rule against upstream states.
      if (!this.checkTrigger(node, nodeStates)) {
        // Always-run nodes ignore upstream failures.
        if (!node.always_run) {
          nodeStates.set(nodeId, 'skipped');
          this.event(run.id, 'step_skipped', { stepId: nodeId, reason: 'trigger_rule' });
          continue;
        }
      }

      // Check when: condition.
      if (node.when !== undefined) {
        const ctx = this.makeSubstitutionContext(outputs, opts.inputs, opts.variables);
        const passes = evaluateCondition(node.when, ctx);
        if (!passes) {
          nodeStates.set(nodeId, 'skipped');
          this.event(run.id, 'step_skipped', {
            stepId: nodeId,
            reason: 'when_condition_false',
            when: node.when,
          });
          continue;
        }
      }

      // Run the node. Resolve any $refs in node fields first.
      let processed: DagNode;
      try {
        processed = this.resolveNodeRefs(node, outputs, opts.inputs, opts.variables);
      } catch (err) {
        if (err instanceof OutputRefError) {
          nodeStates.set(nodeId, 'failed');
          this.event(run.id, 'step_failed', {
            stepId: nodeId,
            error: err.message,
          });
          await this.finalize(run, workflow, nodeStates, outputs, 'failed', err.message);
          return { run, nodeStates, outputs };
        }
        throw err;
      }

      nodeStates.set(nodeId, 'running');
      this.event(run.id, 'step_started', { stepId: nodeId, kind: node.kind });

      const runner = this.runners.get(node.kind);
      if (!runner) {
        nodeStates.set(nodeId, 'failed');
        this.event(run.id, 'step_failed', { stepId: nodeId, error: `no runner for kind ${node.kind}` });
        await this.finalize(run, workflow, nodeStates, outputs, 'failed', `no runner for kind ${node.kind}`);
        return { run, nodeStates, outputs };
      }

      const runnerCtx: RunnerContext = {
        cwd,
        artifactsDir,
        logsDir,
        runId: run.id,
        inputs: opts.inputs,
        variables: opts.variables,
        outputs,
        verbose: opts.verbose,
        // Stream a step's live activity (agent tool calls / messages) into the
        // run view (WF-STREAM-DOC). Stamp the step id/kind so the UI can group.
        emitEvent: (type, data) =>
          this.event(run.id, type, { stepId: nodeId, stepKind: node.kind, ...data }),
      };

      const result = await this.runWithRetry(runner, processed, runnerCtx, node);

      switch (result.status) {
        case 'completed': {
          nodeStates.set(nodeId, 'completed');
          outputs.set(nodeId, result.output);
          this.event(run.id, 'step_completed', {
            stepId: nodeId,
            output_type: node.output_type,
            outputSize: result.output.text.length,
          });
          await this.writeArtifact(artifactsDir, node, result.output);
          break;
        }
        case 'failed': {
          nodeStates.set(nodeId, 'failed');
          this.event(run.id, 'step_failed', { stepId: nodeId, error: result.error });
          await this.finalize(run, workflow, nodeStates, outputs, 'failed', result.error);
          return { run, nodeStates, outputs };
        }
        case 'paused': {
          // Persist the approval gate and stop.
          this.event(run.id, 'approval_requested', {
            nodeId: result.approval.nodeId,
            message: result.approval.message,
          });
          await this.finalize(run, workflow, nodeStates, outputs, 'paused', undefined, result.approval);
          return { run, nodeStates, outputs };
        }
        case 'cancelled': {
          this.event(run.id, 'run_cancelled', { reason: result.reason });
          await this.finalize(run, workflow, nodeStates, outputs, 'cancelled', result.reason);
          return { run, nodeStates, outputs };
        }
      }
    }

    await this.finalize(run, workflow, nodeStates, outputs, 'completed');
    return { run, nodeStates, outputs };
  }

  private async runWithRetry(
    runner: NodeRunner,
    node: DagNode,
    ctx: RunnerContext,
    raw: DagNode
  ): Promise<NodeRunResult> {
    const retry = raw.retry ?? { max_attempts: 2, delay_ms: 3000, on_error: 'transient' };
    const maxAttempts = retry.max_attempts;
    const baseDelay = retry.delay_ms ?? 3000;
    const onError = retry.on_error ?? 'transient';

    let attempt = 0;
    let lastFail: NodeRunResult | null = null;
    while (attempt <= maxAttempts) {
      const result = await runner.run(node, ctx);
      if (result.status !== 'failed') return result;
      lastFail = result;
      const retryable = onError === 'all' || result.transient === true;
      if (!retryable) return result;
      attempt++;
      if (attempt > maxAttempts) break;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
    return lastFail ?? { status: 'failed', error: 'unknown failure' };
  }

  private checkTrigger(node: DagNode, states: Map<string, WorkflowNodeState>): boolean {
    if (!node.depends_on || node.depends_on.length === 0) return true;
    const rule: TriggerRule = node.trigger_rule ?? 'all_success';
    const upstreamStates = node.depends_on.map((id) => states.get(id) ?? 'pending');

    switch (rule) {
      case 'all_success':
        return upstreamStates.every((s) => s === 'completed');
      case 'one_success':
        return upstreamStates.some((s) => s === 'completed');
      case 'none_failed_min_one_success':
        return (
          upstreamStates.some((s) => s === 'completed') &&
          !upstreamStates.some((s) => s === 'failed')
        );
      case 'all_done':
        return upstreamStates.every(
          (s) => s === 'completed' || s === 'failed' || s === 'skipped'
        );
    }
    return false;
  }

  /**
   * Walk a node's string fields and substitute `$nodeId.output[.field]` /
   * `$INPUT.X` / `$VAR` references. Returns a shallow clone with substituted
   * values; the original is untouched.
   *
   * For prompt nodes we substitute `prompt` and `systemPromptAppend`.
   * For bash/script nodes we substitute `bash` / `script` (with bash-safe
   * shell escaping). For approval nodes we substitute `message`.
   * cancel: substitute `cancel` reason.
   */
  private resolveNodeRefs(
    node: DagNode,
    outputs: Map<string, NodeOutput>,
    inputs?: Record<string, string>,
    variables?: Record<string, string>
  ): DagNode {
    const ctx = this.makeSubstitutionContext(outputs, inputs, variables);
    switch (node.kind) {
      case 'prompt': {
        const p = node as PromptNode;
        return {
          ...p,
          prompt: substituteRefs(p.prompt, ctx, { forBash: false, nodeId: p.id }),
          systemPromptAppend: p.systemPromptAppend
            ? substituteRefs(p.systemPromptAppend, ctx, { forBash: false, nodeId: p.id })
            : undefined,
        };
      }
      case 'bash': {
        const b = node as BashNode;
        return {
          ...b,
          bash: substituteRefs(b.bash, ctx, { forBash: true, nodeId: b.id }),
        };
      }
      case 'script': {
        const s = node as ScriptNode;
        return {
          ...s,
          script: substituteRefs(s.script, ctx, { forBash: false, nodeId: s.id }),
        };
      }
      case 'approval': {
        const a = node as ApprovalNode;
        return {
          ...a,
          message: substituteRefs(a.message, ctx, { forBash: false, nodeId: a.id }),
        };
      }
      case 'cancel': {
        const c = node as CancelNode;
        return {
          ...c,
          cancel: substituteRefs(c.cancel, ctx, { forBash: false, nodeId: c.id }),
        };
      }
    }
  }

  private makeSubstitutionContext(
    outputs: Map<string, NodeOutput>,
    inputs?: Record<string, string>,
    variables?: Record<string, string>
  ) {
    return {
      outputs,
      inputs: inputs ?? {},
      variables: variables ?? {},
      spillDir: os.tmpdir(),
    };
  }

  /**
   * Mirror a run's status into the status-line active-run marker
   * (REQ-STATUSLINE-005.A4) so `specship statusline` can surface it without
   * opening the workflow DB. A terminal end (completed / cancelled) clears the
   * marker; any live state (running / paused / failed-but-resumable) writes it.
   * Best-effort and fully guarded — marker bookkeeping never affects a run.
   */
  private syncActiveRunMarker(status: WorkflowRunStatus, inputs?: Record<string, string>, runId?: string): void {
    if (!this.projectRoot) return;
    try {
      if (status === 'completed' || status === 'cancelled') {
        clearActiveRun(this.projectRoot);
      } else {
        // Embed the remaining-time estimate at write time (REQ-STATUSLINE-011)
        // so the status-line render path never opens the DB. Best-effort: any
        // estimator failure just writes a marker without an eta.
        let eta: ActiveRunEta | undefined;
        if (runId) {
          try {
            const e = estimateRunEta(this.specQueries.getRawDb(), runId);
            if (e.available) eta = { kind: 'range', lowMs: e.lowMs, highMs: e.highMs };
            else if (e.reason === 'paused') eta = { kind: 'waiting', sinceMs: e.waitingSinceMs };
          } catch { /* no estimate */ }
        }
        writeActiveRun(this.projectRoot, inputs?.SPEC_ID ?? null, status, eta);
      }
    } catch { /* never let the status-line marker affect a workflow run */ }
  }

  private async finalize(
    run: WorkflowRun,
    _workflow: WorkflowDefinition,
    nodeStates: Map<string, WorkflowNodeState>,
    outputs: Map<string, NodeOutput>,
    status: WorkflowRunStatus,
    errorMessage?: string,
    approval?: ApprovalContext
  ): Promise<void> {
    const now = Date.now();
    const meta: Record<string, unknown> = {
      nodeStates: Object.fromEntries(nodeStates.entries()),
      outputs: Object.fromEntries(outputs.entries()),
      completedNodes: [...nodeStates.entries()].filter(([, s]) => s === 'completed').map(([id]) => id),
    };
    if (approval) meta.approval = approval;

    this.specQueries.updateWorkflowRun({
      ...run,
      status,
      completedAt: status === 'paused' ? undefined : now,
      lastActivityAt: now,
      errorMessage,
      metadata: meta,
    });
    this.syncActiveRunMarker(status, run.inputs, run.id);

    if (status === 'completed') {
      this.event(run.id, 'run_completed', { duration_ms: now - run.createdAt });
      if (run.isolationEnvId) {
        // Successful runs leave the worktree for inspection by default.
        // A `specship workflow gc` command can clean these up later.
      }
    } else if (status === 'failed') {
      this.event(run.id, 'run_failed', { error: errorMessage });
    } else if (status === 'cancelled') {
      this.event(run.id, 'run_cancelled', { reason: errorMessage });
      if (run.isolationEnvId) {
        try { this.worktrees.destroy(run.isolationEnvId); } catch { /* best-effort */ }
      }
    } else if (status === 'paused') {
      this.event(run.id, 'run_paused', { approval_node: approval?.nodeId });
    }
  }

  private async writeArtifact(dir: string, node: DagNode, output: NodeOutput): Promise<void> {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const stem = path.join(dir, sanitizeFilename(node.id));
      fs.writeFileSync(`${stem}.md`, output.text);
      const metaPath = `${stem}.meta.json`;
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            nodeId: node.id,
            kind: node.kind,
            outputType: node.output_type,
            structured: output.structured ?? null,
            length: output.text.length,
          },
          null,
          2
        )
      );
    } catch {
      // Artifact failures never break the run — they're for human review only.
    }
  }

  private event(
    runId: string,
    eventType:
      | 'run_started'
      | 'run_completed'
      | 'run_failed'
      | 'run_cancelled'
      | 'run_paused'
      | 'step_started'
      | 'step_completed'
      | 'step_failed'
      | 'step_skipped'
      | 'tool_called'
      | 'agent_message'
      | 'artifact_created'
      | 'approval_requested'
      | 'approval_granted'
      | 'approval_rejected',
    data?: Record<string, unknown>
  ): void {
    this.specQueries.insertWorkflowEvent({
      workflowRunId: runId,
      eventType,
      data,
      createdAt: Date.now(),
    });
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Kahn's algorithm topological sort. Cycles fail loudly — the executor
 * refuses to run a workflow that doesn't form a DAG.
 */
export function topoSort(nodes: DagNode[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
    if (!adj.has(n.id)) adj.set(n.id, []);
  }
  for (const n of nodes) {
    for (const dep of n.depends_on ?? []) {
      adj.get(dep)?.push(n.id);
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (out.length !== nodes.length) {
    throw new Error('Workflow DAG contains a cycle — refusing to execute');
  }
  return out;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-').substring(0, 80);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
