/**
 * Workflow discovery + validation tests.
 *
 * Asserts:
 *   - All four bundled workflows load and validate.
 *   - Project-tier workflows override bundled-tier on filename collision.
 *   - Invalid YAML produces a structured error without aborting peers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverWorkflows } from '../src/workflows/discovery';
import { validateWorkflow } from '../src/workflows/schemas/workflow';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-wf-disc-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

describe('Workflow discovery', () => {
  let dir: string;
  beforeEach(() => { dir = tempDir(); });
  afterEach(() => { clean(dir); });

  it('finds all bundled defaults', () => {
    const result = discoverWorkflows(dir);
    expect(result.errors).toEqual([]);
    const names = result.workflows.map((w) => w.workflow.name).sort();
    expect(names).toEqual(['claude-design-implement', 'spec-author', 'spec-fix', 'spec-implement', 'spec-relink', 'spec-verify']);
    for (const w of result.workflows) {
      expect(w.scope).toBe('bundled');
    }
  });

  it('project workflow overrides bundled by name', () => {
    const wfDir = path.join(dir, '.specship', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, 'spec-implement.yaml'),
      `name: spec-implement
description: project override
nodes:
  - id: noop
    kind: cancel
    cancel: project-override
`
    );
    const result = discoverWorkflows(dir);
    const found = result.workflows.find((w) => w.workflow.name === 'spec-implement');
    expect(found?.scope).toBe('project');
    expect(found?.workflow.description).toBe('project override');
  });

  it('per-file errors do not abort discovery', () => {
    const wfDir = path.join(dir, '.specship', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'broken.yaml'), 'name: broken\nnodes: not_an_array\n');
    fs.writeFileSync(
      path.join(wfDir, 'good.yaml'),
      `name: good
nodes:
  - id: a
    kind: cancel
    cancel: ok
`
    );
    const result = discoverWorkflows(dir);
    const good = result.workflows.find((w) => w.workflow.name === 'good');
    expect(good).toBeDefined();
    const brokenErr = result.errors.find((e) => e.sourcePath.endsWith('broken.yaml'));
    expect(brokenErr).toBeDefined();
  });
});

/**
 * Verified-integrity contract of the bundled spec-implement workflow
 * (IMPLINT-DOC): a skipped verify must be machine-distinguishable from a
 * passing one, the link step must never verify on a skipped run, and the
 * final approval must see acceptance-criteria test coverage.
 */
describe('bundled spec-implement — verified integrity (REQ-IMPLINT-001/002)', () => {
  let dir: string;
  beforeEach(() => { dir = tempDir(); });
  afterEach(() => { clean(dir); });

  function loadSpecImplement() {
    const result = discoverWorkflows(dir);
    const found = result.workflows.find((w) => w.workflow.name === 'spec-implement');
    expect(found).toBeDefined();
    return found!.workflow;
  }

  it('verify node emits a machine-readable VERIFY_RESULT marker for all three outcomes (A1)', () => {
    const wf = loadSpecImplement();
    const verify = wf.nodes.find((n) => n.id === 'verify') as { bash: string };
    expect(verify).toBeDefined();
    expect(verify.bash).toContain('VERIFY_RESULT=ran-and-passed');
    expect(verify.bash).toContain('VERIFY_RESULT=ran-and-failed');
    expect(verify.bash).toContain('VERIFY_RESULT=skipped');
    // The skipped branch must not claim tests ran.
    expect(verify.bash).not.toContain('skipping"');
  });

  it('link node routes on the marker — a skipped verify never calls link_verify (A2)', () => {
    const wf = loadSpecImplement();
    const link = wf.nodes.find((n) => n.id === 'link') as { prompt: string };
    expect(link).toBeDefined();
    expect(link.prompt).toContain('VERIFY_RESULT=ran-and-passed');
    expect(link.prompt).toContain('VERIFY_RESULT=skipped');
    expect(link.prompt).toContain('do NOT call specship_link_verify');
  });

  it('final approval sees acceptance-criteria coverage via the coverage node (REQ-IMPLINT-002)', () => {
    const wf = loadSpecImplement();
    const coverage = wf.nodes.find((n) => n.id === 'coverage') as {
      prompt: string; depends_on?: string[]; allowed_tools?: string[];
    };
    expect(coverage).toBeDefined();
    expect(coverage.depends_on).toContain('link');
    expect(coverage.allowed_tools).toEqual(['mcp__specship__specship_spec']);
    // A2: the gap-closing follow-up is named, never auto-chained (A3 — the
    // node reports; nothing in the workflow runs behaviour authoring).
    expect(coverage.prompt).toContain('/specship:spec behaviour');
    expect(wf.nodes.some((n) => n.kind === 'prompt' && n.id !== 'coverage' &&
      (n as { prompt: string }).prompt.includes('behaviour'))).toBe(false);

    const finalReview = wf.nodes.find((n) => n.id === 'final_review') as {
      message: string; depends_on?: string[];
    };
    expect(finalReview.depends_on).toContain('coverage');
    expect(finalReview.message).toContain('$coverage.output');
  });
});

describe('validateWorkflow', () => {
  it('accepts a minimal workflow', () => {
    const r = validateWorkflow({
      name: 'demo',
      nodes: [{ id: 'n', kind: 'cancel', cancel: 'done' }],
    });
    expect(r.ok).toBe(true);
    expect(r.workflow!.nodes).toHaveLength(1);
  });

  it('rejects unknown node kind', () => {
    const r = validateWorkflow({
      name: 'x',
      nodes: [{ id: 'n', kind: 'mystery' }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'nodes[0].kind')).toBe(true);
  });

  it('rejects depends_on referencing unknown node', () => {
    const r = validateWorkflow({
      name: 'x',
      nodes: [
        { id: 'a', kind: 'cancel', cancel: 'x', depends_on: ['ghost'] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('ghost'))).toBe(true);
  });

  it('rejects duplicate node ids', () => {
    const r = validateWorkflow({
      name: 'x',
      nodes: [
        { id: 'a', kind: 'cancel', cancel: 'x' },
        { id: 'a', kind: 'cancel', cancel: 'y' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('duplicate'))).toBe(true);
  });

  it('rejects self-dependency', () => {
    const r = validateWorkflow({
      name: 'x',
      nodes: [{ id: 'a', kind: 'cancel', cancel: 'x', depends_on: ['a'] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('cannot depend on itself'))).toBe(true);
  });
});
