/**
 * Spec coverage rollup (REQ-VSTATE-006).
 *
 * Answers the one question nothing could answer before: which requirements and
 * which individual acceptance criteria have PASSING TEST EVIDENCE.
 *
 * The rule that makes the number honest: a verdict derives ONLY from `tests`
 * links. An `implements` link says code claims to satisfy the spec — it is not
 * proof, so a criterion with implementation and no test reads `untested`
 * (REQ-VSTATE-006.A3). This is the conflation the dashboard's
 * implemented-counted-as-met display was built on.
 */

import type { Spec, SpecLink, SpecLinkState } from '../types';
import type { SpecQueries } from '../db/spec-queries';
import { isNonTestEvidence } from '../resolution/test-title-links';

/**
 * Coverage verdict for one spec node.
 *
 * - `untested`  no `tests` link at all (implementation alone lands here)
 * - `tested`    tests are linked but none has a passing verification yet
 * - `verified`  every linked test is `verified`
 * - `broken`    at least one linked test is `broken` (worst state wins)
 */
export type CoverageVerdict = 'untested' | 'tested' | 'verified' | 'broken';

/** Link counts by state for one link kind. */
export interface LinkRollup {
  count: number;
  /** Per-state counts, e.g. `{ verified: 2, drifted: 1 }`. Only non-zero keys. */
  states: Partial<Record<SpecLinkState, number>>;
}

/** Coverage for one acceptance criterion (or any leaf spec). */
export interface CriterionCoverage {
  specId: string;
  title: string;
  kind: Spec['kind'];
  implementsLinks: LinkRollup;
  testsLinks: LinkRollup;
  verdict: CoverageVerdict;
}

/** Coverage for one requirement plus each of its criteria. */
export interface RequirementCoverage extends CriterionCoverage {
  criteria: CriterionCoverage[];
  /** Criteria whose verdict is `verified` / `tested` / `broken` / `untested`. */
  criteriaTotals: Record<CoverageVerdict, number>;
  /** Criteria carrying at least one `tests` link — the "N of M" numerator. */
  criteriaWithTests: number;
  /** Criteria counted, or 1 when the requirement has none (itself). */
  criteriaCount: number;
}

export interface SpecCoverageReport {
  /** The spec the report was scoped to, or null for the whole project. */
  specId: string | null;
  requirements: RequirementCoverage[];
  totals: {
    requirements: number;
    criteria: number;
    criteriaWithTests: number;
    criteriaVerified: number;
    criteriaBroken: number;
  };
}

function rollup(links: SpecLink[]): LinkRollup {
  const states: Partial<Record<SpecLinkState, number>> = {};
  for (const l of links) states[l.state] = (states[l.state] ?? 0) + 1;
  return { count: links.length, states };
}

/**
 * Verdict from `tests` links alone (REQ-VSTATE-006.A1 / .A3). Links flagged as
 * non-test evidence (a `verifies:` bullet aimed at a fixture — REQ-VSTATE-002.A4)
 * are not counted: they cannot prove anything, so a criterion "covered" only by
 * one stays `untested`.
 */
export function verdictFor(testsLinks: SpecLink[]): CoverageVerdict {
  const usable = testsLinks.filter((l) => !isNonTestEvidence(l));
  if (usable.length === 0) return 'untested';
  if (usable.some((l) => l.state === 'broken')) return 'broken';
  if (usable.every((l) => l.state === 'verified')) return 'verified';
  return 'tested';
}

/** Worst-wins merge, so a rollup never reads better than its worst part. */
function mergeVerdicts(verdicts: CoverageVerdict[]): CoverageVerdict {
  if (verdicts.length === 0) return 'untested';
  if (verdicts.includes('broken')) return 'broken';
  if (verdicts.includes('untested')) return 'untested';
  if (verdicts.every((v) => v === 'verified')) return 'verified';
  return 'tested';
}

