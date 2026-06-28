/**
 * REQ-STATUSLINE-005.A4 — the workflow executor mirrors a run's status into the
 * `.specship/session/active-run.json` marker so `specship statusline` can show
 * the active run without opening the workflow DB.
 *
 * A live state (running / paused / failed-but-resumable) writes the marker; a
 * terminal end (completed / cancelled) clears it. The executor must be bound to
 * a project root for any of this to happen — without one it's a no-op.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SpecShip from '../src';
import { WorkflowExecutor } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import { readActiveRun, writeActiveRun } from '../src/statusline/active-run';
import { WorkflowRun } from '../src/types';

function runRow(over: Partial<WorkflowRun> = {}): WorkflowRun {
  const now = 1;
  return {
    id: 'r1',
    workflowName: 'spec-implement',
    status: 'running',
    inputs: { SPEC_ID: 'REQ-STATUSLINE-005' },
    lastActivityAt: now,
    createdAt: now,
    ...over,
  };
}

describe('workflow executor → active-run marker (REQ-STATUSLINE-005.A4)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-activerun-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function newExecutor(boundRoot: string | undefined) {
    const sq = cg.getSpecQueries();
    return new WorkflowExecutor(sq, new WorktreeProvider(sq), boundRoot);
  }

  it('approving a paused run writes the run + status to the marker', () => {
    const sq = cg.getSpecQueries();
    sq.insertWorkflowRun(runRow({
      status: 'paused',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    }));

    newExecutor(dir).approve('r1');

    const marker = readActiveRun(dir)!;
    expect(marker).not.toBeNull();
    expect(marker.specId).toBe('REQ-STATUSLINE-005');
    // Archon paused→failed-but-resumable convention: still a live, visible run.
    expect(marker.status).toBe('failed');
  });

  it('cancelling a run clears the marker (terminal state)', () => {
    // Seed an active marker as if a run were in flight.
    writeActiveRun(dir, 'REQ-STATUSLINE-005', 'running');
    expect(readActiveRun(dir)).not.toBeNull();

    const sq = cg.getSpecQueries();
    sq.insertWorkflowRun(runRow({ status: 'running' }));
    newExecutor(dir).cancel('r1');

    expect(readActiveRun(dir)).toBeNull();
  });

  it('an executor with no bound project root never writes the marker (back-compat)', () => {
    const sq = cg.getSpecQueries();
    sq.insertWorkflowRun(runRow({
      status: 'paused',
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'ok?' } },
    }));

    newExecutor(undefined).approve('r1');

    expect(readActiveRun(dir)).toBeNull();
  });
});
