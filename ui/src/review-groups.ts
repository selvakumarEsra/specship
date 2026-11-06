/**
 * Review grouping (REQ-DASHSIMPLE-004): every requirement lands in exactly one
 * of Drifted, Completed or Pending. Pure logic, no React — the Review screen
 * and the Overview counts both read it, so the two can never disagree.
 *
 * - Drifted wins: any link on the requirement or its criteria is `drifted`,
 *   `broken` or `orphaned`.
 * - Completed: every acceptance criterion's test-evidence verdict is
 *   `verified` (from `tests` links — the coverage rollup's verdict). Code links
 *   never complete a requirement on their own.
 * - Pending: everything else, with one tag naming why.
 */
import type { DriftLink, LinkRollup, RequirementCoverage } from './api';

export type ReviewGroup = 'drifted' | 'completed' | 'pending';

/** Display order of the groups — the work that needs a hand first. */
export const REVIEW_GROUPS: ReviewGroup[] = ['drifted', 'pending', 'completed'];

export type PendingTag =
  | 'unimplemented'
  | 'implemented, unverified'
  | 'partly verified'
  | 'no acceptance criteria';

/** Link states that put a requirement in Drifted. */
export const DRIFT_STATES = ['drifted', 'broken', 'orphaned'] as const;

/** What changed under a drifted link. */
export type DriftSide = 'spec' | 'code' | 'test';

export interface DriftReason {
  state: string;
  /** The link's target — qualified name, else file path. */
  target: string;
  changed: DriftSide;
  /**
   * What changed in a code drift (REQ-LINKACC-002): `rename-only`,
   * `type-change`, `shape-change` or `unclassified`. Absent when the link
   * carries no kind (spec drift, or a drift recorded before kinds existed).
   */
  kind?: string;
  /** The command (or step) that repairs this link. */
  fix: string;
}

export interface ReviewRow {
  specId: string;
  title: string;
  group: ReviewGroup;
  tag?: PendingTag;
  driftReasons: DriftReason[];
  /** REQ-LINKACC-007: a verified requirement's untested criteria. */
  untestedCount?: UntestedCount;
  /** REQ-LINKACC-004: links whose body changed since their state was taken. Never moves the group. */
  bodyChanged?: BodyChangedNote[];
}

/** `count` links whose body changed since `since` (REQ-LINKACC-004). */
export interface BodyChangedNote {
  since: string;
  count: number;
}

/**
 * Body-changed notes for a requirement and its criteria, read from the coverage
 * rollup's `bodyChanged` counts (REQ-LINKACC-004) — the server decides which
 * links carry a marker, the UI only sums. Ordered verified first, then
 * implemented, then any other state. Empty when nothing changed.
 */
export function bodyChangedNotes(req: RequirementCoverage): BodyChangedNote[] {
  const totals = new Map<string, number>();
  for (const node of [req, ...req.criteria]) {
    for (const r of [node.implementsLinks, node.testsLinks, node.otherLinks ?? NO_LINKS]) {
      for (const [since, n] of Object.entries(r.bodyChanged ?? {})) {
        if (n > 0) totals.set(since, (totals.get(since) ?? 0) + n);
      }
    }
  }
  const order = (s: string) => (s === 'verified' ? 0 : s === 'implemented' ? 1 : 2);
  return [...totals.entries()]
    .map(([since, count]) => ({ since, count }))
    .sort((a, b) => order(a.since) - order(b.since));
}

/** `"body changed since verified"`, with a count when more than one link changed. */
export function formatBodyChangedNote(n: BodyChangedNote): string {
  return n.count > 1 ? `${n.count} bodies changed since ${n.since}` : `body changed since ${n.since}`;
}

/** `untested` of `total` criteria have no test (REQ-LINKACC-007). */
export interface UntestedCount {
  untested: number;
  total: number;
}

const NO_LINKS: LinkRollup = { count: 0, states: {} };

/**
 * Port of `untestedCriteria` (src/graph/spec-coverage.ts) — the UI only mirrors
 * the types, so the rule is repeated here and MUST stay identical (the
 * REQ-LINKACC-007.A3 test feeds one fixture to both). Null unless the
 * requirement is verified (≥1 link, every link of every kind `verified`) and
 * at least one criterion's verdict is `untested`.
 */
export function untestedCriteriaCount(req: RequirementCoverage): UntestedCount | null {
  if (req.criteria.length === 0) return null;
  let count = 0;
  for (const node of [req, ...req.criteria]) {
    for (const r of [node.implementsLinks, node.testsLinks, node.otherLinks ?? NO_LINKS]) {
      count += r.count;
      if ((r.states.verified ?? 0) !== r.count) return null;
    }
  }
  if (count === 0) return null;
  const untested = req.criteria.filter((c) => c.verdict === 'untested').length;
  return untested > 0 ? { untested, total: req.criteria.length } : null;
}

