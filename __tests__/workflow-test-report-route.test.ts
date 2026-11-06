/**
 * REQ-WFGATE-002 — GET /api/workflows/runs/:id/test-report serves the verify
 * step's vitest report for that run only, never reports a missing or broken
 * report as a pass, and keeps serving it after the run is purged.
 *
 * Real report files are written under a temp project's
 * `.specship/artifacts/runs/<id>/nodes/`; runs, events and the isolation env
 * are real rows in that project's SQLite (`SpecShip.init`).
 *
 * Also drives the REAL bash of the bundled verify node to prove a rerun that
 * fails before the tests leaves no report behind (REQ-WFGATE-002.A6).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import SpecShip from '../src';
import type { WorkflowRun } from '../src/types';
import { registerWorkflowRoutes } from '../server/src/routes/workflow';
import { discoverWorkflows } from '../src/workflows/discovery';
import { substituteRefs } from '../src/workflows/condition-evaluator';

let root: string;
let cg: SpecShip;
let app: FastifyInstance;

const sq = () => cg.getSpecQueries();

/** Append a step event at a fixed time (real workflow_events row). */
function addEvent(runId: string, eventType: string, stepId: string | null, createdAt: number): void {
  sq().insertWorkflowEvent({
    workflowRunId: runId,
    eventType: eventType as Parameters<ReturnType<typeof sq>['insertWorkflowEvent']>[0]['eventType'],
    data: stepId ? { stepId } : {},
    createdAt,
  });
}

function insertRun(id: string, over: Partial<WorkflowRun> = {}): void {
  sq().insertWorkflowRun({ id, workflowName: 'spec-implement', status: 'completed', inputs: {}, lastActivityAt: 1, createdAt: 1, ...over });
}

const nodesDir = (runId: string) => path.join(root, '.specship', 'artifacts', 'runs', runId, 'nodes');

function writeReport(runId: string, body: string): void {
  fs.mkdirSync(nodesDir(runId), { recursive: true });
  fs.writeFileSync(path.join(nodesDir(runId), 'test-report.json'), body);
}

function writeVerifyOutput(runId: string, text: string): void {
  fs.mkdirSync(nodesDir(runId), { recursive: true });
  fs.writeFileSync(path.join(nodesDir(runId), 'verify.md'), text);
}

const vitestReport = (p: number, f: number, pending = 0, todo = 0) => JSON.stringify({
  numTotalTests: p + f + pending + todo,
  numPassedTests: p, numFailedTests: f, numPendingTests: pending, numTodoTests: todo,
  success: f === 0, testResults: [],
});

/** A run whose verify step ran once, ending with `end`. */
function addRun(id: string, end: 'step_completed' | 'step_failed' | null, over: Partial<WorkflowRun> = {}): void {
  insertRun(id, { status: end === 'step_failed' ? 'failed' : end ? 'completed' : 'running', ...over });
  addEvent(id, 'run_started', null, 1_000);
  addEvent(id, 'step_started', 'verify', 2_000);
  if (end) addEvent(id, end, 'verify', 3_000);
}

