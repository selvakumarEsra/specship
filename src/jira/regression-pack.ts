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
import type { Spec, SpecLink } from '../types';

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
  /** Behaviour tier — placeholder in 001, refined in REQ-JIRAREG-004. */
  tier: 'ui' | 'backend' | 'unknown';
  /**
   * Domain area label. Always `'Uncategorised'` in REQ-JIRAREG-001 —
   * REQ-JIRAREG-002 assigns real domain areas from linked domain facts.
   */
  domainArea: string;
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
}

export interface RegressionPackModel {
  epic: EpicPlan;
  stories: StoryPlan[];
  cases: CasePlan[];
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
 * Render the executable steps + reference section for a case (REQ-JIRAREG-001.A3).
 * A Given/When/Then scaffold is emitted; REQ-JIRAREG-004 will refine phrasing.
 */
export function renderCaseSteps(rc: RegressionCase): string {
  const lines: string[] = [];
  lines.push(REG_PACK_CASE_WATERMARK);
  lines.push('');
  lines.push('Steps:');
  lines.push('- Given the feature is available in a bound test environment');
  lines.push(`- When the tester exercises the behaviour: ${oneLineTrim(rc.criterionText)}`);
  lines.push('- Then the observable outcome MUST match the criterion above');
  lines.push('');
  lines.push('Reference:');
  lines.push(`- Source: ${rc.reqId}.${criterionSuffix(rc.reqId, rc.criterionId)} — ${oneLineTrim(rc.criterionText)}`);
  lines.push(`- Spec: ${rc.specPath}`);
  lines.push(`- Tier: ${rc.tier}`);
  lines.push(`- Domain: ${rc.domainArea}`);
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

function renderEpicDescription(totals: { stories: number; cases: number }): string {
  return [
    REG_PACK_EPIC_WATERMARK,
    '',
    'SpecShip Regression Pack.',
    `${totals.stories} domain area${totals.stories === 1 ? '' : 's'}, ` +
      `${totals.cases} case${totals.cases === 1 ? '' : 's'}.`,
    '',
    'Each Sub-task under a domain-area Story is derived from one acceptance ' +
      'criterion of an implemented (or verified) requirement. Human testers ' +
      'can execute the cases directly; the agent can record run results (see ' +
      'REQ-JIRAREG-005). Re-generating the pack is idempotent — a criterion ' +
      'that has not changed produces zero JIRA writes.',
  ].join('\n');
}

/**
 * Group cases by their pre-computed `domainArea`. In REQ-JIRAREG-001 every
 * case is `Uncategorised`, so this is a trivial passthrough. REQ-JIRAREG-002
 * will fold in domain-fact-derived areas — same input shape, same output
 * shape, richer bucketing.
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

  const cases: RegressionCase[] = [];
  for (const req of requirements) {
    if (!isRequirementImplementedPlus(sq, req.id)) continue;
    const criteria = sq
      .getSpecsByParent(req.id)
      .filter((c) => c.kind === 'acceptance')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const c of criteria) {
      const text = (c.title || c.body || '').trim();
      if (!text) continue;
      cases.push({
        reqId: req.id,
        criterionId: c.id,
        criterionText: text,
        specPath: req.sourcePath,
        tier: 'unknown', // REQ-JIRAREG-004 refines
        domainArea: UNCATEGORISED_AREA, // REQ-JIRAREG-002 refines
      });
    }
  }

  const grouped = groupCasesByDomain(cases);
  const stories: StoryPlan[] = [];
  const casePlans: CasePlan[] = [];
  for (const [area, group] of grouped) {
    const areaCases: CasePlan[] = [];
    for (const rc of group) {
      const suffix = criterionSuffix(rc.reqId, rc.criterionId);
      const label = `${REG_PACK_CASE_LABEL_PREFIX}${slugify(rc.reqId)}-${slugify(suffix)}`;
      const summary = oneLineTrim(`${rc.reqId}.${suffix} — ${rc.criterionText}`);
      const body = renderCaseSteps(rc);
      const fp = regressionContentFingerprint(summary, body);
      const description = `${body}\n\n${fingerprintTag(fp)}`;
      areaCases.push({
        reqId: rc.reqId,
        criterionId: rc.criterionId,
        summary,
        description,
        label,
        specPath: rc.specPath,
      });
    }
    const areaLabel = `${REG_PACK_DOMAIN_LABEL_PREFIX}${slugify(area)}`;
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
  });
  const epicFp = regressionContentFingerprint(epicSummary, epicDesc);
  const epic: EpicPlan = {
    summary: epicSummary,
    description: `${epicDesc}\n\n${fingerprintTag(epicFp)}`,
    label: REG_PACK_EPIC_LABEL,
  };

  return { epic, stories, cases: casePlans };
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
  /** Fetch a single issue's summary + description — for fingerprint compare. */
  getIssue(
    key: string,
  ): Promise<{ ok: true; issue: { key: string; summary: string; description: string } }>;
  createIssue(fields: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    parentKey?: string;
    labels?: string[];
  }): Promise<{ key: string; id: string }>;
  updateIssue(
    key: string,
    fields: { summary?: string; description?: string },
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
    if (storedFp === newFp) {
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
      await client.updateIssue(canonical.key, { summary, description });
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
  const caseKeysByCriterion: Record<string, string> = {};

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
        [REG_PACK_CASE_MARKER_LABEL],
      );
      if (caseRes.outcome.action === 'created') casesCreated++;
      else if (caseRes.outcome.action === 'updated') casesUpdated++;
      else casesSkipped++;
      caseKeysByCriterion[c.criterionId] = caseRes.outcome.key;
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
    const expected = new Set(Object.values(caseKeysByCriterion));
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
