/**
 * Spec readiness gate (PIPETRUST-DOC, REQ-PIPETRUST-004).
 *
 * Implement must not start on a spec that cannot be implemented to a
 * verifiable result. A requirement is READY when its spec file lints without
 * errors, it has at least one acceptance criterion, and no criterion still
 * carries a `[needs review]` marker. A ready requirement also yields an
 * EVIDENCE PLAN — one line per criterion with the evidence kind it requires
 * (REQ-PIPETRUST-001) and a suggested named test function — which the
 * implement workflows hand to their plan and implement steps so "untested"
 * can never be planned in.
 *
 * Pure core (`assessReadiness`) over plain inputs, plus a thin loader
 * (`assessReadinessFromIndex`) that reads them from a SpecShip index.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Spec, SpecLink } from '../types';
import { lintSpecSource, type LintFinding } from '../spec-lint/lint';
import { requiredEvidenceKind, type EvidenceKind } from './evidence-kind';
import { findSpecFile, requirementBlock, linkBullets } from './postcheck';

/** UI source files — same rule the behaviour surface uses for Playwright targets. */
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro)$/i;
const NEEDS_REVIEW = /\[needs review/i;

export interface EvidencePlanLine {
  criterionId: string;
  text: string;
  kind: EvidenceKind;
  /** Suggested named test function — a real symbol `verifies:` can point at. */
  testName: string;
}

export interface ReadinessResult {
  requirementId: string;
  ready: boolean;
  /** Why the requirement is not ready (empty when ready). */
  reasons: string[];
  plan: EvidencePlanLine[];
}

export interface ReadinessInput {
  requirementId: string;
  requirement: Spec | null;
  criteria: Spec[];
  /** The requirement's (and its criteria's) `implements` links. */
  implementsLinks: SpecLink[];
  /** Lint findings for the requirement's spec file. */
  lintFindings: LintFinding[];
}

/** Criterion bullet text as stored by the extractor (title, falling back to body). */
function criterionText(c: Spec): string {
  return (c.title && c.title.trim()) || (c.body ?? '').trim();
}

/**
 * Deterministic test-function name for a criterion id:
 * `REQ-PIPETRUST-004.A1` → `reqPipetrust004A1`. Authors are expected to rename
 * it to describe the behaviour; it exists so the plan names a real symbol.
 */
export function suggestedTestName(criterionId: string): string {
  const parts = criterionId.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

export function assessReadiness(input: ReadinessInput): ReadinessResult {
  const { requirementId, requirement, criteria, implementsLinks, lintFindings } = input;
  const reasons: string[] = [];

  if (!requirement) {
    return { requirementId, ready: false, reasons: [`no spec with id ${requirementId}`], plan: [] };
  }

  const lintErrors = lintFindings.filter((f) => f.severity === 'error');
  for (const f of lintErrors) {
    reasons.push(`lint error ${f.code}${f.line ? ` (line ${f.line})` : ''}: ${f.message}`);
  }
  if (criteria.length === 0) {
    reasons.push(`${requirementId} has no acceptance criteria`);
  }
  for (const c of criteria) {
    if (NEEDS_REVIEW.test(criterionText(c)) || NEEDS_REVIEW.test(c.body ?? '')) {
      reasons.push(`${c.id} still carries [needs review]`);
    }
  }

  const linksUi = implementsLinks.some((l) => UI_FILE.test(l.targetFilePath));
  const linksRoute = implementsLinks.some((l) => l.targetNodeKind === 'route');
  const plan: EvidencePlanLine[] = criteria.map((c) => ({
    criterionId: c.id,
    text: criterionText(c),
    kind: requiredEvidenceKind(criterionText(c), { linksUi, linksRoute }),
    testName: suggestedTestName(c.id),
  }));

  return { requirementId, ready: reasons.length === 0, reasons, plan };
}

/** Human / prompt-facing rendering. The READY marker is the machine contract. */
export function formatEvidencePlan(result: ReadinessResult): string {
  const lines: string[] = [];
  if (result.ready) {
    lines.push(`READY=yes ${result.requirementId}`);
    lines.push('Evidence plan (criterion → required evidence kind → suggested test function):');
    for (const p of result.plan) {
      lines.push(`- ${p.criterionId} → ${p.kind} → ${p.testName}  — ${p.text}`);
    }
    lines.push(
      'Write each test as a NAMED function passed to it(), put the criterion id in the it() title, ' +
        'and list it under the requirement\'s `verifies:` block.',
    );
  } else {
    lines.push(`READY=no ${result.requirementId}`);
    for (const r of result.reasons) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

/** Structural slice of SpecQueries the loader reads. */
export interface ReadinessSpecQueries {
  getSpecById(id: string): Spec | null;
  getSpecsByParent(parentId: string): Spec[];
  getLinksBySpec(specId: string): SpecLink[];
}

/** Load the inputs for `assessReadiness` from an index and the spec file on disk. */
export function assessReadinessFromIndex(
  sq: ReadinessSpecQueries,
  projectRoot: string,
  requirementId: string,
): ReadinessResult {
  const requirement = sq.getSpecById(requirementId);
  if (!requirement) {
    return assessReadiness({ requirementId, requirement: null, criteria: [], implementsLinks: [], lintFindings: [] });
  }
  const criteria = sq.getSpecsByParent(requirementId).filter((s) => s.kind === 'acceptance');
  const implementsLinks = [requirementId, ...criteria.map((c) => c.id)]
    .flatMap((id) => sq.getLinksBySpec(id))
    .filter((l) => l.kind === 'implements');
  let lintFindings: LintFinding[] = [];
  const abs = path.isAbsolute(requirement.sourcePath)
    ? requirement.sourcePath
    : path.join(projectRoot, requirement.sourcePath);
  try {
    lintFindings = lintSpecSource(requirement.sourcePath, fs.readFileSync(abs, 'utf-8'));
  } catch (err) {
    lintFindings = [
      {
        code: 'lint_unreadable_file',
        severity: 'error',
        filePath: requirement.sourcePath,
        message: `Could not read: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  // Only findings about THIS requirement (or file-level ones) gate it — a
  // sibling requirement's lint error must not block an unrelated implement.
  const ownIds = new Set([requirementId, ...criteria.map((c) => c.id)]);
  lintFindings = lintFindings.filter((f) => !f.specId || ownIds.has(f.specId));
  return assessReadiness({ requirementId, requirement, criteria, implementsLinks, lintFindings });
}

const ID_MARKER = /^<!--\s*id:\s*([A-Za-z0-9._-]+)\s*-->\s*$/;

/** Acceptance bullets (id → text) read straight from a requirement block. */
export function criteriaFromBlock(block: string, requirementId: string): Array<{ id: string; text: string }> {
  const lines = block.split(/\r?\n/);
  const out: Array<{ id: string; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ID_MARKER);
    if (!m || !m[1]!.startsWith(`${requirementId}.A`)) continue;
    const text: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (ID_MARKER.test(line) || /^#{1,6}\s/.test(line) || (line.trim() === '' && text.length > 0)) break;
      if (line.trim() === '') continue;
      text.push(line.replace(/^\s*-\s+/, '').trim());
    }
    out.push({ id: m[1]!, text: text.join(' ') });
  }
  return out;
}

/**
 * File-based readiness: works without a SpecShip index (a workflow worktree
 * has none — and a CLI with no project index must never walk up to $HOME).
 * UI linkage comes from the `implementations:` bullets' file extensions;
 * route linkage needs the index, so it is only known when `routeTargets`
 * is supplied by an index-backed caller.
 */
export function assessReadinessFromFile(
  projectRoot: string,
  requirementId: string,
  routeTargets: Set<string> = new Set(),
): ReadinessResult {
  const specFile = findSpecFile(projectRoot, requirementId);
  const source = specFile ? fs.readFileSync(specFile, 'utf-8') : null;
  const block = source ? requirementBlock(source, requirementId) : null;
  if (!specFile || !source || !block) {
    return assessReadiness({ requirementId, requirement: null, criteria: [], implementsLinks: [], lintFindings: [] });
  }
  const rel = path.relative(projectRoot, specFile);
  const now = Date.now();
  const asSpec = (id: string, title: string, kind: Spec['kind']): Spec => ({
    id, kind, title, body: title, format: 'markdown', sourcePath: rel, contentHash: '', createdAt: now, updatedAt: now,
  });
  const criteria = criteriaFromBlock(block, requirementId).map((c) => asSpec(c.id, c.text, 'acceptance'));
  const implementsLinks = linkBullets(block, 'implementations').map((b) => {
    const idx = b.lastIndexOf(':');
    const file = idx > 0 ? b.slice(0, idx) : b;
    const symbol = idx > 0 ? b.slice(idx + 1) : '';
    return {
      targetFilePath: file,
      targetQualifiedName: symbol,
      targetNodeKind: routeTargets.has(`${file}:${symbol}`) ? 'route' : 'function',
      kind: 'implements',
    } as unknown as SpecLink;
  });
  const ownIds = new Set([requirementId, ...criteria.map((c) => c.id)]);
  const lintFindings = lintSpecSource(rel, source).filter((f) => !f.specId || ownIds.has(f.specId));
  return assessReadiness({
    requirementId,
    requirement: asSpec(requirementId, requirementId, 'requirement'),
    criteria,
    implementsLinks,
    lintFindings,
  });
}

