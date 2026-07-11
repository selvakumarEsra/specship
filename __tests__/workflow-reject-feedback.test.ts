/**
 * WF-REJECT-DOC (specs/workflow-reject-feedback.md) — reject is feedback,
 * never disposal:
 *
 *   001 — rejecting parks the run as `rejected` with worktree + artifacts kept.
 *   002 — the gate's `on_reject` prompt fires (on resume) with the feedback.
 *   003 — reject-with-comment → resume → revise in the same run → re-pause.
 *   004 — no status transition destroys a worktree; only explicit purge does.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SpecShip from '../src';
import { WorkflowExecutor } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import type { WorkflowDefinition, DagNode } from '../src/workflows/schemas/workflow';
import type { NodeRunner, NodeRunResult, RunnerContext } from '../src/workflows/runners/types';

const WORKFLOW: WorkflowDefinition = {
  name: 'reject-probe',
  nodes: [
    { id: 'implement', kind: 'prompt', prompt: 'implement the thing' },
    {
      id: 'gate',
      kind: 'approval',
      message: 'ship it?',
      depends_on: ['implement'],
      on_reject: { prompt: 'Revise your work on: $implement.output', max_attempts: 2 },
    },
  ],
};

class SpyWorktrees extends WorktreeProvider {
  destroyed: string[] = [];
  override destroy(envId: string): void {
    this.destroyed.push(envId);
  }
}

describe('workflow reject = feedback (WF-REJECT-DOC)', () => {
  let dir: string;
  let cg: SpecShip;
  let worktrees: SpyWorktrees;
  let executor: WorkflowExecutor;
  /** Prompts the stubbed prompt runner received, in order. */
  let promptsRun: Array<{ id: string; prompt: string; cwd: string }>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-reject-'));
    cg = await SpecShip.init(dir);
    const sq = cg.getSpecQueries();
    worktrees = new SpyWorktrees(sq);
    executor = new WorkflowExecutor(sq, worktrees, dir);
    promptsRun = [];
    const runners = (executor as unknown as { runners: Map<string, NodeRunner> }).runners;
    runners.set('prompt', {
      kind: 'prompt',
      run: async (node: DagNode, ctx: RunnerContext): Promise<NodeRunResult> => {
        const prompt = (node as { prompt?: string }).prompt ?? '';
        promptsRun.push({ id: node.id, prompt, cwd: ctx.cwd });
        return { status: 'completed', output: { text: `done: ${node.id}` } };
      },
    });
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function startToGate(): Promise<string> {
    const { run } = await executor.start(WORKFLOW, { projectRoot: dir });
    expect(cg.getSpecQueries().getWorkflowRunById(run.id)?.status).toBe('paused');
    return run.id;
  }

  it('001.A1/A2: reject parks the run as `rejected` (not cancelled) and destroys nothing', async () => {
    const runId = await startToGate();
    executor.reject(runId, 'wrong approach — use the existing helper');

    const run = cg.getSpecQueries().getWorkflowRunById(runId)!;
    expect(run.status).toBe('rejected');
    expect(run.completedAt).toBeFalsy(); // parked, not terminal
    expect(run.errorMessage).toContain('wrong approach');
    expect(worktrees.destroyed).toEqual([]);
  });

  it('002+003: resume after reject runs the on_reject prompt with the feedback, then re-pauses at the gate', async () => {
    const runId = await startToGate();
    executor.reject(runId, 'rename the flag to --keep-data');
    await executor.resume(WORKFLOW, runId, { projectRoot: dir });

    // The revise prompt ran, carrying both the on_reject template (with the
    // $implement.output ref resolved) and the reviewer's comment.
    const revise = promptsRun.find((p) => p.id.startsWith('gate__revise_'));
    expect(revise).toBeDefined();
    expect(revise!.prompt).toContain('Revise your work on: done: implement');
    expect(revise!.prompt).toContain('rename the flag to --keep-data');

    // Back at the gate, awaiting re-review — the revise loop closed.
    expect(cg.getSpecQueries().getWorkflowRunById(runId)?.status).toBe('paused');

    // The revise output is recorded as a run artifact.
    const artifactsDir = path.join(dir, '.specship', 'artifacts', 'runs', runId, 'nodes');
    const files = fs.existsSync(artifactsDir) ? fs.readdirSync(artifactsDir) : [];
    expect(files.some((f) => f.startsWith('gate__revise_'))).toBe(true);
  });

  it('003: max_attempts exhausts — a third rejection cannot resume into revision', async () => {
    const runId = await startToGate();
    executor.reject(runId, 'round 1');
    await executor.resume(WORKFLOW, runId, { projectRoot: dir });
    executor.reject(runId, 'round 2');
    await executor.resume(WORKFLOW, runId, { projectRoot: dir });
    executor.reject(runId, 'round 3');
    await expect(executor.resume(WORKFLOW, runId, { projectRoot: dir })).rejects.toThrow(/exhausted/);
    // Still parked — nothing was destroyed by the refusal.
    expect(cg.getSpecQueries().getWorkflowRunById(runId)?.status).toBe('rejected');
    expect(worktrees.destroyed).toEqual([]);
  });

  it('004: cancel keeps the worktree; only purge destroys it', async () => {
    const sq = cg.getSpecQueries();
    const runId = await startToGate();
    // Simulate an isolation worktree on the run row.
    const run = sq.getWorkflowRunById(runId)!;
    sq.updateWorkflowRun({ ...run, isolationEnvId: 'env-test-1' });

    executor.cancel(runId, 'changed my mind');
    expect(worktrees.destroyed).toEqual([]); // cancel no longer tears down

    executor.purge(runId);
    expect(worktrees.destroyed).toEqual(['env-test-1']);
  });

  it('004: purge refuses while the run is paused or running', async () => {
    const runId = await startToGate(); // paused at gate
    expect(() => executor.purge(runId)).toThrow(/cancel or finish/);
  });
});
