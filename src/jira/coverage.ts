/**
 * Sprint coverage report (REQ-JIRATEAM-004).
 *
 * Joins the bound project's active (or named) sprint issues to spec truth:
 * each JIRA issue lists whether a spec exists, and — when it does — the
 * rolled-up state of its spec→code links (using the existing spec-link state
 * machine, never a new one).
 *
 * Pure builder: it takes an injectable JIRA read client and a spec-queries
 * slice; it never mutates JIRA. Posting is done by the caller via
 * `upsertWatermarkedComment` (REQ-JIRATEAM-004.A3/A4).
 */

import type { JiraIssueListResult } from './types';
import type { SpecLinkState } from '../types';
import type { PublishedSpecRef } from './published-specs';
import { enumeratePublishedSpecs } from './published-specs';

/**
 * The per-issue rolled-up state a coverage row carries. Named to be
 * self-explanatory in the rendered table; derived from the spec-link states
 * on the requirement (and its acceptance children).
 */
export type CoverageState =
  | 'unspecced'
  | 'specced'
  | 'implemented'
  | 'verified'
  | 'drifted'
  | 'broken';

/** One row of the coverage report — one JIRA sprint issue. */
export interface CoverageRow {
  issueKey: string;
  title: string;
  jiraStatus: string;
  specRelPath?: string;
  state: CoverageState;
}

/** Rollup counts closing the report (REQ-JIRATEAM-004.A1). */
export interface CoverageRollup {
  total: number;
  unspecced: number;
  specced: number;
  implemented: number;
  verified: number;
  drifted: number;
  broken: number;
}

export interface CoverageReport {
  /** The sprint label — either the explicit name or "active sprint(s)". */
  sprintLabel: string;
  rows: CoverageRow[];
  rollup: CoverageRollup;
}

/** Read-only slice of `JiraClient` the coverage builder consumes. */
export interface CoverageJiraClient {
  listSprintIssues(opts: { project: string; sprint?: string }): Promise<JiraIssueListResult>;
}

/** Structural slice of SpecQueries the builder reads. */
export interface CoverageSpecQueries {
  getSpecById?: (id: string) => { id: string; kind: string; sourcePath: string } | null;
  getSpecsByParent?: (id: string) => Array<{ id: string; kind: string }>;
  getLinksBySpec?: (id: string) => Array<{ state: SpecLinkState }>;
  /**
   * Enumerate every spec — used to find the requirement id for a spec file
   * whose frontmatter carries the JIRA key. The coverage builder only reads
   * `id`, `kind`, and `sourcePath`.
   */
  getAllSpecs?: () => Array<{ id: string; kind: string; sourcePath: string }>;
}

/**
 * Roll a requirement's spec-link states into one CoverageState (A2).
 * Precedence — a single degraded link always wins so the report never
 * overstates progress. Reuses the SpecLinkState enum verbatim.
 */
export function rollupCoverageState(states: SpecLinkState[]): CoverageState {
  if (states.some((s) => s === 'broken')) return 'broken';
  if (states.some((s) => s === 'drifted' || s === 'orphaned')) return 'drifted';
  if (states.length === 0) return 'specced';
  if (states.every((s) => s === 'verified')) return 'verified';
  if (states.every((s) => s === 'verified' || s === 'implemented')) return 'implemented';
  return 'specced';
}

/**
 * Collect the spec-link states for a requirement spec: its own links plus
 * the links of its acceptance children (matches `deriveRequirementStatus` in
 * spec-tools.ts — one state machine, two rollup precedences).
 */
function collectLinkStates(
  sq: CoverageSpecQueries,
  specId: string,
): SpecLinkState[] {
  const states: SpecLinkState[] = [];
  const own = sq.getLinksBySpec?.(specId) ?? [];
  for (const l of own) states.push(l.state);
  const children = sq.getSpecsByParent?.(specId) ?? [];
  for (const c of children) {
    if (c.kind !== 'acceptance') continue;
    for (const l of sq.getLinksBySpec?.(c.id) ?? []) states.push(l.state);
  }
  return states;
}

