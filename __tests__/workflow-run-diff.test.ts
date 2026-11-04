import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { discoverWorkflows } from '../src/workflows/discovery';
import { substituteRefs } from '../src/workflows/condition-evaluator';

/**
 * REQ-WFINTEG-002 (specs/workflow-run-integrity.md) — the run's `diff` and
 * `diff_stat` show the whole change since the run started, even after the
 * implement step committed it. These tests run the REAL bash of the bundled
 * nodes (substituted as the executor substitutes them) against a throwaway
 * git repo.
 */

type Node = { id: string; bash?: string };

function nodeScript(id: string): string {
  const found = discoverWorkflows(os.tmpdir()).workflows.find((w) => w.workflow.name === 'spec-implement');
  if (!found) throw new Error('no bundled spec-implement workflow');
  const nodes = found.workflow.nodes as Node[];
  const bash = nodes.find((n) => n.id === id)?.bash;
  if (!bash) throw new Error(`no bash node ${id}`);
  return substituteRefs(
    bash,
    { outputs: new Map(), inputs: {}, variables: {}, nodeIds: new Set(nodes.map((n) => n.id)) },
    { forBash: true },
  );
}

let repo: string;

function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function run(id: string): { out: string; code: number } {
  const r = spawnSync('bash', ['-c', nodeScript(id)], { cwd: repo, encoding: 'utf8' });
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), code: r.status ?? -1 };
}

/** What the readiness step does before implement runs. */
function recordBase(): void {
  fs.writeFileSync(path.join(repo, '.git', 'specship-run-base'), git('rev-parse', 'HEAD') + '\n');
}

function write(file: string, text: string): void {
  fs.writeFileSync(path.join(repo, file), text);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdiff-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  write('a.ts', 'export const a = 1;\n');
  write('b.ts', 'export const b = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec-implement diff covers the whole run (REQ-WFINTEG-002)', () => {
  it('shows a change the implement step committed (REQ-WFINTEG-002.A1)', reqWfinteg002A1);
  function reqWfinteg002A1(): void {
    recordBase();
    write('a.ts', 'export const a = 2;\n');
    git('commit', '-qam', 'implement');
    const diff = run('diff');
    expect(diff.code).toBe(0);
    expect(diff.out).toContain('+export const a = 2;');
    const stat = run('diff_stat');
    expect(stat.code).toBe(0);
    expect(stat.out).toMatch(/a\.ts\s+\|/);
  }

  it('shows committed, uncommitted and untracked work together (REQ-WFINTEG-002.A2)', reqWfinteg002A2);
  function reqWfinteg002A2(): void {
    recordBase();
    write('a.ts', 'export const a = 2;\n');
    git('commit', '-qam', 'implement');
    write('b.ts', 'export const b = 2;\n');
    write('c.ts', 'export const c = 1;\n');
    const { out, code } = run('diff');
    expect(code).toBe(0);
    expect(out).toContain('+export const a = 2;');
    expect(out).toContain('+export const b = 2;');
    expect(out).toContain('+export const c = 1;');
  }

  it('halts when the run base was never recorded (REQ-WFINTEG-002.A3)', reqWfinteg002A3);
  function reqWfinteg002A3(): void {
    write('a.ts', 'export const a = 2;\n');
    const { out, code } = run('diff');
    expect(code).not.toBe(0);
    expect(out).toContain('HALT_CAUSE=');
  }

  it('succeeds with an empty change when nothing changed (REQ-WFINTEG-002.A4)', reqWfinteg002A4);
  function reqWfinteg002A4(): void {
    recordBase();
    const { out, code } = run('diff');
    expect(code).toBe(0);
    expect(out).not.toContain('HALT_CAUSE');
    const body = out.slice(out.indexOf('DIFF_BEGIN') + 'DIFF_BEGIN'.length, out.indexOf('DIFF_END'));
    expect(body.trim()).toBe('');
  }
});
