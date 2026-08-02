/**
 * Regression pack builder + upsert (JIRA-REGRESSION-DOC, REQ-JIRAREG-001).
 *
 * Reads the loaded spec set, filters to requirements whose acceptance-side
 * link roll-up counts as implemented or verified (at least one implements-kind
 * link on the requirement or one of its acceptance children reads implemented
 * or verified), and expands each `REQ-*.A<N>` into a regression case grouped by
 * a domain area. Domain-area derivation is REQ-JIRAREG-002's concern — this
 * module files every case under the single `Uncategorised` placeholder area;
 * `groupCasesByDomain` is a trivial passthrough so REQ-JIRAREG-002 has one
 * seam to enrich later.
 *
 * The upsert side is a fingerprint-gated idempotent writer, mirroring
 * `publish.ts`: one watermarked epic per project (found by label, never
 * created twice), one Story per domain area (found by label), one Sub-task
 * per case (found by label). Fingerprint drift on the rendered body drives
 * create / update / skip.
 *
 * SECURITY (REQ-JIRA-009): only public keys + spec-derived text ever travel
 * through here — no credential is handled or echoed.
 */

import * as crypto from 'crypto';
import type { Node, Spec, SpecLink } from '../types';
import {
  sourceSpecIds,
  INHERITED_LINK_MAX_DEPTH,
} from '../resolution/spec-link-resolver';
import { computeBehaviourSurface } from '../behaviour/behaviour-surface';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One regression case — one acceptance criterion of an implemented spec. */
export interface RegressionCase {
  /** The requirement id, e.g. `REQ-FOO-001`. */
  reqId: string;
  /** The acceptance criterion id, e.g. `REQ-FOO-001.A2`. */
  criterionId: string;
  /** The criterion text (bullet body / title). */
  criterionText: string;
  /** The requirement spec's source path (repo-relative). */
  specPath: string;
  /**
   * Behaviour tier derived from the requirement's behaviour surface
   * (REQ-JIRAREG-004.A2): `'ui'` iff any linked or neighbour node is a
   * component / lives in a front-end file, otherwise `'backend'`.
   * `'unknown'` is retained for callers that construct cases without a
   * graph in reach (fixtures, dry planners) — never emitted by
   * {@link buildRegressionPack} which always resolves a concrete tier.
   */
  tier: 'ui' | 'backend' | 'unknown';
  /**
   * True when the criterion body is too vague to execute against, or leaks
   * code-shaped tokens (paths, symbols) the black-box pack must not echo
   * (REQ-JIRAREG-004.A3). The case is still emitted so the pack stays
   * complete; the report drives a human rephrase pass.
   */
  needsRephrase?: boolean;
  /** Free-text reason surfaced by {@link renderRephraseReport}. */
  rephraseReason?: string;
  /**
   * Domain area label for THIS case row — the area under which the case files.
   * A requirement with two domain facts produces two `RegressionCase` rows: an
   * `executable` under the first area and a `crossref` under the second.
   */
  domainArea: string;
  /**
   * All domain areas the requirement links to (sorted by domain spec id).
   * Same list on every case row derived from the requirement — useful for the
   * cross-reference body pointing back at siblings.
   */
  areasAll: string[];
  /**
   * `'executable'` files as the primary case in the requirement's first area.
   * `'crossref'` files as a pointer in each additional area — same spec, no
   * duplicate steps — so a tester scanning either area finds the case.
   */
  kind: 'executable' | 'crossref';
  /**
   * When `kind === 'crossref'`, the criterion id of the executable sibling
   * (always equals `criterionId` — the cross-ref carries the same source id;
   * this field lets renderers name the pair without recomputing).
   */
  crossReferenceOf?: string;
}

export interface EpicPlan {
  summary: string;
  description: string;
  label: string;
}

export interface StoryPlan {
  domainArea: string;
  summary: string;
  description: string;
  label: string;
  cases: CasePlan[];
}

export interface CasePlan {
  reqId: string;
  criterionId: string;
  summary: string;
  description: string;
  label: string;
  specPath: string;
  /** `'executable'` or `'crossref'` — cross-refs carry a different label prefix. */
  kind: 'executable' | 'crossref';
  /** Tier label attached alongside the case marker (REQ-JIRAREG-004.A2). */
  tierLabel: string;
}

/** One requirement with no domain-fact linkage — REQ-JIRAREG-002.A2. */
export interface DomainGap {
  reqId: string;
  specPath: string;
}

export interface RegressionPackModel {
  epic: EpicPlan;
  stories: StoryPlan[];
  cases: CasePlan[];
  /**
   * Requirements that entered the pack with no domain-fact linkage. Rendered
   * separately by {@link renderDomainGapReport} so the caller can prompt the
   * `/specship:spec domain` capture flow (REQ-JIRAREG-002.A2).
   */
  domainGaps: DomainGap[];
  /**
   * Criteria the classifier flagged for human rephrase (REQ-JIRAREG-004.A3) —
   * vague ("system works correctly") or leaking code-shaped tokens the
   * black-box body must not echo. Rendered by {@link renderRephraseReport}.
   */
  rephraseFlags: RephraseFlag[];
}

/** One criterion flagged for rephrase (REQ-JIRAREG-004.A3). */
export interface RephraseFlag {
  criterionId: string;
  specPath: string;
  reason: string;
}

export interface UpsertContext {
  projectKey: string;
  /** JIRA issue-type name for the pack epic. Default `Epic`. */
  epicIssueType?: string;
  /** JIRA issue-type name for the domain area. Default `Story`. */
  storyIssueType?: string;
  /** JIRA issue-type name for a case. Default `Sub-task`. */
  caseIssueType?: string;
  /** Dry-run: build the plan, do zero JIRA writes. */
  dryRun?: boolean;
}

