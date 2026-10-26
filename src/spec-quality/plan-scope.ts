/**
 * Small-plan auto-approval (THROUGHPUT-DOC, REQ-THRU-003).
 *
 * A plan may skip the human plan gate ONLY when the project opted in
 * (`workflow.autoApproveSmallPlans: true` in specship.config.json), every
 * source file it names is already one of the requirement's
 * `implementations:` files, and the requirement has at most
 * `workflow.smallPlanMaxCriteria` (default 3) acceptance criteria. Test files,
 * the requirement's own spec file and CHANGELOG.md never count against the
 * scope — a good plan always names them. The final review is never skipped.
 *
 * Deterministic and file-based, so it runs inside a workflow worktree. The
 * AUTO_APPROVE=yes|no marker is the contract the approval step reads.
 */

import * as fs from 'fs';
import * as path from 'path';
import { findSpecFile, requirementBlock, linkBullets, criterionIds } from './postcheck';

export const DEFAULT_SMALL_PLAN_MAX_CRITERIA = 3;

export interface PlanScopeInput {
  planText: string;
  /** Files named by the requirement's `implementations:` bullets. */
  implementationFiles: string[];
  criteriaCount: number;
  optIn: boolean;
  maxCriteria?: number;
  /** The requirement's spec file (project-relative), always in scope. */
  specFile?: string;
}

export interface PlanScopeResult {
  autoApprove: boolean;
  reasons: string[];
  /** Source files the plan names that are outside the requirement's implementations. */
  outOfScope: string[];
}

// A trailing full stop/!/? ends a sentence, not the path — a plan naming an
// out-of-scope file at the end of a sentence must still be caught.
const PATH_TOKEN = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[A-Za-z0-9]{1,6})(?=[\s`'")\]:,;.!?]|$)/g;
const TEST_FILE = /(^|\/)(__tests__|tests?|e2e|spec)\/|\.(test|spec)\.[A-Za-z0-9]+$/;

/** Project-relative file paths a plan names (deduplicated, in order). */
export function filesNamedInPlan(planText: string): string[] {
  const out: string[] = [];
  for (const m of planText.matchAll(PATH_TOKEN)) {
    const p = m[1]!.replace(/^\.\//, '');
    if (!p.includes('/') && !/^[A-Z][A-Za-z]+\.md$/.test(p)) continue; // bare words like "e.g." are not files
    if (/^\d+(\.\d+)+$/.test(p) || /^https?:/.test(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function assessPlanScope(input: PlanScopeInput): PlanScopeResult {
  const maxCriteria = input.maxCriteria ?? DEFAULT_SMALL_PLAN_MAX_CRITERIA;
  const reasons: string[] = [];
  if (!input.optIn) {
    return { autoApprove: false, reasons: ['workflow.autoApproveSmallPlans is not enabled'], outOfScope: [] };
  }
  if (input.criteriaCount > maxCriteria) {
    reasons.push(`requirement has ${input.criteriaCount} criteria (limit ${maxCriteria})`);
  }
  const allowed = new Set(input.implementationFiles);
  const named = filesNamedInPlan(input.planText);
  const outOfScope = named.filter(
    (f) => !allowed.has(f) && !TEST_FILE.test(f) && f !== 'CHANGELOG.md' && f !== input.specFile,
  );
  if (outOfScope.length > 0) reasons.push(`plan names files outside implementations: ${outOfScope.join(', ')}`);
  if (named.filter((f) => allowed.has(f)).length === 0) {
    reasons.push('plan names none of the requirement\'s implementation files');
  }
  return { autoApprove: reasons.length === 0, reasons, outOfScope };
}

interface WorkflowConfig {
  autoApproveSmallPlans?: unknown;
  smallPlanMaxCriteria?: unknown;
}

function readWorkflowConfig(projectRoot: string): WorkflowConfig {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'specship.config.json'), 'utf8'));
    return (cfg && typeof cfg.workflow === 'object' && cfg.workflow) || {};
  } catch {
    return {};
  }
}

/** File-based loader: reads the requirement block and the project's opt-in. */
export function assessPlanScopeFromFile(projectRoot: string, requirementId: string, planText: string): PlanScopeResult {
  const cfg = readWorkflowConfig(projectRoot);
  const specFile = findSpecFile(projectRoot, requirementId);
  const block = specFile ? requirementBlock(fs.readFileSync(specFile, 'utf8'), requirementId) : null;
  if (!specFile || !block) {
    return { autoApprove: false, reasons: [`no spec block for ${requirementId}`], outOfScope: [] };
  }
  const implementationFiles = linkBullets(block, 'implementations').map((b) => {
    const idx = b.lastIndexOf(':');
    return idx > 0 ? b.slice(0, idx) : b;
  });
  return assessPlanScope({
    planText,
    implementationFiles,
    criteriaCount: criterionIds(block, requirementId).length,
    optIn: cfg.autoApproveSmallPlans === true,
    maxCriteria: typeof cfg.smallPlanMaxCriteria === 'number' ? cfg.smallPlanMaxCriteria : undefined,
    specFile: path.relative(projectRoot, specFile),
  });
}

export function formatPlanScope(result: PlanScopeResult): string {
  return [`AUTO_APPROVE=${result.autoApprove ? 'yes' : 'no'}`, ...result.reasons.map((r) => `- ${r}`)].join('\n');
}
