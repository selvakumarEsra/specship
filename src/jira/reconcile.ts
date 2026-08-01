/**
 * JIRA-side edit reconciliation (REQ-JIRATEAM-005).
 *
 * Pure diff: given a live JIRA issue, its published fingerprint (stored in the
 * spec's frontmatter), and the parsed spec, report divergences without any I/O
 * so the module is testable without MCP/JIRA plumbing. Two flavors:
 *   - content divergence: the issue's summary/description was edited in JIRA
 *     after publish (fingerprint mismatch);
 *   - subtask divergence: a Sub-task was added in JIRA that has no matching
 *     acceptance criterion — reported with a proposed `.A<N+1>` id and text
 *     derived from the Sub-task summary.
 *
 * Sub-task matching reuses `subtaskSummary()` from `./publish` so the
 * comparison uses the EXACT same one-line truncation the publisher wrote
 * with — a Sub-task that publish wrote is never re-proposed on the way back.
 */

import { subtaskSummary, issueContentFingerprint } from './publish';
import type { JiraIssue } from './types';

export interface SubtaskDivergence {
  subtaskKey: string;
  subtaskSummary: string;
  /** Proposed `.A<N>` id (the next available under the requirement). */
  proposedCriterionId: string;
  /** Proposed criterion text derived from the Sub-task summary. */
  proposedCriterionText: string;
}

export interface ContentDivergence {
  issueKey: string;
  liveSummary: string;
  liveDescription: string;
  storedFingerprint: string;
  liveFingerprint: string;
}

export interface ReconcileReport {
  specRelPath: string;
  issueKey: string;
  /** The requirement's spec id (e.g. `REQ-AUTH-001`) the divergences belong to. */
  requirementId: string;
  content?: ContentDivergence;
  subtasks: SubtaskDivergence[];
}

/**
 * True when the report has any divergence to show. A clean report (no content
 * mismatch, no orphan Sub-task) is not surfaced to the user.
 */
export function reportHasDivergence(report: ReconcileReport): boolean {
  return Boolean(report.content) || report.subtasks.length > 0;
}

/**
 * The next `.A<N>` id after the largest existing suffix under `requirementId`.
 * Tolerates gaps and out-of-order ids: `[.A1, .A3]` yields `.A4`; empty → `.A1`.
 * Non-`.A<N>` ids and ids under other requirements are ignored.
 */
export function nextAcceptanceId(
  requirementId: string,
  existingIds: readonly string[],
): string {
  const prefix = `${requirementId}.A`;
  let max = 0;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${requirementId}.A${max + 1}`;
}

/**
 * Turn a Sub-task summary into acceptance-criterion body text — one line,
 * trailing punctuation kept, no truncation (unlike the publish-side summary,
 * which caps at 240 for the JIRA field limit).
 */
export function proposeCriterionFromSubtask(summary: string): string {
  return summary.replace(/\s+/g, ' ').trim();
}

/**
 * Data a caller supplies about a published spec — enough to diff. `title` and
 * `body` are what publish would send today (kept in-memory by the caller so
 * this module doesn't have to parse the spec file itself).
 */
export interface SpecViewForDiff {
  specRelPath: string;
  requirementId: string;
  title: string;
  body: string;
  acceptance: Array<{ id: string; text: string }>;
}

/**
 * Diff a live JIRA issue against its published spec. `storedFingerprint` is the
 * `jira_fingerprint:` recorded in the spec's frontmatter at publish time; when
 * null, the content divergence check is skipped (we can't judge drift without
 * a baseline). Sub-tasks whose summaries match any existing acceptance
 * criterion under `subtaskSummary()` are considered in-sync.
 */
export function diffIssueVsSpec(
  issue: JiraIssue,
  spec: SpecViewForDiff,
  storedFingerprint: string | null,
): ReconcileReport {
  const report: ReconcileReport = {
    specRelPath: spec.specRelPath,
    issueKey: issue.key,
    requirementId: spec.requirementId,
    subtasks: [],
  };

  // Content divergence (REQ-JIRATEAM-005.A1). The publisher's fingerprint is
  // over (summary, description); we recompute the LIVE fingerprint and compare.
  if (storedFingerprint) {
    const liveSummary = issue.summary ?? '';
    const liveDescription = issue.description ?? '';
    const liveFp = issueContentFingerprint(liveSummary, liveDescription);
    if (liveFp !== storedFingerprint) {
      report.content = {
        issueKey: issue.key,
        liveSummary,
        liveDescription,
        storedFingerprint,
        liveFingerprint: liveFp,
      };
    }
  }

  // Sub-task divergence (REQ-JIRATEAM-005.A2). Reuse subtaskSummary() so the
  // comparison uses the EXACT same one-line truncation the publisher wrote
  // with — a Sub-task publish itself wrote can never look "new" on the way
  // back.
  const knownSummaries = new Set(
    spec.acceptance.map((a) => subtaskSummary(a.text)),
  );
  const existingIds = spec.acceptance.map((a) => a.id);
  let nextId = nextAcceptanceId(spec.requirementId, existingIds);
  for (const st of issue.subtasks ?? []) {
    const summary = subtaskSummary(st.summary ?? '');
    if (!summary) continue;
    if (knownSummaries.has(summary)) continue;
    report.subtasks.push({
      subtaskKey: st.key,
      subtaskSummary: st.summary,
      proposedCriterionId: nextId,
      proposedCriterionText: proposeCriterionFromSubtask(st.summary),
    });
    // Reserve the id we just proposed for the next iteration.
    const n = Number(nextId.slice(`${spec.requirementId}.A`.length)) + 1;
    nextId = `${spec.requirementId}.A${n}`;
  }

  return report;
}
