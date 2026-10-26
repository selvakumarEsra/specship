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
import * as path from 'path';
import {
  classifyTestEvidence,
  requiredEvidenceKind,
  EVIDENCE_KINDS,
  type EvidenceKind,
} from '../spec-quality/evidence-kind';

/** Matches behaviour-surface's `UI_FILE`: a direct link to one of these is UI code. */
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro)$/i;

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
  /**
   * The evidence kind this criterion requires (REQ-PIPETRUST-001) — declared
   * inline or derived. Advisory alongside the verdict; never changes it.
   */
  requiredKind: EvidenceKind;
  /** Kinds actually provided by the criterion's usable `tests` links (REQ-PIPETRUST-003). */
  presentKinds: EvidenceKind[];
  /** True when `presentKinds` includes `requiredKind`. */
  kindSatisfied: boolean;
}

/** Per-criterion evidence-kind result (REQ-PIPETRUST-003). */
export interface EvidenceKindResult {
  requiredKind: EvidenceKind;
  presentKinds: EvidenceKind[];
  kindSatisfied: boolean;
}

export interface EvidenceKindOptions {
  /** Implements links whose targets decide `linksUi` / `linksRoute`. */
  implementsLinks?: SpecLink[];
  /** Root that relative link target paths resolve against (default: cwd). */
  projectRoot?: string;
  /** Test-file classifier; defaults to reading the file. Injectable for caching. */
  classify?: (absPath: string, relPath: string) => EvidenceKind;
}

export interface SpecCoverageOptions {
  /** Project root for reading linked test files when classifying evidence kind. */
  projectRoot?: string;
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
  /** Evidence-kind rollup (REQ-PIPETRUST-003) — kept out of `totals` so its shape is unchanged. */
  evidence: {
    /** Criteria (requirements with none count as one) lacking their required kind. */
    criteriaMissingKind: number;
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

/**
 * Required vs present evidence kind for one criterion (REQ-PIPETRUST-003.A1).
 *
 * Required: {@link requiredEvidenceKind} over the criterion text, with
 * `linksUi` / `linksRoute` read from the given implements links (a UI file
 * extension, or a target node of kind `route`). Present: the kind of each
 * usable `tests` link's target file — links flagged as non-test evidence are
 * ignored, exactly as the verdict ignores them. Link state does not matter
 * here: the verdict already says whether the tests pass.
 */
export function evidenceKindCoverage(
  criterionText: string,
  testsLinks: SpecLink[],
  opts: EvidenceKindOptions = {}
): EvidenceKindResult {
  const impl = opts.implementsLinks ?? [];
  const requiredKind = requiredEvidenceKind(criterionText, {
    linksUi: impl.some((l) => UI_FILE.test(l.targetFilePath ?? '')),
    linksRoute: impl.some((l) => l.targetNodeKind === 'route'),
  });
  const classify = opts.classify ?? ((abs: string) => classifyTestEvidence(abs));
  const present = new Set<EvidenceKind>();
  for (const l of testsLinks) {
    if (l.kind !== 'tests' || isNonTestEvidence(l) || !l.targetFilePath) continue;
    const rel = l.targetFilePath;
    const abs = path.isAbsolute(rel) || !opts.projectRoot ? rel : path.join(opts.projectRoot, rel);
    present.add(classify(abs, rel));
  }
  const presentKinds = EVIDENCE_KINDS.filter((k) => present.has(k));
  return { requiredKind, presentKinds, kindSatisfied: present.has(requiredKind) };
}

/** Classify each test file once per report, keyed by absolute path. */
function cachedClassifier(): (abs: string) => EvidenceKind {
  const cache = new Map<string, EvidenceKind>();
  return (abs) => {
    let k = cache.get(abs);
    if (!k) {
      k = classifyTestEvidence(abs);
      cache.set(abs, k);
    }
    return k;
  };
}

function coverageOf(
  sq: SpecQueries,
  spec: Spec,
  kindOpts: EvidenceKindOptions & { extraImplements?: SpecLink[] }
): CriterionCoverage {
  const links = sq.getLinksBySpec(spec.id);
  const testsLinks = links.filter((l) => l.kind === 'tests');
  const implementsLinks = links.filter((l) => l.kind === 'implements');
  const kinds = evidenceKindCoverage(spec.body ?? spec.title, testsLinks, {
    ...kindOpts,
    implementsLinks: [...(kindOpts.extraImplements ?? []), ...implementsLinks],
  });
  return {
    specId: spec.id,
    title: spec.title,
    kind: spec.kind,
    implementsLinks: rollup(implementsLinks),
    testsLinks: rollup(testsLinks),
    verdict: verdictFor(testsLinks),
    ...kinds,
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
export function computeSpecCoverage(
  sq: SpecQueries,
  specId?: string,
  options: SpecCoverageOptions = {}
): SpecCoverageReport {
  const kindOpts: EvidenceKindOptions = {
    projectRoot: options.projectRoot,
    classify: cachedClassifier(),
  };
  let roots: Spec[];
  if (specId) {
    const spec = sq.getSpecById(specId);
    if (!spec) {
      return {
        specId,
        requirements: [],
        totals: { requirements: 0, criteria: 0, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0 },
        evidence: { criteriaMissingKind: 0 },
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
    const own = coverageOf(sq, req, kindOpts);
    // A criterion inherits the requirement's direct implements links when
    // deciding UI / route (REQ-PIPETRUST-001.A2 — "a requirement linked to…").
    const reqImplements = sq.getLinksBySpec(req.id).filter((l) => l.kind === 'implements');
    const criteria = sq
      .getSpecsByParent(req.id)
      .filter((c) => c.kind === 'acceptance')
      .map((c) => coverageOf(sq, c, { ...kindOpts, extraImplements: reqImplements }));

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
      // A requirement's kind is satisfied only when every criterion's is; with
      // no criteria it is its own single criterion.
      kindSatisfied: criteria.length > 0 ? criteria.every((c) => c.kindSatisfied) : own.kindSatisfied,
      criteria,
      criteriaTotals,
      criteriaWithTests,
      criteriaCount,
    };
  });

  const criteriaMissingKind = requirements.reduce(
    (n, r) =>
      n + (r.criteria.length > 0 ? r.criteria.filter((c) => !c.kindSatisfied).length : r.kindSatisfied ? 0 : 1),
    0
  );

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
    evidence: { criteriaMissingKind },
  };
}

/**
 * Every in-scope criterion lacking its required evidence kind — the list
 * `specship coverage` flags, as `{ specId, requiredKind, presentKinds }`. A
 * requirement with no criteria stands in as its own single criterion.
 */
export function criteriaMissingKind(report: SpecCoverageReport): CriterionCoverage[] {
  const out: CriterionCoverage[] = [];
  for (const r of report.requirements) {
    if (r.criteria.length > 0) out.push(...r.criteria.filter((c) => !c.kindSatisfied));
    else if (!r.kindSatisfied) out.push(r);
  }
  return out;
}

/**
 * Exit code for `specship coverage --require-kinds` (REQ-PIPETRUST-003.A2):
 * non-zero when any in-scope criterion lacks its required kind, else zero.
 * Without the flag the command never fails on kinds.
 */
export function requireKindsExitCode(report: SpecCoverageReport, requireKinds: boolean): number {
  if (!requireKinds) return 0;
  return criteriaMissingKind(report).length > 0 ? 1 : 0;
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
