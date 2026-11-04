/**
 * Condition evaluator + $nodeId.output substitution tests.
 */

import { describe, it, expect } from 'vitest';
import {
  substituteRefs,
  evaluateCondition,
  OutputRefError,
} from '../src/workflows/condition-evaluator';
import { discoverWorkflows } from '../src/workflows/discovery';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function ctx(outputs: Record<string, { text: string }>, opts: Partial<{ inputs: Record<string, string>; variables: Record<string, string> }> = {}) {
  return {
    outputs: new Map(Object.entries(outputs)),
    inputs: opts.inputs ?? {},
    variables: opts.variables ?? {},
  };
}

describe('substituteRefs', () => {
  it('substitutes $nodeId.output with the text', () => {
    const out = substituteRefs('prefix $a.output suffix', ctx({ a: { text: 'BODY' } }));
    expect(out).toBe('prefix BODY suffix');
  });

  it('substitutes $INPUT.NAME', () => {
    const out = substituteRefs('id=$INPUT.SPEC_ID', ctx({}, { inputs: { SPEC_ID: 'REQ-1' } }));
    expect(out).toBe('id=REQ-1');
  });

  it('substitutes $VAR for static variables', () => {
    const out = substituteRefs('dir=$ARTIFACTS_DIR', ctx({}, { variables: { ARTIFACTS_DIR: '/tmp/x' } }));
    expect(out).toBe('dir=/tmp/x');
  });

  it('throws OutputRefError for unknown node', () => {
    expect(() => substituteRefs('$ghost.output', ctx({}))).toThrowError(OutputRefError);
  });

  it('throws OutputRefError for missing field', () => {
    expect(() => substituteRefs('$a.output.missing', ctx({ a: { text: '{"x": 1}' } }))).toThrowError(
      OutputRefError
    );
  });

  it('accesses JSON-parsed fields', () => {
    const out = substituteRefs(
      'value=$a.output.k',
      ctx({ a: { text: '{"k": "hello"}' } })
    );
    expect(out).toBe('value=hello');
  });

  it('quotes for bash safety', () => {
    const out = substituteRefs('echo $a.output', ctx({ a: { text: "it's a test" } }), {
      forBash: true,
    });
    expect(out).toContain("'it'\\''s a test'");
  });
});

describe('evaluateCondition', () => {
  it('handles == and !=', () => {
    expect(evaluateCondition("'a' == 'a'", ctx({}))).toBe(true);
    expect(evaluateCondition("'a' != 'b'", ctx({}))).toBe(true);
    expect(evaluateCondition("'a' == 'b'", ctx({}))).toBe(false);
  });

  it('handles numeric comparisons', () => {
    expect(evaluateCondition('3 < 5', ctx({}))).toBe(true);
    expect(evaluateCondition('3 > 5', ctx({}))).toBe(false);
    expect(evaluateCondition('5 >= 5', ctx({}))).toBe(true);
  });

  it('handles && and ||', () => {
    expect(evaluateCondition("'a' == 'a' && 1 < 2", ctx({}))).toBe(true);
    expect(evaluateCondition("'a' == 'b' && 1 < 2", ctx({}))).toBe(false);
    expect(evaluateCondition("'a' == 'b' || 1 < 2", ctx({}))).toBe(true);
  });

  it('substitutes $refs in conditions', () => {
    const c = ctx({ a: { text: 'PASS' } });
    expect(evaluateCondition("$a.output == 'PASS'", c)).toBe(true);
    expect(evaluateCondition("$a.output == 'FAIL'", c)).toBe(false);
  });

  it('fails closed on unresolvable $ref', () => {
    expect(evaluateCondition("$ghost.output == 'x'", ctx({}))).toBe(false);
  });

  it('empty string is falsy under truthy fallback', () => {
    expect(evaluateCondition('', ctx({}))).toBe(false);
  });

  it('non-empty bare string is truthy (no operator)', () => {
    // Documented semantics: no operator → truthy test on the value.
    expect(evaluateCondition('something', ctx({}))).toBe(true);
  });
});

/**
 * REQ-WFINTEG-001 (specs/workflow-run-integrity.md) — shell text such as
 * `$i.md` is not a step reference when the workflow has no step `i`.
 */
describe('step references vs shell text (REQ-WFINTEG-001)', () => {
  const withSteps = (ids: string[], outputs: Record<string, { text: string }> = {}) => ({
    ...ctx(outputs),
    nodeIds: new Set(ids),
  });

  it('leaves `$i.md` as written when no step is named i (REQ-WFINTEG-001.A1)', reqWfinteg001A1);
  function reqWfinteg001A1(): void {
    const line = 'while [ -e "$target" ]; do target="$DEST/${base%.md}-$i.md"; i=$((i+1)); done';
    expect(substituteRefs(line, withSteps(['plan', 'diff']), { forBash: true })).toBe(line);
  }

  it('still fails a wrong field on a real step and .output of a missing step (REQ-WFINTEG-001.A2)', reqWfinteg001A2);
  function reqWfinteg001A2(): void {
    const c = withSteps(['plan'], { plan: { text: 'x' } });
    expect(() => substituteRefs('$plan.outptu', c)).toThrowError(/\$plan\.outptu/);
    expect(() => substituteRefs('$plnn.output', c)).toThrowError(/\$plnn\.output/);
  }

  it('runs the bundled knowledge_publish step and suffixes a name collision (REQ-WFINTEG-001.A3)', reqWfinteg001A3);
  function reqWfinteg001A3(): void {
    const found = discoverWorkflows(os.tmpdir()).workflows.find((w) => w.workflow.name === 'spec-implement');
    if (!found) throw new Error('no bundled spec-implement workflow');
    const nodes = found.workflow.nodes as Array<{ id: string; bash?: string }>;
    const bash = nodes.find((n) => n.id === 'knowledge_publish')?.bash;
    if (!bash) throw new Error('no knowledge_publish bash step');
    const script = substituteRefs(bash, { ...ctx({}), nodeIds: new Set(nodes.map((n) => n.id)) }, { forBash: true });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfinteg-'));
    try {
      const repo = path.join(root, 'repo');
      fs.mkdirSync(path.join(repo, '.specship/knowledge/proposals'), { recursive: true });
      spawnSync('git', ['init', '-q'], { cwd: repo });
      fs.writeFileSync(path.join(repo, '.specship/knowledge/proposals/fact.md'), 'title: New fact\n');
      const dest = path.join(root, 'main/knowledge/proposals');
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'fact.md'), 'title: Earlier fact\n');
      const artifacts = path.join(root, 'main/artifacts/runs/r1');
      fs.mkdirSync(artifacts, { recursive: true });
      const r = spawnSync('bash', ['-c', script], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, SPECSHIP_ARTIFACTS_DIR: artifacts },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('KNOWLEDGE_PROPOSALS=1');
      expect(fs.readFileSync(path.join(dest, 'fact-2.md'), 'utf8')).toContain('New fact');
      expect(fs.readFileSync(path.join(dest, 'fact.md'), 'utf8')).toContain('Earlier fact');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
