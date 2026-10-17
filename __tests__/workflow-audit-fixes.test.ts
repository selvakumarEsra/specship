/**
 * Docs-audit fixes for the workflow executor (specs/docs-audit-fixes.md):
 *
 *   REQ-AUDFIX-003 — a rejection revision resolves its references, replaces
 *                    the output it revises, and never strands a run `running`.
 *   REQ-AUDFIX-004 — resuming a failed run retries the failed step.
 *   REQ-AUDFIX-005 — workflow-level `model` / `systemPromptAppend` reach
 *                    every prompt node (incl. on_reject revisions).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';

import SpecShip from '../src';
import { WorkflowExecutor } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import { bundledDefaults } from '../src/workflows/defaults';
import {
  validateWorkflow,
  type WorkflowDefinition,
  type DagNode,
  type PromptNode,
  type ApprovalNode,
} from '../src/workflows/schemas/workflow';
import type { NodeRunner, NodeRunResult, RunnerContext } from '../src/workflows/runners/types';

type PromptBehaviour = (node: PromptNode) => NodeRunResult;

describe('workflow docs-audit fixes', () => {
  let dir: string;
  let cg: SpecShip;
  let executor: WorkflowExecutor;
  /** Every prompt node the stubbed runner received (post-resolution). */
  let promptsRun: PromptNode[];
  /** Per-node behaviour override; default = complete with `done: <id>`. */
  let behaviour: Record<string, PromptBehaviour>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audfix-'));
    cg = await SpecShip.init(dir);
    const sq = cg.getSpecQueries();
    executor = new WorkflowExecutor(sq, new WorktreeProvider(sq), dir);
    promptsRun = [];
    behaviour = {};
    const runners = (executor as unknown as { runners: Map<string, NodeRunner> }).runners;
    runners.set('prompt', {
      kind: 'prompt',
      run: async (node: DagNode, _ctx: RunnerContext): Promise<NodeRunResult> => {
        const p = node as PromptNode;
        promptsRun.push(p);
        const b = behaviour[p.id];
        if (b) return b(p);
        return { status: 'completed', output: { text: `done: ${p.id}` } };
      },
    });
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const status = (runId: string) => cg.getSpecQueries().getWorkflowRunById(runId)?.status;

  // ===========================================================================
  // REQ-AUDFIX-003
  // ===========================================================================

  describe('REQ-AUDFIX-003 on_reject revises', () => {
    const REVISING: WorkflowDefinition = {
      name: 'revise-probe',
      nodes: [
        { id: 'plan', kind: 'prompt', prompt: 'make a plan' },
        {
          id: 'gate',
          kind: 'approval',
          message: 'ok?',
          depends_on: ['plan'],
          on_reject: { prompt: 'Revise this plan:\n$plan.output', revises: 'plan', max_attempts: 3 },
        },
        { id: 'implement', kind: 'prompt', prompt: 'implement per: $plan.output', depends_on: ['gate'] },
      ],
    };

    it('REQ-AUDFIX-003.A1: on_reject.revises naming a workflow node validates', () => {
      const res = validateWorkflow({
        name: 'w',
        nodes: [
          { id: 'plan', kind: 'prompt', prompt: 'p' },
          {
            id: 'gate',
            kind: 'approval',
            message: 'm',
            depends_on: ['plan'],
            on_reject: { prompt: 'revise', revises: 'plan' },
          },
        ],
      });
      expect(res.ok).toBe(true);
      expect((res.workflow!.nodes[1] as ApprovalNode).on_reject?.revises).toBe('plan');
    });

    it('REQ-AUDFIX-003.A1: on_reject.revises naming no node is a validation error', () => {
      const res = validateWorkflow({
        name: 'w',
        nodes: [
          { id: 'plan', kind: 'prompt', prompt: 'p' },
          {
            id: 'gate',
            kind: 'approval',
            message: 'm',
            depends_on: ['plan'],
            on_reject: { prompt: 'revise', revises: 'nope' },
          },
        ],
      });
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.path === 'nodes[1].on_reject.revises' && /unknown node id "nope"/.test(e.message))).toBe(true);
    });

    it('REQ-AUDFIX-003.A1: a non-string revises is a validation error', () => {
      const res = validateWorkflow({
        name: 'w',
        nodes: [
          { id: 'plan', kind: 'prompt', prompt: 'p' },
          { id: 'gate', kind: 'approval', message: 'm', on_reject: { prompt: 'revise', revises: 42 } },
        ],
      });
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.path === 'nodes[1].on_reject.revises')).toBe(true);
    });

    it('REQ-AUDFIX-003.A2: the revision replaces the revised node output for downstream refs', async () => {
      behaviour['gate__revise_1'] = () => ({ status: 'completed', output: { text: 'REVISED PLAN' } });
      const { run } = await executor.start(REVISING, { projectRoot: dir });
      expect(status(run.id)).toBe('paused');

      executor.reject(run.id, 'add a rollback step');
      await executor.resume(REVISING, run.id, { projectRoot: dir });
      expect(status(run.id)).toBe('paused'); // back at the gate

      // The revise prompt resolved $plan.output against the ORIGINAL plan.
      const revise = promptsRun.find((p) => p.id === 'gate__revise_1')!;
      expect(revise.prompt).toContain('Revise this plan:\ndone: plan');
      expect(revise.prompt).toContain('add a rollback step');

      // The persisted outputs now carry the revision under `plan`.
      const meta = cg.getSpecQueries().getWorkflowRunById(run.id)!.metadata as {
        outputs: Record<string, { text: string }>;
      };
      expect(meta.outputs.plan.text).toBe('REVISED PLAN');
      expect(meta.outputs['gate__revise_1'].text).toBe('REVISED PLAN');

      // Approve → downstream `implement` reads the revision, not the original.
      executor.approve(run.id);
      await executor.resume(REVISING, run.id, { projectRoot: dir });
      expect(status(run.id)).toBe('completed');
      const impl = promptsRun.find((p) => p.id === 'implement')!;
      expect(impl.prompt).toBe('implement per: REVISED PLAN');
    });

    it('REQ-AUDFIX-003.A3: an unresolvable reference in the revise prompt leaves the run rejected with the error', async () => {
      const BAD: WorkflowDefinition = {
        name: 'bad-ref',
        nodes: [
          { id: 'plan', kind: 'prompt', prompt: 'make a plan' },
          {
            id: 'gate',
            kind: 'approval',
            message: 'ok?',
            depends_on: ['plan'],
            on_reject: { prompt: 'Revise using $gate.output' }, // gate has no output after reject
          },
        ],
      };
      const { run } = await executor.start(BAD, { projectRoot: dir });
      executor.reject(run.id, 'nope');
      await expect(executor.resume(BAD, run.id, { projectRoot: dir })).rejects.toThrow(/revision failed/);

      const after = cg.getSpecQueries().getWorkflowRunById(run.id)!;
      expect(after.status).toBe('rejected');
      expect(after.errorMessage).toMatch(/revision failed/);
      expect(after.errorMessage).toContain('gate');
    });

    it('REQ-AUDFIX-003.A3: a runner that throws during the revision leaves the run rejected', async () => {
      behaviour['gate__revise_1'] = () => {
        throw new Error('agent crashed');
      };
      const { run } = await executor.start(REVISING, { projectRoot: dir });
      executor.reject(run.id, 'fix it');
      await expect(executor.resume(REVISING, run.id, { projectRoot: dir })).rejects.toThrow(/agent crashed/);
      const after = cg.getSpecQueries().getWorkflowRunById(run.id)!;
      expect(after.status).toBe('rejected');
      expect(after.errorMessage).toContain('agent crashed');
    });

    it('REQ-AUDFIX-003.A3: a failed revision result leaves the run rejected', async () => {
      behaviour['gate__revise_1'] = () => ({ status: 'failed', error: 'model refused' });
      const { run } = await executor.start(REVISING, { projectRoot: dir });
      executor.reject(run.id, 'fix it');
      await expect(executor.resume(REVISING, run.id, { projectRoot: dir })).rejects.toThrow(/model refused/);
      const after = cg.getSpecQueries().getWorkflowRunById(run.id)!;
      expect(after.status).toBe('rejected');
      expect(after.errorMessage).toContain('model refused');
    });

    it('REQ-AUDFIX-003.A4: no bundled on_reject prompt references its own gate output; each revising gate declares a valid revises', () => {
      let gatesWithOnReject = 0;
      for (const bw of bundledDefaults) {
        const res = validateWorkflow(yaml.parse(bw.yaml));
        expect(res.ok, `${bw.name}: ${JSON.stringify(res.errors)}`).toBe(true);
        const ids = new Set(res.workflow!.nodes.map((n) => n.id));
        for (const node of res.workflow!.nodes) {
          if (node.kind !== 'approval') continue;
          const onReject = (node as ApprovalNode).on_reject;
          if (!onReject) continue;
          gatesWithOnReject++;
          expect(onReject.prompt, `${bw.name}:${node.id}`).not.toMatch(
            new RegExp(`\\$${node.id}\\.output\\b`)
          );
          expect(onReject.revises, `${bw.name}:${node.id} must declare revises`).toBeDefined();
          expect(ids.has(onReject.revises!)).toBe(true);
          // The revised node is upstream of the gate it belongs to.
          expect(onReject.revises).not.toBe(node.id);
        }
      }
      // spec-implement, spec-implement-mixed, spec-author ×2, claude-design-implement.
      expect(gatesWithOnReject).toBeGreaterThanOrEqual(5);
    });

    it('REQ-AUDFIX-003.A4: bundled revising gates target the expected nodes', () => {
      const expected: Record<string, Record<string, string>> = {
        'spec-implement': { approve_plan: 'plan' },
        'spec-implement-mixed': { approve_plan: 'plan' },
        'spec-author': { gap_review: 'draft', finalize: 'incorporate' },
        'claude-design-implement': { gap_review: 'draft_spec' },
      };
      for (const [name, gates] of Object.entries(expected)) {
        const bw = bundledDefaults.find((b) => b.name === name)!;
        expect(bw, name).toBeDefined();
        const wf = validateWorkflow(yaml.parse(bw.yaml)).workflow!;
        for (const [gateId, target] of Object.entries(gates)) {
          const gate = wf.nodes.find((n) => n.id === gateId) as ApprovalNode;
          expect(gate.on_reject?.revises, `${name}:${gateId}`).toBe(target);
        }
      }
    });
  });

  // ===========================================================================
  // REQ-AUDFIX-004
  // ===========================================================================

  describe('REQ-AUDFIX-004 resuming a failed run retries the failed step', () => {
    const FLOW: WorkflowDefinition = {
      name: 'retry-probe',
      nodes: [
        { id: 'a', kind: 'prompt', prompt: 'step a' },
        { id: 'b', kind: 'prompt', prompt: 'step b after $a.output', depends_on: ['a'] },
        { id: 'c', kind: 'prompt', prompt: 'step c after $b.output', depends_on: ['b'] },
      ],
    };

    async function failAtB(): Promise<string> {
      behaviour.b = () => ({ status: 'failed', error: 'boom' });
      const { run } = await executor.start(FLOW, { projectRoot: dir });
      expect(status(run.id)).toBe('failed');
      return run.id;
    }

    it('REQ-AUDFIX-004.A1: resume re-runs the failed node and its downstream, ending completed', async () => {
      const runId = await failAtB();
      delete behaviour.b;
      promptsRun = [];
      const res = await executor.resume(FLOW, runId, { projectRoot: dir });

      expect(promptsRun.map((p) => p.id)).toEqual(['b', 'c']);
      expect(res.nodeStates.get('b')).toBe('completed');
      expect(res.nodeStates.get('c')).toBe('completed');
      expect(status(runId)).toBe('completed');
    });

    it('REQ-AUDFIX-004.A1: nodes skipped only because of the failure are re-evaluated', async () => {
      const runId = await failAtB();
      // Simulate the legacy state: dependents recorded as skipped after the failure.
      const sq = cg.getSpecQueries();
      const run = sq.getWorkflowRunById(runId)!;
      const meta = run.metadata as Record<string, unknown>;
      sq.updateWorkflowRun({
        ...run,
        metadata: { ...meta, nodeStates: { a: 'completed', b: 'failed', c: 'skipped' } },
      });

      delete behaviour.b;
      promptsRun = [];
      const res = await executor.resume(FLOW, runId, { projectRoot: dir });
      expect(promptsRun.map((p) => p.id)).toEqual(['b', 'c']);
      expect(res.nodeStates.get('c')).toBe('completed');
      expect(status(runId)).toBe('completed');
    });

    it('REQ-AUDFIX-004.A2: completed nodes are not re-run on resume', async () => {
      const runId = await failAtB();
      delete behaviour.b;
      promptsRun = [];
      await executor.resume(FLOW, runId, { projectRoot: dir });
      expect(promptsRun.some((p) => p.id === 'a')).toBe(false);
      // `a`'s original output still feeds `b`.
      expect(promptsRun.find((p) => p.id === 'b')!.prompt).toBe('step b after done: a');
    });

    it('REQ-AUDFIX-004.A3: a retried node that fails again ends the run failed, never completed', async () => {
      const runId = await failAtB();
      promptsRun = [];
      const res = await executor.resume(FLOW, runId, { projectRoot: dir }); // b still fails
      expect(promptsRun.map((p) => p.id)).toEqual(['b']);
      expect(res.nodeStates.get('b')).toBe('failed');
      const after = cg.getSpecQueries().getWorkflowRunById(runId)!;
      expect(after.status).toBe('failed');
      expect(after.errorMessage).toContain('boom');
    });
  });

  // ===========================================================================
  // REQ-AUDFIX-005
  // ===========================================================================

  describe('REQ-AUDFIX-005 workflow-level model + systemPromptAppend', () => {
    const WF: WorkflowDefinition = {
      name: 'defaults-probe',
      model: 'wf-model',
      systemPromptAppend: 'WORKFLOW RULES',
      nodes: [
        { id: 'plain', kind: 'prompt', prompt: 'p1' },
        {
          id: 'custom',
          kind: 'prompt',
          prompt: 'p2',
          model: 'node-model',
          systemPromptAppend: 'NODE RULES',
          depends_on: ['plain'],
        },
        {
          id: 'gate',
          kind: 'approval',
          message: 'ok?',
          depends_on: ['custom'],
          on_reject: { prompt: 'revise $custom.output', revises: 'custom' },
        },
      ],
    };

    it('REQ-AUDFIX-005.A1: a node without model runs with the workflow model; a node model wins', async () => {
      await executor.start(WF, { projectRoot: dir });
      expect(promptsRun.find((p) => p.id === 'plain')!.model).toBe('wf-model');
      expect(promptsRun.find((p) => p.id === 'custom')!.model).toBe('node-model');
    });

    it('REQ-AUDFIX-005.A1: with no workflow model, a model-less node keeps none', async () => {
      await executor.start({ name: 'none', nodes: [{ id: 'x', kind: 'prompt', prompt: 'x' }] }, { projectRoot: dir });
      expect(promptsRun[0]!.model).toBeUndefined();
      expect(promptsRun[0]!.systemPromptAppend).toBeUndefined();
    });

    it('REQ-AUDFIX-005.A2: workflow systemPromptAppend reaches every prompt node; node value is appended after it', async () => {
      await executor.start(WF, { projectRoot: dir });
      expect(promptsRun.find((p) => p.id === 'plain')!.systemPromptAppend).toBe('WORKFLOW RULES');
      expect(promptsRun.find((p) => p.id === 'custom')!.systemPromptAppend).toBe(
        'WORKFLOW RULES\n\nNODE RULES'
      );
    });

    it('REQ-AUDFIX-005.A2: on_reject revisions get the workflow model and systemPromptAppend', async () => {
      const { run } = await executor.start(WF, { projectRoot: dir });
      expect(status(run.id)).toBe('paused');
      executor.reject(run.id, 'tighten it');
      await executor.resume(WF, run.id, { projectRoot: dir });
      const revise = promptsRun.find((p) => p.id === 'gate__revise_1')!;
      expect(revise.model).toBe('wf-model');
      expect(revise.systemPromptAppend).toBe('WORKFLOW RULES');
    });
  });
});
