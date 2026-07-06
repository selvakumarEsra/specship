/**
 * REQ-JIRA-006 — the workflow executor's `onRunCompleted` hook fires ONLY when
 * a run settles to `completed`; never on paused, failed, or cancelled. The JIRA
 * flow rides this seam to raise a PR (a completion the executor stays generic
 * about). No worktree, no network — the workflows here run in `cwd`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SpecShip from '../src';
import { WorkflowExecutor } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import { WorkflowRun } from '../src/types';
import type { WorkflowDefinition } from '../src/workflows/schemas/workflow';

describe('WorkflowExecutor onRunCompleted (REQ-JIRA-006)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-oncompleted-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function executor(hook: (run: WorkflowRun) => void | Promise<void>) {
    const sq = cg.getSpecQueries();
    return new WorkflowExecutor(sq, new WorktreeProvider(sq), dir, hook);
  }

  /** The persisted (settled) status — `start()` returns the pre-finalize run. */
  function settledStatus(id: string): string | undefined {
    return cg.getSpecQueries().getWorkflowRunById(id)?.status;
  }

  const oneBashNode = (bash: string): WorkflowDefinition =>
    ({
      name: 'hook-test',
      nodes: [{ id: 'go', kind: 'bash', bash, output_type: 'x' }],
    }) as unknown as WorkflowDefinition;

  const approvalWorkflow = (): WorkflowDefinition =>
    ({
      name: 'hook-test',
      nodes: [{ id: 'gate', kind: 'approval', message: 'ok?' }],
    }) as unknown as WorkflowDefinition;

  it('fires once, with the completed run, when the run completes', async () => {
    const seen: WorkflowRun[] = [];
    const result = await executor((run) => {
      seen.push(run);
    }).start(oneBashNode('echo hi'), { projectRoot: dir });

    expect(settledStatus(result.run.id)).toBe('completed');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.status).toBe('completed');
    expect(seen[0]!.id).toBe(result.run.id);
  });

  it('does NOT fire when the run pauses at an approval gate', async () => {
    let fired = 0;
    const result = await executor(() => {
      fired++;
    }).start(approvalWorkflow(), { projectRoot: dir });

    expect(settledStatus(result.run.id)).toBe('paused');
    expect(fired).toBe(0);
  });

  it('does NOT fire when the run fails', async () => {
    let fired = 0;
    const result = await executor(() => {
      fired++;
    }).start(oneBashNode('exit 1'), { projectRoot: dir });

    expect(settledStatus(result.run.id)).toBe('failed');
    expect(fired).toBe(0);
  });

  it('carries seeded runMetadata (jira) through to completion', async () => {
    const seen: WorkflowRun[] = [];
    await executor((run) => {
      seen.push(run);
    }).start(oneBashNode('echo hi'), {
      projectRoot: dir,
      runMetadata: { jira: { issueKey: 'PROJ-9' } },
    });

    expect(seen).toHaveLength(1);
    expect((seen[0]!.metadata as { jira?: { issueKey?: string } }).jira?.issueKey).toBe(
      'PROJ-9',
    );
  });

  it('a hook that throws never corrupts the settled run', async () => {
    const result = await executor(() => {
      throw new Error('hook boom');
    }).start(oneBashNode('echo hi'), { projectRoot: dir });

    expect(settledStatus(result.run.id)).toBe('completed');
  });
});
