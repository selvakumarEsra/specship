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
    expect(names).toEqual(['claude-design-implement', 'spec-author', 'spec-fix', 'spec-implement', 'spec-implement-mixed', 'spec-relink', 'spec-verify']);
    for (const w of result.workflows) {
      expect(w.scope).toBe('bundled');
    }
  });

  it('spec-implement-mixed splits judgment from execution (MIXMODEL-DOC, REQ-MIX-001.A2)', () => {
    const result = discoverWorkflows(dir);
    const mixed = result.workflows.find((w) => w.workflow.name === 'spec-implement-mixed')!.workflow;
    const base = result.workflows.find((w) => w.workflow.name === 'spec-implement')!.workflow;
    const modelOf = (wf: typeof mixed, id: string) =>
      (wf.nodes.find((n) => n.id === id) as { model?: string } | undefined)?.model;

    // Judgment pinned up, mechanical steps pinned down.
    expect(modelOf(mixed, 'plan')).toBe('sonnet');
    for (const id of ['fetch_spec', 'implement', 'link']) {
      expect(modelOf(mixed, id)).toBe('haiku');
    }
    // Verification, routing, coverage and gates are model-free and structurally
    // identical to spec-implement — correctness comes from tests + code + the
    // reviewer. `coverage` joined this list when it stopped being a prompt
    // (REQ-VSTATE-005.A2): a counted number must not depend on a model at all.
    for (const id of ['verify', 'route_verify', 'coverage', 'approve_plan', 'final_review']) {
      expect(modelOf(mixed, id)).toBeUndefined();
      expect(mixed.nodes.find((n) => n.id === id)?.kind).toBe(base.nodes.find((n) => n.id === id)?.kind);
    }
    // Same step graph.
    expect(mixed.nodes.map((n) => n.id)).toEqual(base.nodes.map((n) => n.id));
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

  it('link node routes on the marker — a skipped verify never calls link_verify (A2, REQ-VSTATE-005.A1)', () => {
    const wf = loadSpecImplement();
    // The marker is parsed by CODE now: a bash node turns VERIFY_RESULT into
    // the LINK_ACTION the link node obeys (REQ-VSTATE-005.A1).
    const route = wf.nodes.find((n) => n.id === 'route_verify') as {
      kind: string; bash: string; depends_on?: string[];
    };
    expect(route).toBeDefined();
    expect(route.kind).toBe('bash');
    expect(route.depends_on).toContain('verify');
    expect(route.bash).toContain('VERIFY_RESULT');
    expect(route.bash).toContain('LINK_ACTION=assert-and-verify-pass');
    expect(route.bash).toContain('LINK_ACTION=assert-only');

    const link = wf.nodes.find((n) => n.id === 'link') as { prompt: string; depends_on?: string[] };
    expect(link).toBeDefined();
    expect(link.depends_on).toContain('route_verify');
    expect(link.prompt).toContain('$route_verify.output');
    expect(link.prompt).toContain('LINK_ACTION=assert-and-verify-pass');
    expect(link.prompt).toContain('LINK_ACTION=assert-only');
    expect(link.prompt).toContain('do NOT call specship_link_verify');
  });

  it('final approval sees acceptance-criteria coverage via the coverage node (REQ-IMPLINT-002, REQ-VSTATE-005.A2)', () => {
    const wf = loadSpecImplement();
    const coverage = wf.nodes.find((n) => n.id === 'coverage') as {
      kind: string; bash: string; depends_on?: string[];
    };
    expect(coverage).toBeDefined();
    expect(coverage.depends_on).toContain('link');
    // The count comes from the DB via the CLI, not from a model reading a spec
    // page (REQ-VSTATE-005.A2) — the number the human approves is the same one
    // getSpecCoverage reports.
    expect(coverage.kind).toBe('bash');
    expect(coverage.bash).toContain('coverage');
    expect(coverage.bash).toContain('--line');
    // A2: the gap-closing follow-up is named, never auto-chained (A3 — the
    // node reports; nothing in the workflow runs behaviour authoring).
    expect(coverage.bash).toContain('/specship:spec behaviour');
    expect(wf.nodes.some((n) => n.kind === 'prompt' &&
      (n as { prompt: string }).prompt.includes('behaviour'))).toBe(false);

    const finalReview = wf.nodes.find((n) => n.id === 'final_review') as {
      message: string; depends_on?: string[];
    };
    // coverage reaches the gate through the adversarial reviewer now
    // (REQ-AUTHG-005.A3) — still upstream of it, still on the gate message.
    expect(finalReview.depends_on).toContain('adversarial_review');
    expect((wf.nodes.find((n) => n.id === 'adversarial_review') as { depends_on?: string[] }).depends_on)
      .toContain('coverage');
    expect(finalReview.message).toContain('$coverage.output');
  });
});

