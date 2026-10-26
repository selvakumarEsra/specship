import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assessPlanScopeFromFile, filesNamedInPlan } from '../src/spec-quality/plan-scope';
import { ApprovalRunner } from '../src/workflows/runners/approval';
import type { ApprovalNode } from '../src/workflows/schemas/workflow';
import type { RunnerContext } from '../src/workflows/runners/types';

/**
 * THROUGHPUT-DOC REQ-THRU-003 — a small plan that stays inside the requirement's
 * implementation files may skip the plan gate, but only when the project opts
 * in; every other plan still waits for a human.
 */

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-scope-'));
  fs.mkdirSync(path.join(root, 'specs'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function setup(opts: { optIn: boolean; criteria?: number }): void {
  const n = opts.criteria ?? 2;
  fs.writeFileSync(
    path.join(root, 'specs', 'demo.md'),
    [
      '<!-- id: DEMO-DOC -->', '# Demo', '',
      '<!-- id: REQ-DEMO-001 -->', '## Thing MUST work', '',
      'implementations:', '  - src/auth/rate-limit.ts:RateLimiter', '',
      '## Acceptance',
      ...Array.from({ length: n }, (_, i) => [`<!-- id: REQ-DEMO-001.A${i + 1} -->`, `- criterion ${i + 1}`]).flat(),
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(root, 'specship.config.json'), JSON.stringify({ workflow: { autoApproveSmallPlans: opts.optIn } }));
}

const IN_SCOPE_PLAN = [
  '1. Edit `src/auth/rate-limit.ts` — tighten RateLimiter.check.',
  '2. Add tests in __tests__/rate-limit.test.ts for A1 and A2.',
  '3. Add a CHANGELOG.md entry; update specs/demo.md verifies block.',
].join('\n');

function inScopeSmallPlanIsAutoApprovable(): void {
  setup({ optIn: true });
  const r = assessPlanScopeFromFile(root, 'REQ-DEMO-001', IN_SCOPE_PLAN);
  expect(r.reasons).toEqual([]);
  expect(r.autoApprove).toBe(true);
  expect(filesNamedInPlan(IN_SCOPE_PLAN)).toEqual([
    'src/auth/rate-limit.ts', '__tests__/rate-limit.test.ts', 'CHANGELOG.md', 'specs/demo.md',
  ]);
}

function outOfScopeFileNeedsApproval(): void {
  setup({ optIn: true });
  const r = assessPlanScopeFromFile(root, 'REQ-DEMO-001', IN_SCOPE_PLAN + '\n4. Also refactor src/db/queries.ts.');
  expect(r.autoApprove).toBe(false);
  expect(r.outOfScope).toEqual(['src/db/queries.ts']);
  // Also at the very end of the plan, with no trailing punctuation.
  expect(assessPlanScopeFromFile(root, 'REQ-DEMO-001', IN_SCOPE_PLAN + '\nThen touch src/util/x.ts').autoApprove).toBe(false);
}

function tooManyCriteriaNeedsApproval(): void {
  setup({ optIn: true, criteria: 4 });
  const r = assessPlanScopeFromFile(root, 'REQ-DEMO-001', IN_SCOPE_PLAN);
  expect(r.autoApprove).toBe(false);
  expect(r.reasons.join('\n')).toContain('has 4 criteria (limit 3)');
}

function withoutOptInAlwaysNeedsApproval(): void {
  setup({ optIn: false });
  expect(assessPlanScopeFromFile(root, 'REQ-DEMO-001', IN_SCOPE_PLAN).autoApprove).toBe(false);
  fs.rmSync(path.join(root, 'specship.config.json'));
  expect(assessPlanScopeFromFile(root, 'REQ-DEMO-001', IN_SCOPE_PLAN).autoApprove).toBe(false);
}

async function approvalGateHonoursTheMarker(): Promise<void> {
  const node: ApprovalNode = {
    id: 'approve_plan', kind: 'approval', message: 'approve?',
    auto_approve: { from: 'plan_scope', marker: 'AUTO_APPROVE=yes' },
  } as ApprovalNode;
  const ctx = (text: string) => ({ outputs: new Map([['plan_scope', { text }]]) }) as unknown as RunnerContext;
  const yes = await new ApprovalRunner().run(node, ctx('AUTO_APPROVE=yes\n'));
  expect(yes.status).toBe('completed');
  const no = await new ApprovalRunner().run(node, ctx('AUTO_APPROVE=no\n- reasons'));
  expect(no.status).toBe('paused');
}

describe('small-plan auto-approval (REQ-THRU-003)', () => {
  it('an in-scope small plan is auto-approvable with the opt-in (REQ-THRU-003.A1)', inScopeSmallPlanIsAutoApprovable);
  it('a plan naming a file outside implementations needs approval (REQ-THRU-003.A2)', outOfScopeFileNeedsApproval);
  it('a requirement over the criteria limit needs approval (REQ-THRU-003.A3)', tooManyCriteriaNeedsApproval);
  it('without the opt-in every plan needs approval (REQ-THRU-003.A4)', withoutOptInAlwaysNeedsApproval);
  it('the approval gate completes only on the AUTO_APPROVE=yes marker (REQ-THRU-003.A1)', approvalGateHonoursTheMarker);
});