function coverageOf(sq: SpecQueries, spec: Spec): CriterionCoverage {
  const links = sq.getLinksBySpec(spec.id);
  const testsLinks = links.filter((l) => l.kind === 'tests');
  return {
    specId: spec.id,
    title: spec.title,
    kind: spec.kind,
    implementsLinks: rollup(links.filter((l) => l.kind === 'implements')),
    testsLinks: rollup(testsLinks),
    verdict: verdictFor(testsLinks),
  };
}

/**
 * Compute the coverage rollup for one spec, or for every requirement in the
 * project when `specId` is omitted.
 *
 * Scoping: a `document` id expands to its requirement children; a `requirement`
 * id is itself; anything else (an acceptance criterion, a domain fact, a brief)
 * is reported as a single entry with no children. An unknown id — or a spec with
 * no children and no links — returns an empty-but-valid report, never an error
 * (REQ-VSTATE-006.A4).
 */
export function computeSpecCoverage(sq: SpecQueries, specId?: string): SpecCoverageReport {
  let roots: Spec[];
  if (specId) {
    const spec = sq.getSpecById(specId);
    if (!spec) {
      return {
        specId,
        requirements: [],
        totals: { requirements: 0, criteria: 0, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0 },
      };
    }
    roots =
      spec.kind === 'document'
        ? sq.getSpecsByParent(spec.id).filter((s) => s.kind === 'requirement')
        : [spec];
  } else {
    roots = sq.getAllSpecs().filter((s) => s.kind === 'requirement');
  }

  const requirements: RequirementCoverage[] = roots.map((req) => {
    const own = coverageOf(sq, req);
    const criteria = sq
      .getSpecsByParent(req.id)
      .filter((c) => c.kind === 'acceptance')
      .map((c) => coverageOf(sq, c));

    const criteriaTotals: Record<CoverageVerdict, number> = {
      untested: 0,
      tested: 0,
      verified: 0,
      broken: 0,
    };
    for (const c of criteria) criteriaTotals[c.verdict]++;

    // A requirement with no acceptance children IS its own single criterion —
    // the same convention the workflow coverage line has always used.
    const criteriaCount = criteria.length > 0 ? criteria.length : 1;
    // "has linked tests" means USABLE test evidence — `untested` is exactly the
    // verdict for "no tests link that could ever prove this".
    const criteriaWithTests =
      criteria.length > 0
        ? criteria.filter((c) => c.verdict !== 'untested').length
        : own.verdict === 'untested'
          ? 0
          : 1;
    if (criteria.length === 0) criteriaTotals[own.verdict]++;

    return {
      ...own,
      verdict: mergeVerdicts(
        criteria.length > 0 ? criteria.map((c) => c.verdict) : [own.verdict]
      ),
      criteria,
      criteriaTotals,
      criteriaWithTests,
      criteriaCount,
    };
  });

  return {
    specId: specId ?? null,
    requirements,
    totals: {
      requirements: requirements.length,
      criteria: requirements.reduce((n, r) => n + r.criteriaCount, 0),
      criteriaWithTests: requirements.reduce((n, r) => n + r.criteriaWithTests, 0),
      criteriaVerified: requirements.reduce((n, r) => n + r.criteriaTotals.verified, 0),
      criteriaBroken: requirements.reduce((n, r) => n + r.criteriaTotals.broken, 0),
    },
  };
}

/**
 * The single coverage line the implement workflow's human gate rests on
 * (REQ-VSTATE-005.A2). Rendered here, from the same report `getSpecCoverage`
 * returns, so the workflow's number and the API's number cannot disagree —
 * previously an LLM counted it by eye.
 */
export function formatCoverageLine(report: SpecCoverageReport): string {
  const subject = report.specId ?? 'the project';
  const { criteriaWithTests, criteria } = report.totals;
  return `${criteriaWithTests} of ${criteria} acceptance criteria for ${subject} have linked tests.`;
}