/**
 * Truth-and-integrity contract of the bundled implement/fix workflows
 * (REVINT-DOC): the workflow may not mint its own test evidence, an
 * environment or build failure is never reported as a test failure, and
 * spec-fix carries the same marker contract plus a post-apply human gate.
 */
describe('bundled workflows — review-truth integrity (REQ-REVINT-005/006)', () => {
  let dir: string;
  beforeEach(() => { dir = tempDir(); });
  afterEach(() => { clean(dir); });

  function load(name: string) {
    const result = discoverWorkflows(dir);
    const found = result.workflows.find((w) => w.workflow.name === name);
    expect(found, `bundled workflow ${name} should load`).toBeDefined();
    return found!.workflow;
  }
  const nodeOf = (wf: { nodes: { id: string }[] }, id: string) =>
    wf.nodes.find((n) => n.id === id) as unknown as
      { id: string; kind: string; prompt?: string; bash?: string; message?: string; depends_on?: string[] };

  // Named functions (not inline arrows) so `verifies:` bullets can point at a
  // real symbol — an it() title is a string, not a linkable target.
  function linkNodeCannotAssertTestsKind(name: string): void {
    const link = nodeOf(load(name), 'link');
    expect(link.prompt).toMatch(/MUST NOT assert a `tests`-kind link/);
    expect(link.prompt).toContain("never pass kind: 'tests'");
    // Test evidence is file-derived only.
    expect(link.prompt).toContain('verifies:');
    expect(link.prompt).toContain('@verifies');
  }

  function verifyEmitsDistinctEnvAndBuildMarkers(name: string): void {
    const verify = nodeOf(load(name), 'verify');
    expect(verify.kind).toBe('bash');
    for (const marker of [
      'VERIFY_RESULT=env-failed',
      'VERIFY_RESULT=build-failed',
      'VERIFY_RESULT=ran-and-passed',
      'VERIFY_RESULT=ran-and-failed',
      'VERIFY_RESULT=skipped',
    ]) {
      expect(verify.bash, `${name} verify should emit ${marker}`).toContain(marker);
    }
    // Bootstrap: install when node_modules is missing, build before test.
    expect(verify.bash).toContain('node_modules');
    expect(verify.bash).toContain('npm run build --if-present');
  }

  function linkNodeHaltsOnEnvOrBuildFailure(name: string): void {
    // The halt is structural now (REQ-VSTATE-005.A3): the routing bash node
    // exits non-zero on env/build failure, so the run stops BEFORE the link
    // node exists to mutate anything — it no longer depends on a prompt
    // choosing to obey.
    const wf = load(name);
    const route = nodeOf(wf, 'route_verify');
    expect(route.kind).toBe('bash');
    expect(route.bash).toContain('env-failed');
    expect(route.bash).toContain('build-failed');
    expect(route.bash).toContain('HALT_CAUSE=');
    expect(route.bash).toMatch(/HALT_CAUSE=environment setup failed[\s\S]*?exit 1/);
    expect(route.bash).toMatch(/HALT_CAUSE=build failed[\s\S]*?exit 1/);
    expect(nodeOf(wf, 'link').depends_on).toContain('route_verify');
  }

  function specFixGatesLinkStateOnHumanApproval(): void {
    const wf = load('spec-fix');
    const gate = nodeOf(wf, 'approve_links');
    expect(gate.kind).toBe('approval');
    // Gates on the routing node, which gates on verify (REQ-VSTATE-005.A1).
    expect(gate.depends_on).toContain('route_verify');
    expect(nodeOf(wf, 'route_verify').depends_on).toContain('verify');
    expect(gate.message).toContain('$apply.output');
    expect(gate.message).toContain('$verify.output');
    // Nothing may change link state before the gate.
    const linkVerify = nodeOf(wf, 'link_verify');
    expect(linkVerify.depends_on).toEqual(['approve_links']);
    expect(wf.nodes.map((n) => n.id).indexOf('approve_links'))
      .toBeLessThan(wf.nodes.map((n) => n.id).indexOf('link_verify'));
  }

  function skippedSpecFixVerifyNeverPromotes(): void {
    const linkVerify = nodeOf(load('spec-fix'), 'link_verify');
    expect(linkVerify.prompt).toContain('LINK_ACTION=no-verify');
    expect(linkVerify.prompt).toMatch(/Do NOT\s+call specship_link_verify at all/);
    expect(linkVerify.prompt).toMatch(/no link may reach `verified`/);
    // The old unconditional "tests pass → verify pass" instruction is gone.
    expect(linkVerify.prompt).not.toContain('the fix has been applied and tests pass');
  }

  /**
   * spec-verify had no VERIFY_RESULT marker at all and `exit 0`d when it found
   * no runner, so a repo with no tests read as a clean verification pass
   * (REQ-VSTATE-005).
   */
  function specVerifyIsOnTheMarkerContract(): void {
    const wf = load('spec-verify');
    const run = nodeOf(wf, 'run_tests');
    for (const marker of [
      'VERIFY_RESULT=build-failed',
      'VERIFY_RESULT=ran-and-passed',
      'VERIFY_RESULT=ran-and-failed',
      'VERIFY_RESULT=skipped',
    ]) {
      expect(run.bash, `spec-verify run_tests should emit ${marker}`).toContain(marker);
    }
    const route = nodeOf(wf, 'route_verify');
    expect(route.kind).toBe('bash');
    expect(route.depends_on).toContain('run_tests');
    expect(route.bash).toContain('LINK_ACTION=no-verify');
    expect(route.bash).toMatch(/HALT_CAUSE=build failed[\s\S]*?exit 1/);
    // Nothing may touch link state without reading the routing decision.
    const summarize = nodeOf(wf, 'summarize');
    expect(summarize.depends_on).toContain('route_verify');
    expect(summarize.prompt).toContain('$route_verify.output');
    expect(summarize.prompt).toContain('LINK_ACTION=no-verify');
  }

  it('spec-verify carries the same VERIFY_RESULT marker contract (REQ-VSTATE-005.A1)',
    specVerifyIsOnTheMarkerContract);

  it.each(['spec-implement', 'spec-implement-mixed'])(
    'the %s link node is forbidden from asserting tests-kind links (REQ-REVINT-005.A1)',
    linkNodeCannotAssertTestsKind,
  );

  it.each(['spec-implement', 'spec-implement-mixed', 'spec-fix'])(
    '%s attributes env and build failures to their own markers (REQ-REVINT-006.A1/A2)',
    verifyEmitsDistinctEnvAndBuildMarkers,
  );

  it.each(['spec-implement', 'spec-implement-mixed'])(
    'the %s link node halts on env/build failure instead of mutating links (REQ-REVINT-006.A1)',
    linkNodeHaltsOnEnvOrBuildFailure,
  );

  it(
    'spec-fix gates link state behind a human approval after the fix (REQ-REVINT-006.A4)',
    specFixGatesLinkStateOnHumanApproval,
  );

  it(
    'a skipped spec-fix verify may never promote a link to verified (REQ-REVINT-006.A3)',
    skippedSpecFixVerifyNeverPromotes,
  );
});

