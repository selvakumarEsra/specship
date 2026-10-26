/**
 * REQ-PIPETRUST-006 — a failed workflow step keeps its evidence.
 *
 *   A1 — a failed bash step's error keeps the TAIL of its output (where test
 *        runners print their summary) and the full output is attached.
 *   A2 — the executor stores a failed step's output in the run record and
 *        writes it as the step's artifact; the node stays `failed` so resume
 *        still re-runs it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SpecShip from '../src';
import { WorkflowExecutor, resetFailedNodes } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import { BashRunner, specshipCli } from '../src/workflows/runners/bash';
import type { WorkflowDefinition, BashNode } from '../src/workflows/schemas/workflow';
import type { NodeOutput } from '../src/workflows/condition-evaluator';

const posix = process.platform !== 'win32';

// ~10k lines of noise, then the summary line a test runner would print last.
const NOISY_FAILING_SCRIPT =
  'echo "FIRST LINE"; for i in $(seq 1 10000); do echo "noise line $i"; done; ' +
  'echo "SUMMARY: 3 failed, 997 passed"; exit 1';

describe('REQ-PIPETRUST-006 failed step evidence', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-evidence-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.runIf(posix)(
    'a failed bash step keeps the tail of its output in the error and the full output attached (REQ-PIPETRUST-006.A1)',
    async function failedBashKeepsOutputTail() {
      const node: BashNode = { id: 'verify', kind: 'bash', bash: NOISY_FAILING_SCRIPT };
      const result = await new BashRunner().run(node, {
        cwd: dir,
        artifactsDir: dir,
        logsDir: dir,
        runId: 'r1',
        outputs: new Map(),
      });

      expect(result.status).toBe('failed');
      if (result.status !== 'failed') return;
      expect(result.error).toMatch(/^bash exited with code 1: …/);
      expect(result.error).toContain('SUMMARY: 3 failed, 997 passed');
      expect(result.error).not.toContain('FIRST LINE');
      expect(result.output?.text).toContain('FIRST LINE');
      expect(result.output?.text).toContain('SUMMARY: 3 failed, 997 passed');
    },
    30_000
  );

  it.runIf(posix)(
    'the executor stores a failed step output in the run record and writes its artifact (REQ-PIPETRUST-006.A2)',
    async function failedStepOutputIsStored() {
      const cg = await SpecShip.init(dir);
      try {
        const sq = cg.getSpecQueries();
        const executor = new WorkflowExecutor(sq, new WorktreeProvider(sq), dir);
        const WF: WorkflowDefinition = {
          name: 'evidence-probe',
          nodes: [
            { id: 'verify', kind: 'bash', bash: 'echo "starting"; echo "TESTS FAILED: 2" >&2; exit 1' },
            { id: 'after', kind: 'bash', bash: 'echo after', depends_on: ['verify'] },
          ],
        };

        const { run } = await executor.start(WF, { projectRoot: dir });
        const persisted = sq.getWorkflowRunById(run.id)!;
        expect(persisted.status).toBe('failed');

        const meta = persisted.metadata as {
          outputs: Record<string, NodeOutput>;
          nodeStates: Record<string, string>;
          completedNodes: string[];
        };
        expect(meta.outputs.verify?.text).toContain('starting');
        expect(meta.outputs.verify?.text).toContain('TESTS FAILED: 2');
        // Storing the output must not make the node count as completed.
        expect(meta.nodeStates.verify).toBe('failed');
        expect(meta.completedNodes).not.toContain('verify');
        // ...and resume still resets it to pending so it re-runs.
        expect((resetFailedNodes(WF, persisted.metadata).nodeStates as Record<string, string>).verify)
          .toBe('pending');

        const artifact = path.join(dir, '.specship', 'artifacts', 'runs', run.id, 'nodes', 'verify.md');
        expect(fs.existsSync(artifact)).toBe(true);
        expect(fs.readFileSync(artifact, 'utf8')).toContain('TESTS FAILED: 2');
      } finally {
        cg.close();
      }
    },
    30_000
  );
});

/**
 * REQ-PIPETRUST-006.A4 — a bash step launched by the SpecShip CLI is told which
 * CLI is running it, so it never falls back to an older `specship` on PATH.
 */
function bashStepsSeeTheRunningCli(): void {
  expect(specshipCli(['node', '/opt/x/dist/bin/specship.js'], '/usr/bin/node')).toEqual({
    node: '/usr/bin/node',
    script: '/opt/x/dist/bin/specship.js',
  });
  expect(specshipCli(['node', '/usr/local/bin/specship'], '/usr/bin/node')?.script).toBe('/usr/local/bin/specship');
  // Not the CLI (e.g. vitest itself) → nothing exported.
  expect(specshipCli(['node', '/repo/node_modules/vitest/vitest.mjs'], '/usr/bin/node')).toBeNull();
}

describe('the running CLI is exported to bash steps (REQ-PIPETRUST-006)', () => {
  it('bash steps see the CLI running the workflow (REQ-PIPETRUST-006.A4)', bashStepsSeeTheRunningCli);
});
