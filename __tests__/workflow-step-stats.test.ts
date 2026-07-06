/**
 * REQ-DESKTOP-023 — the executor forwards a runner's per-node stats
 * (cost / duration / model) into the `step_completed` event so the run
 * detail view can render per-node cost without a schema change. Stats are
 * optional-field additive: a runner that reports none produces an event
 * without a `stats` key, and old run records keep rendering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SpecShip from '../src';
import { WorkflowExecutor } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import type { WorkflowDefinition } from '../src/workflows/schemas/workflow';
import type { NodeRunner, NodeRunResult } from '../src/workflows/runners/types';

const WORKFLOW: WorkflowDefinition = {
  name: 'stats-probe',
  nodes: [
    { id: 'agent', kind: 'prompt', prompt: 'do the thing' },
    { id: 'shell', kind: 'bash', bash: 'true', depends_on: ['agent'] },
  ],
};

describe('executor step_completed stats (REQ-DESKTOP-023)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-stepstats-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function stubRunner(kind: 'prompt' | 'bash', result: NodeRunResult): NodeRunner {
    return { kind, run: async () => result };
  }

  it('carries stats from the runner and omits the key when the runner reports none', async () => {
    const sq = cg.getSpecQueries();
    const executor = new WorkflowExecutor(sq, new WorktreeProvider(sq));
    // Swap the spawning runners for deterministic stubs (private map —
    // reach in the same way the executor dispatches).
    const runners = (executor as unknown as { runners: Map<string, NodeRunner> }).runners;
    runners.set('prompt', stubRunner('prompt', {
      status: 'completed',
      output: { text: 'agent output' },
      stats: { costUsd: 0.42, durationMs: 1234, model: 'claude-sonnet-5' },
    }));
    runners.set('bash', stubRunner('bash', { status: 'completed', output: { text: 'ok' } }));

    const { run, nodeStates } = await executor.start(WORKFLOW, { projectRoot: dir });
    // The returned run object is the pre-finalize snapshot — the DB row is
    // the source of truth for the terminal status.
    expect(sq.getWorkflowRunById(run.id)?.status).toBe('completed');
    expect(nodeStates.get('agent')).toBe('completed');
    expect(nodeStates.get('shell')).toBe('completed');

    const events = sq.getEventsByRun(run.id);
    const completed = events.filter((e) => e.eventType === 'step_completed');
    expect(completed).toHaveLength(2);

    const agent = completed.find((e) => e.data?.stepId === 'agent')!;
    expect(agent.data?.stats).toEqual({ costUsd: 0.42, durationMs: 1234, model: 'claude-sonnet-5' });

    const shell = completed.find((e) => e.data?.stepId === 'shell')!;
    expect(shell.data && 'stats' in shell.data).toBe(false);
  });
});