/**
 * Pipeline quality gates on the bundled implement workflows (AUTHG-DOC):
 * the human gate sees git's diff rather than the agent's prose, a
 * lint/typecheck gate runs between implement and verify with its failures
 * feeding a revise loop, and an adversarial read-only reviewer scores the
 * change against each acceptance criterion before the gate.
 */
describe('bundled implement workflows — pipeline quality gates (REQ-AUTHG-004/005)', () => {
  let dir: string;
  beforeEach(() => { dir = tempDir(); });
  afterEach(() => { clean(dir); });

  function load(name: string) {
    const found = discoverWorkflows(dir).workflows.find((w) => w.workflow.name === name);
    expect(found, `bundled workflow ${name} should load`).toBeDefined();
    return found!.workflow;
  }
  const nodeOf = (wf: { nodes: { id: string }[] }, id: string) =>
    wf.nodes.find((n) => n.id === id) as unknown as
      { id: string; kind: string; model?: string; prompt?: string; bash?: string; message?: string;
        depends_on?: string[]; allowed_tools?: string[]; output_type?: string };

  // Named functions so `verifies:` bullets can point at a real symbol.
  function diffArtifactComesFromGit(name: string): void {
    const wf = load(name);
    const diff = nodeOf(wf, 'diff');
    expect(diff.kind).toBe('bash');
    expect(diff.depends_on).toContain('quality_recheck');
    expect(diff.bash).toContain('git --no-pager diff HEAD');
    // Untracked new files must appear in the artifact too.
    expect(diff.bash).toContain('git add -A -N');

    const stat = nodeOf(wf, 'diff_stat');
    expect(stat.kind).toBe('bash');
    expect(stat.bash).toContain('git --no-pager diff HEAD --stat');
    // The implement node's prose is never the source of the stat block.
    expect(stat.bash).not.toContain('$implement.output');
  }

  function finalGateShowsTheGitStat(name: string): void {
    const wf = load(name);
    const finalReview = nodeOf(wf, 'final_review');
    expect(finalReview.message).toContain('$diff_stat.output');
    expect(finalReview.message).not.toContain('$implement.output');
    // Everything the gate reports must be upstream of it.
    expect(finalReview.depends_on).toContain('adversarial_review');
    expect(nodeOf(wf, 'adversarial_review').depends_on).toContain('coverage');
  }

  function qualityGateRunsBeforeVerify(name: string): void {
    const wf = load(name);
    const gate = nodeOf(wf, 'quality_gate');
    expect(gate.kind).toBe('bash');
    expect(gate.depends_on).toContain('implement');
    expect(gate.bash).toContain('npm run lint --if-present');
    expect(gate.bash).toContain('tsc --noEmit');
    // A project with no lint/typecheck says so explicitly — "nothing ran" may
    // never read as "clean" (REQ-AUTHG-005.A1).
    expect(gate.bash).toContain('QUALITY_GATE=skipped');
    expect(gate.bash).toContain('QUALITY_GATE=passed');
    expect(gate.bash).toContain('QUALITY_GATE=failed');
    // The gate sits between implement and verify.
    const ids = wf.nodes.map((n) => n.id);
    expect(ids.indexOf('quality_gate')).toBeLessThan(ids.indexOf('verify'));
    expect(nodeOf(wf, 'verify').depends_on).toContain('diff_stat');
  }

  function qualityFailureFeedsTheReviseLoop(name: string): void {
    const wf = load(name);
    const fix = nodeOf(wf, 'fix_quality');
    expect(fix.kind).toBe('prompt');
    expect(fix.depends_on).toContain('quality_gate');
    expect(fix.prompt).toContain('$quality_gate.output');
    expect(fix.prompt).toContain('QUALITY_GATE=failed');
    expect(fix.allowed_tools).toContain('Edit');
    // The prompt's own claim is not evidence: a bash node re-runs the command
    // and halts the run while it still fails — a failure never passes silently.
    const recheck = nodeOf(wf, 'quality_recheck');
    expect(recheck.kind).toBe('bash');
    expect(recheck.depends_on).toContain('fix_quality');
    expect(recheck.bash).toContain('QUALITY_RESULT=failed');
    expect(recheck.bash).toMatch(/HALT_CAUSE=lint\/typecheck still fails[\s\S]*?exit 1/);
    expect(recheck.bash).toContain('QUALITY_RESULT=skipped');
  }

  function adversarialReviewIsReadOnlyAndScoresEveryCriterion(name: string): void {
    const wf = load(name);
    const rev = nodeOf(wf, 'adversarial_review');
    expect(rev.kind).toBe('prompt');
    // Read-only: no mutation tool may be reachable from this node.
    for (const banned of ['Edit', 'Write', 'Bash']) {
      expect(rev.allowed_tools, `${name} adversarial_review must not allow ${banned}`)
        .not.toContain(banned);
    }
    expect(rev.allowed_tools).toContain('Read');
    expect(rev.allowed_tools).toContain('Grep');
    expect(rev.allowed_tools).toContain('mcp__specship__specship_spec');
    // Input is the spec + the git diff artifact, not the implementer's summary.
    expect(rev.prompt).toContain('$diff.output');
    expect(rev.prompt).not.toContain('$implement.output');
    expect(rev.prompt).toContain('satisfied | partial | unaddressed');
    expect(rev.prompt).toContain('Untested new code paths');
    // …and the human gate sees it.
    expect(nodeOf(wf, 'final_review').message).toContain('$adversarial_review.output');
  }

  it.each(['spec-implement', 'spec-implement-mixed'])(
    '%s computes the diff artifact from git (REQ-AUTHG-004.A1)', diffArtifactComesFromGit);

  it.each(['spec-implement', 'spec-implement-mixed'])(
    'the %s final gate shows the git diff stat, not the agent summary (REQ-AUTHG-004.A2)',
    finalGateShowsTheGitStat);

  it.each(['spec-implement', 'spec-implement-mixed'])(
    '%s runs lint/typecheck between implement and verify (REQ-AUTHG-005.A1)',
    qualityGateRunsBeforeVerify);

  it.each(['spec-implement', 'spec-implement-mixed'])(
    'a %s quality failure feeds the revise loop and halts if unfixed (REQ-AUTHG-005.A1)',
    qualityFailureFeedsTheReviseLoop);

  it.each(['spec-implement', 'spec-implement-mixed'])(
    'the %s adversarial reviewer is read-only and scores every criterion (REQ-AUTHG-005.A3)',
    adversarialReviewIsReadOnlyAndScoresEveryCriterion);

  it('spec-implement-mixed pins the new nodes by role (MIXMODEL-DOC, REQ-AUTHG-005.A3)', () => {
    const mixed = load('spec-implement-mixed');
    // Judgment → sonnet; mechanical fix → haiku; the deterministic gates carry
    // no model at all.
    expect(nodeOf(mixed, 'adversarial_review').model).toBe('sonnet');
    expect(nodeOf(mixed, 'fix_quality').model).toBe('haiku');
    for (const id of ['quality_gate', 'quality_recheck', 'diff', 'diff_stat']) {
      expect(nodeOf(mixed, id).model).toBeUndefined();
    }
    // Same step graph as the single-model workflow.
    expect(mixed.nodes.map((n) => n.id)).toEqual(load('spec-implement').nodes.map((n) => n.id));
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