async function getReport(runId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/workflows/runs/${runId}/test-report` });
  return { code: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfgate002-'));
  cg = await SpecShip.init(root);
  app = Fastify();
  app.decorate('activeCg', async () => cg as never);
  await registerWorkflowRoutes(app);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  cg?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('verify test report route (REQ-WFGATE-002)', () => {
  it('REQ-WFGATE-002.A1 serves the run\'s verify report with outcome and counts', reqWfgate002A1);
  async function reqWfgate002A1(): Promise<void> {
    addRun('run-a', 'step_completed');
    writeReport('run-a', vitestReport(12, 0, 2, 1));
    const { code, body } = await getReport('run-a');
    expect(code).toBe(200);
    expect(body).toMatchObject({
      state: 'available', outcome: 'passed', passed: 12, failed: 0, skipped: 3,
      stepStatus: 'completed', disagreement: false,
    });

    const missing = await getReport('no-such-run');
    expect(missing.code).toBe(404);
  }

  it('REQ-WFGATE-002.A2 two runs each get only their own report', reqWfgate002A2);
  async function reqWfgate002A2(): Promise<void> {
    addRun('run-a', 'step_completed');
    addRun('run-b', 'step_failed');
    writeReport('run-a', vitestReport(7, 0));
    writeReport('run-b', vitestReport(4, 3));
    const a = await getReport('run-a');
    const b = await getReport('run-b');
    expect(a.body).toMatchObject({ state: 'available', outcome: 'passed', passed: 7, failed: 0, stepStatus: 'completed' });
    expect(b.body).toMatchObject({ state: 'available', outcome: 'failed', passed: 4, failed: 3, stepStatus: 'failed' });

    // A third run with no report doesn't borrow either neighbour's.
    addRun('run-c', 'step_failed');
    writeVerifyOutput('run-c', 'VERIFY_RESULT=build-failed\n');
    expect((await getReport('run-c')).body).toMatchObject({ state: 'unavailable', outcome: null, passed: null });
  }

  it('REQ-WFGATE-002.A3 a verify step that wrote no report is unavailable, never passing', reqWfgate002A3);
  async function reqWfgate002A3(): Promise<void> {
    const cases: Array<[string, 'step_completed' | 'step_failed', string, string]> = [
      ['cargo', 'step_completed', 'Finished test\nVERIFY_RESULT=ran-and-passed\n', 'not-vitest'],
      ['pytest', 'step_failed', '1 failed\nVERIFY_RESULT=ran-and-failed\n', 'not-vitest'],
      ['none', 'step_completed', 'no recognised test framework; tests did NOT run\nVERIFY_RESULT=skipped\n', 'skipped'],
      ['build', 'step_failed', 'tsc: error\nVERIFY_RESULT=build-failed\n', 'build-failed'],
      ['env', 'step_failed', 'npm ERR!\nVERIFY_RESULT=env-failed\n', 'env-failed'],
    ];
    for (const [id, end, out, reason] of cases) {
      addRun(id, end);
      writeVerifyOutput(id, out);
      const { code, body } = await getReport(id);
      expect(code).toBe(200);
      expect(body, id).toMatchObject({ state: 'unavailable', outcome: null, passed: null, failed: null, skipped: null, reason });
    }

    // Not run yet / mid-run: unavailable too.
    insertRun('fresh', { status: 'running' });
    expect((await getReport('fresh')).body).toMatchObject({ state: 'unavailable', outcome: null, reason: 'not-run' });
    addRun('busy', null);
    expect((await getReport('busy')).body).toMatchObject({ state: 'unavailable', outcome: null, reason: 'running' });
  }

  it('REQ-WFGATE-002.A4 a truncated or non-JSON report is unreadable, not passing', reqWfgate002A4);
  async function reqWfgate002A4(): Promise<void> {
    const full = vitestReport(10, 0);
    const bodies: Record<string, string> = {
      truncated: full.slice(0, Math.floor(full.length / 2)),
      garbage: 'not json at all',
      empty: '',
      'no-counts': JSON.stringify({ success: true, testResults: [] }),
      'bad-counts': JSON.stringify({ numPassedTests: '10', numFailedTests: 0, numPendingTests: 0, success: true }),
    };
    for (const [id, text] of Object.entries(bodies)) {
      addRun(id, 'step_completed');
      writeReport(id, text);
      const { code, body } = await getReport(id);
      expect(code).toBe(200);
      expect(body, id).toMatchObject({ state: 'unreadable', outcome: null, passed: null, failed: null });
    }
  }

  it('REQ-WFGATE-002.A5 a failing suite is failed; a passing report on a failed step is failed + disagreement', reqWfgate002A5);
  async function reqWfgate002A5(): Promise<void> {
    addRun('red', 'step_failed');
    writeReport('red', vitestReport(9, 2));
    expect((await getReport('red')).body).toMatchObject({ outcome: 'failed', failed: 2, disagreement: false });

    addRun('liar', 'step_failed');
    writeReport('liar', vitestReport(9, 0));
    expect((await getReport('liar')).body).toMatchObject({ state: 'available', outcome: 'failed', passed: 9, failed: 0, disagreement: true, stepStatus: 'failed' });

    addRun('inverse', 'step_completed');
    writeReport('inverse', vitestReport(9, 1));
    expect((await getReport('inverse')).body).toMatchObject({ outcome: 'failed', disagreement: true, stepStatus: 'completed' });
  }

  it('REQ-WFGATE-002.A6 a resumed run reports its latest verify attempt', reqWfgate002A6);
  async function reqWfgate002A6(): Promise<void> {
    // Attempt 1 failed, the run was resumed, attempt 2 passed and overwrote the report.
    addRun('rerun', 'step_failed');
    addEvent('rerun', 'step_started', 'verify', 10_000);
    addEvent('rerun', 'step_completed', 'verify', 11_000);
    writeReport('rerun', vitestReport(20, 0));
    expect((await getReport('rerun')).body).toMatchObject({ outcome: 'passed', passed: 20, stepStatus: 'completed', disagreement: false });

    // Attempt 3 is under way — the step reports itself running, and the
    // status comes from the newest event, not the first.
    addEvent('rerun', 'step_started', 'verify', 20_000);
    expect((await getReport('rerun')).body).toMatchObject({ stepStatus: 'running' });
  }

  it('REQ-WFGATE-002.A7 the report is still served after the run is purged', reqWfgate002A7);
  async function reqWfgate002A7(): Promise<void> {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'wfgate002-wt-'));
    fs.writeFileSync(path.join(worktree, 'file.ts'), 'x');
    sq().insertIsolationEnv({ id: worktree, workflowName: 'spec-implement', workingPath: worktree, branchName: 'b', status: 'active', createdAt: 1 });
    addRun('gone', 'step_completed', { isolationEnvId: worktree });
    writeReport('gone', vitestReport(5, 0));

    const purge = await app.inject({ method: 'POST', url: '/api/workflows/runs/gone/purge' });
    expect(purge.statusCode).toBe(200);
    expect(purge.json()).toMatchObject({ ok: true, worktreeRemoved: true });
    expect(fs.existsSync(worktree)).toBe(false);

    expect((await getReport('gone')).body).toMatchObject({ state: 'available', outcome: 'passed', passed: 5 });
  }
});

// ---------------------------------------------------------------------------
// The bundled verify node drops the previous attempt's report first (A6).
// ---------------------------------------------------------------------------

function verifyScript(workflowName: string): string {
  const found = discoverWorkflows(os.tmpdir()).workflows.find((w) => w.workflow.name === workflowName);
  if (!found) throw new Error(`no bundled ${workflowName} workflow`);
  const nodes = found.workflow.nodes as Array<{ id: string; bash?: string }>;
  const bash = nodes.find((n) => n.id === 'verify')?.bash;
  if (!bash) throw new Error(`no verify bash node in ${workflowName}`);
  return substituteRefs(
    bash,
    { outputs: new Map(), inputs: {}, variables: {}, nodeIds: new Set(nodes.map((n) => n.id)) },
    { forBash: true },
  );
}

describe('verify step clears the previous report before running (REQ-WFGATE-002.A6)', () => {
  for (const wf of ['spec-implement', 'spec-implement-mixed']) {
    it(`REQ-WFGATE-002.A6 ${wf}: a rerun that fails its build leaves no report`, () => {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wfgate002-proj-'));
      const artifacts = path.join(project, 'artifacts');
      try {
        fs.mkdirSync(path.join(project, 'node_modules'));
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
          name: 'p', version: '1.0.0', scripts: { build: 'exit 3', test: 'vitest run' },
        }));
        fs.mkdirSync(artifacts);
        // The previous attempt's passing report.
        fs.writeFileSync(path.join(artifacts, 'test-report.json'), vitestReport(50, 0));

        const r = spawnSync('bash', ['-c', verifyScript(wf)], {
          cwd: project, encoding: 'utf8', env: { ...process.env, SPECSHIP_ARTIFACTS_DIR: artifacts },
        });
        expect(r.status).not.toBe(0);
        expect(r.stdout).toContain('VERIFY_RESULT=build-failed');
        expect(fs.existsSync(path.join(artifacts, 'test-report.json'))).toBe(false);
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    });
  }
});
