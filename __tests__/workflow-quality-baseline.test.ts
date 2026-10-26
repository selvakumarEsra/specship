import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { discoverWorkflows } from '../src/workflows/discovery';

/**
 * REQ-AUTHG-008 (specs/authoring-pipeline-gates.md) — the implement workflows'
 * quality gate judges only errors the change introduced. These tests run the
 * REAL bash of the quality_baseline / quality_gate / quality_recheck nodes
 * against a throwaway git repo whose `lint` script prints a controllable list
 * of errors, so the marker contract is exercised end to end.
 */

type Node = { id: string; bash?: string };
const WORKFLOWS = ['spec-implement', 'spec-implement-mixed'];

function nodeBash(workflow: string, id: string): string {
  // Through the loader, so a workflow that `extends` another (REQ-THRU-004)
  // is exercised exactly as it runs.
  const found = discoverWorkflows(os.tmpdir()).workflows.find((w) => w.workflow.name === workflow);
  if (!found) throw new Error(`no bundled workflow ${workflow}`);
  const node = (found.workflow.nodes as Node[]).find((n) => n.id === id);
  if (!node?.bash) throw new Error(`${workflow}: no bash node ${id}`);
  return node.bash;
}

let repo: string;

function setErrors(lines: string[]): void {
  fs.writeFileSync(path.join(repo, 'errs.txt'), lines.join('\n'));
}

function run(script: string): { out: string; code: number } {
  const r = spawnSync('bash', ['-c', script], { cwd: repo, encoding: 'utf8' });
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), code: r.status ?? -1 };
}

/** Run gate, then recheck with the gate's output substituted as the executor would. */
function gateAndRecheck(workflow: string): { gate: string; recheck: { out: string; code: number } } {
  const gate = run(nodeBash(workflow, 'quality_gate')).out;
  const recheckScript = nodeBash(workflow, 'quality_recheck').replace(
    '$quality_gate.output',
    `'${gate.replace(/'/g, `'\\''`)}'`,
  );
  return { gate, recheck: run(recheckScript) };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qbase-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'node_modules')); // skip the npm bootstrap
  fs.writeFileSync(
    path.join(repo, 'lint.js'),
    "const t=require('fs').readFileSync('errs.txt','utf8').trim();if(t){console.log(t);process.exit(1)}",
  );
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { lint: 'node lint.js' } }));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const PRE = [
  'server/src/server.ts(137,35): error TS2307: Cannot find module x',
  'server/src/routes/spec.ts(13,60): error TS2307: Cannot find module y',
];

function preExistingErrorsDoNotFailTheGate(workflow: string): void {
  setErrors(PRE);
  expect(run(nodeBash(workflow, 'quality_baseline')).out).toContain('QUALITY_BASELINE=recorded');
  const { gate, recheck } = gateAndRecheck(workflow);
  expect(gate).toContain('QUALITY_GATE=passed');
  expect(gate).toContain('QUALITY_PREEXISTING=2');
  expect(gate).toContain('TS2307'); // reported, never silently dropped
  expect(recheck.code).toBe(0);
  expect(recheck.out).toContain('QUALITY_RESULT=clean');
}

function newErrorsStillFailTheGate(workflow: string): void {
  setErrors(PRE);
  run(nodeBash(workflow, 'quality_baseline'));
  const NEW = 'src/installer/targets/gemini.ts(42,7): error TS2322: Type string is not number';
  setErrors([...PRE, NEW]);
  const { gate, recheck } = gateAndRecheck(workflow);
  expect(gate).toContain('QUALITY_GATE=failed');
  expect(gate).toContain('TS2322');
  expect(gate.split('New errors introduced by this change:')[1]).not.toContain('TS2307');
  expect(recheck.code).toBe(1);
  expect(recheck.out).toContain('QUALITY_RESULT=failed');
}

function shiftedErrorInEditedFileIsNotNew(workflow: string): void {
  setErrors(['src/x.ts(10,5): error TS1005: boom']);
  run(nodeBash(workflow, 'quality_baseline'));
  setErrors(['src/x.ts(14,5): error TS1005: boom']);
  const { gate, recheck } = gateAndRecheck(workflow);
  expect(gate).toContain('QUALITY_GATE=passed');
  expect(recheck.out).toContain('QUALITY_RESULT=clean');
}

function missingBaselineFallsBackToFullGate(workflow: string): void {
  // A clean pre-change tree records no baseline: any later failure is the change's.
  setErrors([]);
  expect(run(nodeBash(workflow, 'quality_baseline')).out).toContain('QUALITY_BASELINE=clean');
  setErrors(PRE);
  const { gate, recheck } = gateAndRecheck(workflow);
  expect(gate).toContain('QUALITY_GATE=failed');
  expect(recheck.code).toBe(1);
}

describe.runIf(process.platform !== 'win32')('quality gate baseline (REQ-AUTHG-008)', () => {
  it.each(WORKFLOWS)('%s: pre-existing errors do not fail the gate (REQ-AUTHG-008.A2)',
    preExistingErrorsDoNotFailTheGate);
  it.each(WORKFLOWS)('%s: an error absent from the baseline still fails (REQ-AUTHG-008.A3)',
    newErrorsStillFailTheGate);
  it.each(WORKFLOWS)('%s: a shifted pre-existing error is not new (REQ-AUTHG-008.A4)',
    shiftedErrorInEditedFileIsNotNew);
  it.each(WORKFLOWS)('%s: no baseline falls back to the full gate (REQ-AUTHG-008.A5)',
    missingBaselineFallsBackToFullGate);
});