/**
 * The repair for a link state. Real CLI commands only (verified against
 * src/bin/specship.ts), never an agent-specific slash command — the dashboard
 * is agent-agnostic. There is no `specship relink`: an orphaned link is
 * re-pointed in the spec file, then picked up by sync.
 */
export function fixCommand(state: string, specId: string): string {
  if (state === 'orphaned') return "update the spec's implementations: block, then run specship sync";
  return `specship workflow run spec-fix --input SPEC_ID=${specId}`;
}

const isDriftState = (s: string) => (DRIFT_STATES as readonly string[]).includes(s);

function driftCount(r: LinkRollup | undefined): number {
  if (!r) return 0;
  return DRIFT_STATES.reduce((n, s) => n + (r.states[s] ?? 0), 0);
}

/** Does this drift link belong to the requirement (itself or one of its criteria)? */
function ownsLink(reqId: string, l: DriftLink): boolean {
  return l.specId === reqId || l.specId.startsWith(reqId + '.');
}

/** Which link drifted, which side changed (spec, code or test), and what kind of change (REQ-LINKACC-002). */
export function driftReason(link: DriftLink, reqId: string): DriftReason {
  const target = link.targetQualifiedName || link.targetFilePath || '(unknown target)';
  const changed: DriftSide = link.driftAxis === 'spec' ? 'spec' : link.kind === 'tests' ? 'test' : 'code';
  const reason: DriftReason = { state: link.state, target, changed, fix: fixCommand(link.state, reqId) };
  if (typeof link.driftKind === 'string' && link.driftKind) reason.kind = link.driftKind;
  return reason;
}

// @implements REQ-DASHSIMPLE-004
export function classifyRequirement(
  req: RequirementCoverage,
  driftLinks: DriftLink[],
): {
  group: ReviewGroup;
  tag?: PendingTag;
  driftReasons: DriftReason[];
  untestedCount?: UntestedCount;
  bodyChanged?: BodyChangedNote[];
} {
  // The group is decided without the body-changed notes: a body-only change
  // never moves a requirement into Drifted (REQ-LINKACC-004.A4).
  const base = classifyGroup(req, driftLinks);
  const gap = untestedCriteriaCount(req);
  const body = bodyChangedNotes(req);
  return {
    ...base,
    ...(gap ? { untestedCount: gap } : {}),
    ...(body.length ? { bodyChanged: body } : {}),
  };
}

function classifyGroup(
  req: RequirementCoverage,
  driftLinks: DriftLink[],
): { group: ReviewGroup; tag?: PendingTag; driftReasons: DriftReason[] } {
  const own = driftLinks.filter((l) => isDriftState(l.state) && ownsLink(req.specId, l));
  const rollupDrift =
    driftCount(req.implementsLinks) + driftCount(req.testsLinks) +
    req.criteria.reduce((n, c) => n + driftCount(c.implementsLinks) + driftCount(c.testsLinks), 0);

  if (own.length || rollupDrift > 0) {
    const reasons = own.map((l) => driftReason(l, req.specId));
    if (!reasons.length) {
      // The rollup saw drift the drift list didn't carry (e.g. past its limit):
      // still Drifted, with the state that put it there.
      const state = DRIFT_STATES.find((s) =>
        (req.implementsLinks.states[s] ?? 0) + (req.testsLinks.states[s] ?? 0) > 0) ?? 'drifted';
      reasons.push({ state, target: `${rollupDrift} link${rollupDrift === 1 ? '' : 's'}`, changed: 'code', fix: fixCommand(state, req.specId) });
    }
    return { group: 'drifted', driftReasons: reasons };
  }

  const criteria = req.criteria;
  if (req.criteriaCount === 0 || criteria.length === 0) {
    return { group: 'pending', tag: 'no acceptance criteria', driftReasons: [] };
  }
  const verified = criteria.filter((c) => c.verdict === 'verified').length;
  if (verified === criteria.length) return { group: 'completed', driftReasons: [] };

  const hasCode = req.implementsLinks.count + criteria.reduce((n, c) => n + c.implementsLinks.count, 0) > 0;
  if (!hasCode) return { group: 'pending', tag: 'unimplemented', driftReasons: [] };
  if (verified > 0) return { group: 'pending', tag: 'partly verified', driftReasons: [] };
  return { group: 'pending', tag: 'implemented, unverified', driftReasons: [] };
}

/** Sort every requirement into exactly one group, keeping input order within a group. */
// @implements REQ-DASHSIMPLE-004
export function groupRequirements(
  reqs: RequirementCoverage[],
  drift: DriftLink[],
): Record<ReviewGroup, ReviewRow[]> {
  const out: Record<ReviewGroup, ReviewRow[]> = { drifted: [], pending: [], completed: [] };
  for (const r of reqs) {
    const c = classifyRequirement(r, drift);
    out[c.group].push({ specId: r.specId, title: r.title, ...c });
  }
  return out;
}