export interface UpsertResult {
  epicKey: string | null;
  epicCreated: boolean;
  storiesCreated: number;
  storiesUpdated: number;
  storiesSkipped: number;
  casesCreated: number;
  casesUpdated: number;
  casesSkipped: number;
  /**
   * Cross-reference sub-tasks (secondary-area pointers, REQ-JIRAREG-002.A1) —
   * counted separately from executable cases so a re-run's zero-write bar can
   * be asserted per kind.
   */
  crossRefsCreated: number;
  crossRefsUpdated: number;
  crossRefsSkipped: number;
  /**
   * Cases newly marked obsolete on this run — REQ-JIRAREG-003.A3. A re-run
   * that finds the same case already carrying the obsolete watermark + label
   * does not re-count it (REQ-JIRAREG-003.A4).
   */
  casesObsoleted: number;
  /** JIRA keys of cases marked obsolete on this run (in scan order). */
  obsoletedCaseKeys: string[];
  /** Extra pack-epic issue keys found under the same label (single-epic invariant). */
  orphanedEpicKeys: string[];
  /** Per-case JIRA keys, keyed on `<reqId>.<criterionSuffix>` for back-linking. */
  caseKeysByCriterion: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Labels + watermarks
// ---------------------------------------------------------------------------

export const REG_PACK_EPIC_LABEL = 'specship-regression-pack';
export const REG_PACK_DOMAIN_LABEL_PREFIX = 'specship-regdomain-';
export const REG_PACK_CASE_LABEL_PREFIX = 'specship-regcase-';
/**
 * Cross-reference sub-tasks (REQ-JIRAREG-002.A1). Distinct prefix from the
 * executable case label so a re-run finds the same cross-ref in the same area
 * (idempotent) without conflating it with the primary case.
 */
export const REG_PACK_XREF_LABEL_PREFIX = 'specship-regxref-';

/**
 * Stable marker label every regression case carries alongside its per-case
 * slug label (REQ-JIRAREG-003). JIRA JQL cannot wildcard `labels`, so the
 * orphan scan queries this fixed label to enumerate every case in the pack
 * without touching the epic or area stories (which never carry it).
 */
export const REG_PACK_CASE_MARKER_LABEL = 'specship-regcase';

/**
 * Board-filterable label attached to cases whose source criterion no longer
 * exists in the spec set (REQ-JIRAREG-003.A3). A comment alone would be
 * invisible in a JIRA filter — this label makes `labels = "specship-reg-obsolete"`
 * a valid JQL query. Never removed automatically.
 */
export const REG_PACK_OBSOLETE_LABEL = 'specship-reg-obsolete';

/**
 * Board-filterable tier labels (REQ-JIRAREG-004.A2) — testers can filter a
 * board to just UI or just backend cases with a single label query. Attached
 * to every executable + cross-ref case; the same tier is derived once per
 * requirement so both rows in a two-area case carry the same label.
 */
export const REG_PACK_TIER_LABEL_UI = 'specship-tier-ui';
export const REG_PACK_TIER_LABEL_BACKEND = 'specship-tier-backend';

function tierLabel(tier: 'ui' | 'backend' | 'unknown'): string {
  return tier === 'ui' ? REG_PACK_TIER_LABEL_UI : REG_PACK_TIER_LABEL_BACKEND;
}

export const REG_PACK_EPIC_WATERMARK = '<!-- specship:regression-pack v1 -->';
export const REG_PACK_STORY_WATERMARK = '<!-- specship:regression-pack:story v1 -->';
export const REG_PACK_CASE_WATERMARK = '<!-- specship:regression-pack:case v1 -->';

/**
 * Stable prefix of the obsolete-marker comment (REQ-JIRAREG-003.A3). The
 * per-run body carries a timestamp, but the idempotency key here does NOT
 * include the timestamp — a re-run with the same `reason` finds the prior
 * marker via `body.startsWith(prefix + reason + " -->")` and writes nothing
 * (REQ-JIRAREG-003.A4).
 */
export const REG_PACK_OBSOLETE_WATERMARK_PREFIX = '<!-- specship:regobsolete v1';

function obsoleteWatermark(reason: string): string {
  return `${REG_PACK_OBSOLETE_WATERMARK_PREFIX} reason=${reason} -->`;
}

const UNCATEGORISED_AREA = 'Uncategorised';

// ---------------------------------------------------------------------------
// SpecQueries structural slice — enough to walk requirements + links.
// ---------------------------------------------------------------------------

export interface BuilderSpecQueries {
  getAllSpecs(): Spec[];
  getSpecsByParent(parentId: string): Spec[];
  getLinksBySpec(specId: string): SpecLink[];
  /**
   * Point lookup used by the domain-area walk (REQ-JIRAREG-002). Mirrors
   * {@link SpecLinkResolver.getInheritedLinks}'s traversal — we need to
   * resolve each declared spec id (via `parentId` / `metadata.depends_on`) to
   * a `Spec` so its own dependency chain can be followed to the next hop.
   */
  getSpecById(id: string): Spec | undefined | null;
  /**
   * Optional graph accessor (REQ-JIRAREG-004.A2): the resolved code nodes a
   * requirement + its acceptance children link to. Populated by the CLI /
   * MCP wiring; absent in test fixtures unless a fixture opts in. When
   * absent, {@link deriveCaseTier} falls back to `'backend'` (never spurious
   * `'ui'`).
   */
  getLinkedNodesForReq?(reqId: string): Node[];
  /**
   * Optional graph accessor (REQ-JIRAREG-004.A2): 1-hop caller/callee
   * neighbours of the given nodes. Widens tier detection so a backend
   * handler that renders a linked UI component still classifies as UI.
   */
  getNeighbourNodes?(nodeIds: readonly string[]): Node[];
}

// ---------------------------------------------------------------------------
// Builder (pure)
// ---------------------------------------------------------------------------

/** States that count as implemented+ for regression-pack inclusion. */
const IMPLEMENTED_PLUS_STATES = new Set<SpecLink['state']>([
  'implemented',
  'verified',
]);

/**
 * Roll up the "implemented+" bit for one requirement: is there at least one
 * implements-kind link (on the requirement itself or any of its acceptance
 * children) whose state reads `implemented` or `verified`? This mirrors the
 * funnel/coverage roll-up SpecQueries drives (per the approval correction).
 */
function isRequirementImplementedPlus(
  sq: BuilderSpecQueries,
  reqId: string,
): boolean {
  const own = sq.getLinksBySpec(reqId);
  if (own.some((lk) => lk.kind === 'implements' && IMPLEMENTED_PLUS_STATES.has(lk.state))) {
    return true;
  }
  const children = sq.getSpecsByParent(reqId).filter((c) => c.kind === 'acceptance');
  for (const child of children) {
    const links = sq.getLinksBySpec(child.id);
    if (links.some((lk) => lk.kind === 'implements' && IMPLEMENTED_PLUS_STATES.has(lk.state))) {
      return true;
    }
  }
  return false;
}

/** JIRA summaries cap at 255; stay well under. */
const SUMMARY_MAX = 240;

function oneLineTrim(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > SUMMARY_MAX ? `${one.slice(0, SUMMARY_MAX - 1)}…` : one;
}

/** `REQ-FOO-001.A2` → `A2` (criterion suffix without the requirement prefix). */
function criterionSuffix(reqId: string, criterionId: string): string {
  return criterionId.startsWith(`${reqId}.`)
    ? criterionId.slice(reqId.length + 1)
    : criterionId;
}

/** Kebab-lowercase slug, filesystem/label-safe. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Stable fingerprint of a rendered body — mirrors publish.ts. */
export function regressionContentFingerprint(summary: string, description: string): string {
  return crypto
    .createHash('sha256')
    .update(summary)
    .update(' ')
    .update(description)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Read a stored fingerprint from an issue description, or `null` when absent.
 * The fingerprint travels as `<!-- specship:regfp:<hex> -->` on its own line.
 */
export function readStoredFingerprint(description: string | undefined | null): string | null {
  if (!description) return null;
  const m = /<!--\s*specship:regfp:([a-f0-9]{6,32})\s*-->/i.exec(description);
  return m && m[1] ? m[1] : null;
}

function fingerprintTag(fp: string): string {
  return `<!-- specship:regfp:${fp} -->`;
}

/** Strip a trailing `<!-- specship:regfp:... -->` tag (and its blank line) if present. */
function stripFingerprintTag(description: string): string {
  return description.replace(/\n*<!--\s*specship:regfp:[a-f0-9]+\s*-->\s*$/i, '');
}

/**
 * Derive a case's tier from the requirement's behaviour surface
 * (REQ-JIRAREG-004.A2). Delegates the UI/backend split to
 * {@link computeBehaviourSurface} so the classification stays consistent
 * with `/ss-behaviour`. A requirement with no linked nodes (or a
 * fixture-mode sq without graph accessors) resolves to `'backend'` —
 * never spurious UI.
 */
export function deriveCaseTier(req: Spec, sq: BuilderSpecQueries): 'ui' | 'backend' {
  const linked = sq.getLinkedNodesForReq?.(req.id) ?? [];
  if (linked.length === 0) return 'backend';
  const neighbours = sq.getNeighbourNodes?.(linked.map((n) => n.id)) ?? [];
  const surface = computeBehaviourSurface({
    requirementId: req.id,
    requirementExists: true,
    linkedNodes: linked,
    neighbourNodes: neighbours,
  });
  return surface.ui.length > 0 ? 'ui' : 'backend';
}

/**
 * Classify a criterion body for A3: does it name an observable outcome, and
 * does it stay in black-box vocabulary? Two failure modes both flag the case
 * for human rephrase (never silently vague, never leaking file paths /
 * symbols into the pack):
 *
 * 1. **Vague** — no observable verb ("returns", "renders", "MUST", …) and
 *    no reference to a concrete artefact ("response", "row", …).
 * 2. **Code-shaped** — the text names a file path (`src/…`), a `.ts` / `.tsx`
 *    / `.js` / `.jsx` extension, or a backticked identifier
 *    (CamelCase / snake_case). Black-box cases must not echo white-box
 *    detail; the flag drives a rephrase pass.
 *
 * Deterministic and cheap on purpose — the goal is surfacing the flags,
 * not scoring prose.
 */
export function classifyCriterion(text: string): { observable: boolean; reason?: string } {
  const t = text.trim();
  if (!t) return { observable: false, reason: 'empty criterion text' };
  // Code-shape check runs first: a criterion may name an observable outcome
  // AND still leak code detail — the leak is the tighter constraint.
  if (
    /(^|[\s(`'"])src\//.test(t) ||
    /\.(tsx?|jsx?|py|rb|go|rs|java|kt|swift|cs|php|css|scss|md|yml|yaml|json|sql)\b/i.test(t) ||
    /`[A-Za-z_][A-Za-z0-9_]*`/.test(t) ||
    /`[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+`/.test(t)
  ) {
    return { observable: true, reason: 'criterion text contains code references' };
  }
  const observable =
    /\b(MUST|SHOULD|shows?|displays?|renders?|returns?|responds?|emits?|creates?|updates?|deletes?|rejects?|accepts?|produces?|writes?|reads?|receives?|surfaces?|logs?|records?|sends?|opens?|closes?|starts?|stops?|fails?|succeeds?|passes?|blocks?|allows?|prevents?|prompts?|matches?|contains?|equals?|includes?|excludes?)\b/i.test(t) ||
    /\b(response|request|message|row|file|status|code|body|header|payload|value|count|list|table|error|log|output|result|screen|button|link|form|field|dialog|banner|toast|page|route|endpoint)\b/i.test(t);
  if (!observable) return { observable: false, reason: 'no observable outcome in criterion text' };
  return { observable: true };
}

/**
 * Render the executable steps + reference section for a case
 * (REQ-JIRAREG-001.A3, REQ-JIRAREG-004.A1). Black-box body: Steps carry no
 * file paths, no code symbols, and no `- Spec:` pointer — those are
 * white-box detail belonging on the source spec, not on the tester's
 * checklist. The tier lands as a header line (readable) AND as a JIRA label
 * on the issue (board-filterable, see {@link tierLabel}).
 */
export function renderCaseSteps(rc: RegressionCase): string {
  const lines: string[] = [];
  lines.push(REG_PACK_CASE_WATERMARK);
  lines.push('');
  lines.push(`Tier: ${rc.tier}`);
  lines.push('');
  lines.push('Steps:');
  lines.push('- Given the feature is available in a bound test environment');
  lines.push(`- When the tester exercises the behaviour: ${oneLineTrim(rc.criterionText)}`);
  lines.push('- Then the observable outcome MUST match the criterion above');
  lines.push('');
  lines.push('Reference:');
  lines.push(`- Source: ${rc.reqId}.${criterionSuffix(rc.reqId, rc.criterionId)} — ${oneLineTrim(rc.criterionText)}`);
  lines.push(`- Domain: ${rc.domainArea}`);
  if (rc.areasAll.length > 1) {
    lines.push(`- Also files under: ${rc.areasAll.filter((a) => a !== rc.domainArea).join(', ')}`);
  }
  if (rc.needsRephrase && rc.rephraseReason) {
    lines.push(`- Needs rephrase: ${rc.rephraseReason}`);
  }
  return lines.join('\n');
}

/**
 * Render a cross-reference sub-task body (REQ-JIRAREG-002.A1). Same source
 * id, no duplicate steps — just a pointer at the executable sibling so a
 * tester scanning this area finds it. The label is separate so the same
 * criterion produces one issue per area, and a re-run stays idempotent.
 */
export function renderCrossReferenceBody(
  rc: RegressionCase,
  executableAreaLabel: string,
): string {
  const lines: string[] = [];
  lines.push(REG_PACK_CASE_WATERMARK);
  lines.push('');
  lines.push(`Tier: ${rc.tier}`);
  lines.push('');
  lines.push(
    `This is a cross-reference. The executable case for ${rc.reqId}.${criterionSuffix(rc.reqId, rc.criterionId)} lives under the "${executableAreaLabel}" area — run it there.`,
  );
  lines.push('');
  lines.push('Reference:');
  lines.push(`- Source: ${rc.reqId}.${criterionSuffix(rc.reqId, rc.criterionId)} — ${oneLineTrim(rc.criterionText)}`);
  lines.push(`- Executable area: ${executableAreaLabel}`);
  lines.push(`- Cross-referenced here as: ${rc.domainArea}`);
  return lines.join('\n');
}

function renderStoryDescription(area: string, caseCount: number): string {
  return [
    REG_PACK_STORY_WATERMARK,
    '',
    `Regression cases for the "${area}" domain area.`,
    `${caseCount} case${caseCount === 1 ? '' : 's'} attached as Sub-tasks.`,
  ].join('\n');
}

function renderEpicDescription(totals: {
  stories: number;
  cases: number;
  domainGaps: number;
}): string {
  const lines = [
    REG_PACK_EPIC_WATERMARK,
    '',
    'SpecShip Regression Pack.',
    `${totals.stories} domain area${totals.stories === 1 ? '' : 's'}, ` +
      `${totals.cases} case${totals.cases === 1 ? '' : 's'}.`,
  ];
  if (totals.domainGaps > 0) {
    lines.push(
      `${totals.domainGaps} requirement${totals.domainGaps === 1 ? '' : 's'} filed under Uncategorised — capture the missing domain fact(s) with /specship:spec domain (REQ-JIRAREG-002.A2).`,
    );
  }
  lines.push(
    '',
    'Each Sub-task under a domain-area Story is derived from one acceptance ' +
      'criterion of an implemented (or verified) requirement. Human testers ' +
      'can execute the cases directly; the agent can record run results (see ' +
      'REQ-JIRAREG-005). Re-generating the pack is idempotent — a criterion ' +
      'that has not changed produces zero JIRA writes.',
  );
  return lines.join('\n');
}

/**
 * Render the domain-gap report the caller prints after upsert
 * (REQ-JIRAREG-002.A2). Empty when there are no gaps.
 */
/**
 * Render the rephrase report (REQ-JIRAREG-004.A3). Empty when zero flags —
 * the caller conditionally prints it after the pack upsert, mirroring the
 * domain-gap report shape.
 */
export function renderRephraseReport(flags: RephraseFlag[]): string {
  if (flags.length === 0) return '';
  const lines: string[] = [];
  lines.push(
    `Criteria needing rephrase — ${flags.length} criterion${flags.length === 1 ? '' : 'a'} flagged (REQ-JIRAREG-004.A3):`,
  );
  for (const f of flags) lines.push(`  · ${f.criterionId} (${f.specPath}): ${f.reason}`);
  lines.push(
    'Rewrite the criterion body in black-box terms (name the observable outcome, drop file paths / symbols) and re-run the pack; the case updates in place.',
  );
  return lines.join('\n');
}

export function renderDomainGapReport(gaps: DomainGap[]): string {
  if (gaps.length === 0) return '';
  const lines: string[] = [];
  lines.push(
    `Domain gaps — ${gaps.length} requirement${gaps.length === 1 ? '' : 's'} filed under Uncategorised (REQ-JIRAREG-002.A2):`,
  );
  for (const g of gaps) lines.push(`  · ${g.reqId} — ${g.specPath}`);
  lines.push(
    'Capture the missing domain fact(s) with `/specship:spec domain` and re-run the pack; the next update moves the affected cases into their new area without duplicating them.',
  );
  return lines.join('\n');
}

/**
 * Compute the domain areas each requirement inherits transitively, keyed on
 * requirement id (REQ-JIRAREG-002.A1).
 *
 * Direction: domain facts declare `depends_on: REQ-...` (they point AT
 * requirements, per DOMAIN-KNOWLEDGE-DOC), so a requirement's own spec-tier
 * chain does NOT reach the domain facts that govern it. We walk in the
 * OTHER direction — for each `domain` spec, follow its parent /
 * `metadata.depends_on` chain outward and register that domain fact against
 * every requirement it reaches.
 *
 * This mirrors {@link SpecLinkResolver.getInheritedLinks} — same BFS, same
 * `sourceSpecIds` traversal, same depth cap ({@link INHERITED_LINK_MAX_DEPTH}).
 * `sourceSpecIds` is imported from the resolver (single source of truth for
 * "the spec-tier edges a spec has"), but the walk itself is reproduced here
 * to keep the regression-pack module free of a `SpecLinkResolver` dependency
 * (which would require threading `QueryBuilder` all the way through). Per the
 * approval note, the mirror is deliberate; `BuilderSpecQueries` exposes only
 * the point-lookup surface it needs (`getAllSpecs`, `getSpecById`) so the
 * builder stays trivially fixture-able.
 *
 * Per-domain-fact BFS is cycle-guarded and depth-capped. Ordering of the
 * output list is deterministic: domain spec ids sorted lex, deduped.
 */
export function computeDomainAreasByReqId(
  sq: BuilderSpecQueries,
): Map<string, Spec[]> {
  const out = new Map<string, Spec[]>();
  const seenPairs = new Set<string>(); // `${reqId}\0${domainId}`
  const domainFacts = sq
    .getAllSpecs()
    .filter((s) => s.kind === 'domain')
    // Deterministic outer order — matters for the primary-area pick.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const fact of domainFacts) {
    // BFS from the fact outward through parent / depends_on. Mirrors
    // SpecLinkResolver.getInheritedLinks; visited-set = string ids (we may
    // not resolve every hop to an indexed Spec).
    const visited = new Set<string>([fact.id]);
    const queue: Array<{ id: string; depth: number }> = sourceSpecIds(fact).map(
      (id) => ({ id, depth: 1 }),
    );
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const src = sq.getSpecById(id);
      if (!src) continue; // gap (unresolved id) — silently skip; not our concern
      if (src.kind === 'requirement') {
        const pairKey = `${src.id} ${fact.id}`;
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          const bucket = out.get(src.id);
          if (bucket) bucket.push(fact);
          else out.set(src.id, [fact]);
        }
        // Continue walking — a domain fact that reaches a requirement AND its
        // parent document still covers both; the requirement is the interesting
        // hit for the pack, but we don't prune.
      }
      if (depth < INHERITED_LINK_MAX_DEPTH) {
        for (const nextId of sourceSpecIds(src)) {
          if (!visited.has(nextId)) queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }
  }

  // Post-sort each bucket by domain spec id — the executable case picks
  // buckets[0], and IDs are stable across renames (unlike titles).
  for (const [reqId, facts] of out) {
    out.set(
      reqId,
      [...facts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    );
  }
  return out;
}

/**
 * Group cases by their pre-computed `domainArea`. In REQ-JIRAREG-001 every
 * case was `Uncategorised`; REQ-JIRAREG-002 fills in real domain-fact areas
 * — same input shape, same output shape, richer bucketing.
 */
export function groupCasesByDomain(
  cases: RegressionCase[],
): Map<string, RegressionCase[]> {
  const out = new Map<string, RegressionCase[]>();
  for (const rc of cases) {
    const bucket = out.get(rc.domainArea);
    if (bucket) bucket.push(rc);
    else out.set(rc.domainArea, [rc]);
  }
  return out;
}

/**
 * Build a full regression pack plan from the loaded spec set (REQ-JIRAREG-001).
 * Pure — no JIRA calls. Deterministic ordering: requirements sorted by id,
 * criteria in the order they appear as `acceptance` children of the requirement.
 */
export function buildRegressionPack(
  sq: BuilderSpecQueries,
): RegressionPackModel {
  const all = sq.getAllSpecs();
  const requirements = all
    .filter((s) => s.kind === 'requirement')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Precompute inverse map: which domain facts each requirement inherits.
  // Ordering inside each list is stable-by-id so the "first area" pick below
  // is deterministic across runs.
  const domainAreasByReq = computeDomainAreasByReqId(sq);

  const cases: RegressionCase[] = [];
  const domainGaps: DomainGap[] = [];
  const rephraseFlags: RephraseFlag[] = [];
  for (const req of requirements) {
    if (!isRequirementImplementedPlus(sq, req.id)) continue;
    const criteria = sq
      .getSpecsByParent(req.id)
      .filter((c) => c.kind === 'acceptance')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (criteria.length === 0) continue;

    const domainFacts = domainAreasByReq.get(req.id) ?? [];
    const areaTitles: string[] =
      domainFacts.length === 0
        ? [UNCATEGORISED_AREA]
        : domainFacts.map((f) => f.title || f.id);
    const primaryArea = areaTitles[0]!;
    if (domainFacts.length === 0) {
      // Once per requirement — A2 lists the REQ, not each criterion.
      domainGaps.push({ reqId: req.id, specPath: req.sourcePath });
    }
    // Tier derived once per requirement (REQ-JIRAREG-004.A2): both executable
    // and cross-ref rows for the same criterion carry the same tier.
    const tier = deriveCaseTier(req, sq);

    for (const c of criteria) {
      const text = (c.title || c.body || '').trim();
      if (!text) continue;
      const cls = classifyCriterion(text);
      const needsRephrase = !cls.observable || Boolean(cls.reason);
      if (needsRephrase && cls.reason) {
        rephraseFlags.push({
          criterionId: c.id,
          specPath: req.sourcePath,
          reason: cls.reason,
        });
      }
      const base: Pick<
        RegressionCase,
        'reqId' | 'criterionId' | 'criterionText' | 'specPath' | 'tier' | 'areasAll' | 'needsRephrase' | 'rephraseReason'
      > = {
        reqId: req.id,
        criterionId: c.id,
        criterionText: text,
        specPath: req.sourcePath,
        tier,
        areasAll: areaTitles,
        ...(needsRephrase
          ? { needsRephrase: true, rephraseReason: cls.reason ?? 'unspecified' }
          : {}),
      };
      // Executable case in the primary area.
      cases.push({ ...base, domainArea: primaryArea, kind: 'executable' });
      // Cross-references in every additional area.
      for (const extra of areaTitles.slice(1)) {
        cases.push({
          ...base,
          domainArea: extra,
          kind: 'crossref',
          crossReferenceOf: c.id,
        });
      }
    }
  }

  const grouped = groupCasesByDomain(cases);
  const stories: StoryPlan[] = [];
  const casePlans: CasePlan[] = [];
  // Iterate areas in deterministic order — the map preserves insertion order,
  // but a domain fact never inserted (all-crossref) shouldn't matter. Sort by
  // area title so re-runs render stories in the same order regardless of
  // requirement iteration order.
  const areasSorted = [...grouped.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const area of areasSorted) {
    const group = grouped.get(area)!;
    const areaLabel = `${REG_PACK_DOMAIN_LABEL_PREFIX}${slugify(area)}`;
    const areaCases: CasePlan[] = [];
    for (const rc of group) {
      const suffix = criterionSuffix(rc.reqId, rc.criterionId);
      const isXref = rc.kind === 'crossref';
      const label = isXref
        ? `${REG_PACK_XREF_LABEL_PREFIX}${slugify(rc.reqId)}-${slugify(suffix)}-${slugify(area)}`
        : `${REG_PACK_CASE_LABEL_PREFIX}${slugify(rc.reqId)}-${slugify(suffix)}`;
      const summary = isXref
        ? oneLineTrim(`${rc.reqId}.${suffix} (xref: ${area}) — ${rc.criterionText}`)
        : oneLineTrim(`${rc.reqId}.${suffix} — ${rc.criterionText}`);
      const body = isXref
        ? renderCrossReferenceBody(rc, rc.areasAll[0]!)
        : renderCaseSteps(rc);
      const fp = regressionContentFingerprint(summary, body);
      const description = `${body}\n\n${fingerprintTag(fp)}`;
      areaCases.push({
        reqId: rc.reqId,
        criterionId: rc.criterionId,
        summary,
        description,
        label,
        specPath: rc.specPath,
        kind: rc.kind,
        tierLabel: tierLabel(rc.tier),
      });
    }
    const storySummary = oneLineTrim(`Regression: ${area}`);
    const storyDesc = renderStoryDescription(area, areaCases.length);
    const storyFp = regressionContentFingerprint(storySummary, storyDesc);
    stories.push({
      domainArea: area,
      summary: storySummary,
      description: `${storyDesc}\n\n${fingerprintTag(storyFp)}`,
      label: areaLabel,
      cases: areaCases,
    });
    casePlans.push(...areaCases);
  }

  const epicSummary = oneLineTrim('SpecShip Regression Pack');
  const epicDesc = renderEpicDescription({
    stories: stories.length,
    cases: casePlans.length,
    domainGaps: domainGaps.length,
  });
  const epicFp = regressionContentFingerprint(epicSummary, epicDesc);
  const epic: EpicPlan = {
    summary: epicSummary,
    description: `${epicDesc}\n\n${fingerprintTag(epicFp)}`,
    label: REG_PACK_EPIC_LABEL,
  };

  return { epic, stories, cases: casePlans, domainGaps, rephraseFlags };
}

// ---------------------------------------------------------------------------
// Upsert (JIRA)
// ---------------------------------------------------------------------------

/** Structural client slice — just enough to run the upsert idempotently. */
export interface RegressionPackJiraClient {
  /**
   * Return every issue in `projectKey` that carries `label`. Empty list on no
   * match. Called with SpecShip's own labels — `specship-regression-pack`,
   * `specship-regdomain-<slug>`, `specship-regcase-<slug>` — never user input.
   */
  searchIssuesByLabel(
    projectKey: string,
    label: string,
  ): Promise<Array<{ key: string; summary: string }>>;
  /**
   * Fetch a single issue's summary + description + current parent key — for
   * fingerprint compare AND parent-reassignment no-op decision
   * (REQ-JIRAREG-002.A3). `parentKey` MAY be `undefined` when the issue has
   * no parent (a top-level issue or one JIRA didn't return a parent for).
   */
  getIssue(
    key: string,
  ): Promise<{
    ok: true;
    issue: {
      key: string;
      summary: string;
      description: string;
      parentKey?: string;
    };
  }>;
  createIssue(fields: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    parentKey?: string;
    labels?: string[];
  }): Promise<{ key: string; id: string }>;
  /**
   * Update an issue's summary, description, and/or parent (REQ-JIRAREG-002.A3
   * needs parent reassignment when a case moves from Uncategorised to its new
   * area). Callers pass only the fields that changed — a plain `parentKey`
   * change with no body drift lands a `{ fields: { parent: { key } } }` PUT.
   */
  updateIssue(
    key: string,
    fields: { summary?: string; description?: string; parentKey?: string },
  ): Promise<void>;
  /**
   * Enumerate an issue's comments with ids (REQ-JIRAREG-003.A3). Used by the
   * obsolete-marker upsert to check for a prior marker before writing.
   */
  listCommentsDetailed(
    key: string,
  ): Promise<Array<{ id: string; body: string }>>;
  /** Append a comment to an issue (REQ-JIRAREG-003.A3). */
  addComment(key: string, body: string): Promise<{ id: string } | void>;
  /**
   * Add a label to an issue idempotently (REQ-JIRAREG-003.A3 + A4). Returns
   * `{ added: false }` when the label is already present so a re-run is a
   * zero-write. Implementations MUST NOT issue a PUT when the label is set.
   */
  addLabel(key: string, label: string): Promise<{ added: boolean }>;
}

interface UpsertOutcome {
  key: string;
  action: 'created' | 'updated' | 'skipped';
}

/**
 * Find an existing SpecShip-owned issue by label — or create a fresh one and
 * seed the fingerprint-gated body. When multiple labelled matches exist the
 * OLDEST-lex (`key` sort) is picked as canonical; the rest are returned as
 * orphans (single-canonical invariant, REQ-JIRAREG-001.A1).
 */
async function upsertLabelledIssue(
  client: RegressionPackJiraClient,
  ctx: UpsertContext,
  label: string,
  issueType: string,
  summary: string,
  description: string,
  parentKey: string | undefined,
  extraLabels: string[] = [],
): Promise<{ outcome: UpsertOutcome; orphans: string[] }> {
  const matches = await client.searchIssuesByLabel(ctx.projectKey, label);
  const sorted = [...matches].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const canonical = sorted[0];
  const orphans = sorted.slice(1).map((m) => m.key);

  if (canonical) {
    // Fingerprint the WITHOUT-TAG body so a re-run compares apples-to-apples
    // with the tag we previously stored (the tag itself is derived from the
    // pre-tag content and would otherwise self-invalidate on rehash).
    const newFp = regressionContentFingerprint(summary, stripFingerprintTag(description));
    const detail = await client.getIssue(canonical.key);
    const storedFp = readStoredFingerprint(detail.issue.description);
    // Parent reassignment (REQ-JIRAREG-002.A3): a case can move areas without
    // any body drift when its requirement gains a domain fact. We detect the
    // move by comparing stored parent vs desired; only writes when they differ.
    const storedParent = detail.issue.parentKey;
    const parentChanged = parentKey !== undefined && storedParent !== parentKey;
    if (storedFp === newFp && !parentChanged) {
      // Backfill any missing extra labels on a canonical issue that pre-dates
      // them (REQ-JIRAREG-003 marker label rollout). `addLabel` is idempotent —
      // a no-op when already set, so a re-run stays zero-write.
      if (!ctx.dryRun) {
        for (const extra of extraLabels) {
          await client.addLabel(canonical.key, extra);
        }
      }
      return { outcome: { key: canonical.key, action: 'skipped' }, orphans };
    }
    if (!ctx.dryRun) {
      const patch: { summary?: string; description?: string; parentKey?: string } = {};
      if (storedFp !== newFp) {
        patch.summary = summary;
        patch.description = description;
      }
      if (parentChanged) patch.parentKey = parentKey!;
      await client.updateIssue(canonical.key, patch);
      for (const extra of extraLabels) {
        await client.addLabel(canonical.key, extra);
      }
    }
    return { outcome: { key: canonical.key, action: 'updated' }, orphans };
  }

  if (ctx.dryRun) {
    // Synthesize a placeholder key so downstream planning has something to
    // reference; no writes performed.
    return {
      outcome: { key: `DRYRUN-${label}`, action: 'created' },
      orphans,
    };
  }
  const created = await client.createIssue({
    projectKey: ctx.projectKey,
    issueType,
    summary,
    description,
    labels: [label, ...extraLabels],
    ...(parentKey ? { parentKey } : {}),
  });
  return { outcome: { key: created.key, action: 'created' }, orphans };
}

/**
 * Idempotent regression-pack upsert (REQ-JIRAREG-001, REQ-JIRAREG-003 skeleton).
 * Walks the model epic → story → case; each level is keyed on its SpecShip
 * label and its body is fingerprint-gated so a re-run without spec changes
 * writes nothing new. Extra epics under the pack label are refused (single-epic
 * invariant, A1) and reported as orphans; the caller decides how to surface.
 */
export async function upsertRegressionPack(
  client: RegressionPackJiraClient,
  model: RegressionPackModel,
  ctx: UpsertContext,
): Promise<UpsertResult> {
  const epicType = ctx.epicIssueType ?? 'Epic';
  const storyType = ctx.storyIssueType ?? 'Story';
  const caseType = ctx.caseIssueType ?? 'Sub-task';

  const epicRes = await upsertLabelledIssue(
    client,
    ctx,
    model.epic.label,
    epicType,
    model.epic.summary,
    model.epic.description,
    undefined,
  );

  let storiesCreated = 0;
  let storiesUpdated = 0;
  let storiesSkipped = 0;
  let casesCreated = 0;
  let casesUpdated = 0;
  let casesSkipped = 0;
  let crossRefsCreated = 0;
  let crossRefsUpdated = 0;
  let crossRefsSkipped = 0;
  const caseKeysByCriterion: Record<string, string> = {};
  const crossRefKeys: string[] = [];

  for (const story of model.stories) {
    const storyRes = await upsertLabelledIssue(
      client,
      ctx,
      story.label,
      storyType,
      story.summary,
      story.description,
      epicRes.outcome.key,
    );
    if (storyRes.outcome.action === 'created') storiesCreated++;
    else if (storyRes.outcome.action === 'updated') storiesUpdated++;
    else storiesSkipped++;

    for (const c of story.cases) {
      const caseRes = await upsertLabelledIssue(
        client,
        ctx,
        c.label,
        caseType,
        c.summary,
        c.description,
        storyRes.outcome.key,
        [REG_PACK_CASE_MARKER_LABEL, c.tierLabel],
      );
      if (c.kind === 'crossref') {
        if (caseRes.outcome.action === 'created') crossRefsCreated++;
        else if (caseRes.outcome.action === 'updated') crossRefsUpdated++;
        else crossRefsSkipped++;
        crossRefKeys.push(caseRes.outcome.key);
      } else {
        if (caseRes.outcome.action === 'created') casesCreated++;
        else if (caseRes.outcome.action === 'updated') casesUpdated++;
        else casesSkipped++;
        // The executable case's key is the traceability anchor. Cross-refs
        // deliberately do NOT overwrite this — the spec-side back-link is
        // one criterion → one canonical case key (the executable one).
        caseKeysByCriterion[c.criterionId] = caseRes.outcome.key;
      }
    }
  }

  // Reconcile orphaned cases (REQ-JIRAREG-003.A3). Query every case in the
  // pack via the fixed marker label — the epic and area stories never carry
  // it, so this scan touches only cases. Any case whose key is not in the
  // just-upserted set belongs to a criterion that no longer exists in the
  // spec set (removed or superseded) → mark obsolete. Never deleted; run
  // history stays intact.
  const obsoletedCaseKeys: string[] = [];
  let casesObsoleted = 0;
  if (!ctx.dryRun) {
    // Both executable and cross-ref sub-tasks carry the case marker label, so
    // both must be in `expected` — otherwise a live cross-ref would trip the
    // obsolete scan every run (`caseKeysByCriterion` records only executables).
    const expected = new Set<string>(Object.values(caseKeysByCriterion));
    for (const k of crossRefKeys) expected.add(k);
    const orphans = await findOrphanedCases(client, ctx.projectKey, expected);
    for (const orphan of orphans) {
      const outcome = await markCaseObsolete(client, orphan.key, 'removed');
      if (outcome.action === 'obsoleted') {
        casesObsoleted++;
        obsoletedCaseKeys.push(orphan.key);
      }
    }
  }

  return {
    epicKey: epicRes.outcome.key,
    epicCreated: epicRes.outcome.action === 'created',
    storiesCreated,
    storiesUpdated,
    storiesSkipped,
    casesCreated,
    casesUpdated,
    casesSkipped,
    crossRefsCreated,
    crossRefsUpdated,
    crossRefsSkipped,
    casesObsoleted,
    obsoletedCaseKeys,
    orphanedEpicKeys: epicRes.orphans,
    caseKeysByCriterion,
  };
}

// ---------------------------------------------------------------------------
// Obsolete reconciliation (REQ-JIRAREG-003.A3)
// ---------------------------------------------------------------------------

/**
 * Enumerate case issues in the pack (via the fixed case marker label) that are
 * not in `expectedKeys` — the caller's set of case keys just upserted from the
 * current model. The result is deterministic (sorted lex on key) so re-runs
 * report obsolete work in the same order.
 */
export async function findOrphanedCases(
  client: RegressionPackJiraClient,
  projectKey: string,
  expectedKeys: Set<string>,
): Promise<Array<{ key: string; summary: string }>> {
  const all = await client.searchIssuesByLabel(projectKey, REG_PACK_CASE_MARKER_LABEL);
  return all
    .filter((i) => !expectedKeys.has(i.key))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export type MarkObsoleteOutcome =
  | { action: 'obsoleted'; commentAdded: boolean; labelAdded: boolean }
  | { action: 'skipped' };

/**
 * Mark a case obsolete on JIRA (REQ-JIRAREG-003.A3): attach a stable
 * watermarked comment naming the reason AND add the board-filterable
 * `specship-reg-obsolete` label. Both writes are idempotent — a re-run with
 * the same reason finds the prior marker and adds nothing (A4).
 *
 * Never transitions the issue's workflow status (spec-driven correction:
 * "no workflow transitions by default") and never deletes it — the run
 * history and any prior evidence stay intact.
 */
export async function markCaseObsolete(
  client: RegressionPackJiraClient,
  issueKey: string,
  reason: string,
): Promise<MarkObsoleteOutcome> {
  const watermark = obsoleteWatermark(reason);
  const comments = await client.listCommentsDetailed(issueKey);
  const hasMarker = comments.some((c) => c.body.startsWith(watermark));

  const labelRes = await client.addLabel(issueKey, REG_PACK_OBSOLETE_LABEL);

  if (hasMarker) {
    // Idempotency: the comment marker is the source-of-truth signal that
    // this case has already been marked obsolete for `reason`. A label-only
    // add (backfill) does not count as a fresh obsoletion — the previous
    // run already recorded it.
    return { action: 'skipped' };
  }

  const body = [
    watermark,
    '',
    `This regression case is obsolete: ${reason}.`,
    `Marked ${new Date().toISOString()}.`,
    'The issue is preserved so past run history stays intact; the pack ' +
      'will no longer regenerate it.',
  ].join('\n');
  await client.addComment(issueKey, body);
  return { action: 'obsoleted', commentAdded: true, labelAdded: labelRes.added };
}

// ---------------------------------------------------------------------------
// Run-result recorder — STUB (full body lands in REQ-JIRAREG-005).
// ---------------------------------------------------------------------------

export interface RegressionRunResult {
  caseKey: string;
  verdict: 'passed' | 'failed' | 'skipped';
  evidenceUrl?: string;
}

/**
 * Record a pack-run result on a case issue. REQ-JIRAREG-001 keeps this a thin
 * stub — the full behaviour (watermarked comment upsert + `validates`-link
 * feedback into the graph) is REQ-JIRAREG-005's contract. Returns the intended
 * summary line so callers can preview.
 */
export function recordRunResult(
  _client: unknown,
  result: RegressionRunResult,
): { pending: true; summary: string } {
  const parts = [`${result.caseKey}: ${result.verdict}`];
  if (result.evidenceUrl) parts.push(result.evidenceUrl);
  return {
    pending: true,
    summary: parts.join(' — ') + ' (REQ-JIRAREG-005 will land the full recorder)',
  };
}