/**
 * Find the requirement spec id for a published spec file. Frontmatter carries
 * the JIRA key but not the SpecShip requirement id (the requirement id is
 * derivable from the H1 markers). We look up the requirement whose sourcePath
 * matches the published spec's file — the same "one requirement per published
 * file" invariant the publish path relies on.
 */
function requirementIdForPublished(
  sq: CoverageSpecQueries,
  pub: PublishedSpecRef,
): string | null {
  const all = sq.getAllSpecs?.() ?? [];
  for (const s of all) {
    if (s.kind !== 'requirement') continue;
    if (s.sourcePath === pub.specRelPath || s.sourcePath === pub.absPath) {
      return s.id;
    }
  }
  return null;
}

export interface BuildCoverageDeps {
  client: CoverageJiraClient;
  projectRoot: string;
  specQueries: CoverageSpecQueries;
  project: string;
  sprint?: string;
}

/**
 * Build the sprint coverage report (REQ-JIRATEAM-004.A1/A2). Every issue in
 * the sprint scope appears — including unspecced ones — with exactly one
 * rolled-up state, and the rollup counts close the report. Read-only: no
 * write to JIRA happens here (A4 is enforced by the caller).
 */
export async function buildCoverageReport(
  deps: BuildCoverageDeps,
): Promise<CoverageReport> {
  const listed = await deps.client.listSprintIssues({
    project: deps.project,
    sprint: deps.sprint,
  });

  const published = enumeratePublishedSpecs(deps.projectRoot);
  const byKey = new Map<string, PublishedSpecRef>();
  for (const p of published) byKey.set(p.issueKey, p);

  const rows: CoverageRow[] = listed.issues.map((issue) => {
    const pub = byKey.get(issue.key);
    if (!pub) {
      return {
        issueKey: issue.key,
        title: issue.summary,
        jiraStatus: issue.status,
        state: 'unspecced' as const,
      };
    }
    const reqId = requirementIdForPublished(deps.specQueries, pub);
    const states = reqId ? collectLinkStates(deps.specQueries, reqId) : [];
    return {
      issueKey: issue.key,
      title: pub.title || issue.summary,
      jiraStatus: issue.status,
      specRelPath: pub.specRelPath,
      state: rollupCoverageState(states),
    };
  });

  const rollup: CoverageRollup = {
    total: rows.length,
    unspecced: 0,
    specced: 0,
    implemented: 0,
    verified: 0,
    drifted: 0,
    broken: 0,
  };
  for (const r of rows) rollup[r.state]++;

  return {
    sprintLabel: deps.sprint ? deps.sprint : 'active sprint',
    rows,
    rollup,
  };
}

/** Watermark for the single edit-in-place coverage comment (A3). */
export const COVERAGE_COMMENT_WATERMARK = '<!-- specship:coverage v1 -->';

/** Escape a value so it can't break the markdown table layout. */
function cell(s: string): string {
  return String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/**
 * Render the report as markdown (REQ-JIRATEAM-004.A1). Prefixed with the
 * coverage watermark so `upsertWatermarkedComment` can find and edit it in
 * place on re-post.
 */
export function formatCoverageMarkdown(report: CoverageReport): string {
  const header = [
    COVERAGE_COMMENT_WATERMARK,
    `# Sprint coverage — ${report.sprintLabel}`,
    '',
  ];
  if (report.rows.length === 0) {
    return [
      ...header,
      '_No issues in this sprint scope._',
    ].join('\n');
  }
  const table = [
    '| Key | Title | JIRA | State | Spec |',
    '| --- | --- | --- | --- | --- |',
    ...report.rows.map(
      (r) =>
        `| ${cell(r.issueKey)} | ${cell(r.title)} | ${cell(r.jiraStatus)} | ${cell(r.state)} | ${cell(r.specRelPath ?? '—')} |`,
    ),
  ].join('\n');
  const roll = report.rollup;
  const rollupLine =
    `**Rollup:** ${roll.total} total · ${roll.verified} verified · ${roll.implemented} implemented · ` +
    `${roll.specced} specced · ${roll.unspecced} unspecced · ${roll.drifted} drifted · ${roll.broken} broken`;
  return [...header, table, '', rollupLine].join('\n');
}
