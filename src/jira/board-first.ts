/**
 * Board-first anchor resolution (REQ-JIRATEAM-007).
 *
 * Every work-creating flow on a JIRA-bound repo MUST be anchored to a JIRA
 * issue. This module answers ONE question for the CLI, MCP tool, and slash
 * command that gate work: "given cwd + optional explicit/picked issueKey,
 * do we have an anchor, refuse, or should we no-op (unbound)?"
 *
 * The return is a THREE-way discriminated union — `unbound` is first-class
 * so callers on an unbound repo just proceed unchanged.
 *
 * When a bound repo refuses because no issue was picked, we ALSO surface the
 * epic-scoped pickable work in the refusal payload so the pick can happen in
 * the same round-trip (spec correction: A1 requires the refusal to LIST the
 * pickable work, not just hint at it).
 */

import { loadRepoJiraBinding } from './repo-config';
import { resolveJiraCredentials } from './config';
import { JiraClient } from './client';
import type { JiraIssue } from './types';

export type WorkAnchor = {
  issueKey: string;
  summary: string;
  source: 'explicit' | 'picked' | 'epic-child';
};

export type AnchorUnbound = { status: 'unbound' };
export type AnchorAnchored = { status: 'anchored'; anchor: WorkAnchor };
export type AnchorRefused = {
  status: 'refused';
  reason: 'no-pick' | 'no-epic-no-pick';
  fixHint: string;
  /** Epic-scoped open stories/tasks — populated on `no-pick` so the caller can
   *  render the picker in the same turn (A1). */
  pickable?: JiraIssue[];
};
export type AnchorResolution = AnchorUnbound | AnchorAnchored | AnchorRefused;

/** Minimal client seam so tests inject a fake and never touch a real host. */
export interface AnchorJiraClient {
  listMyIssues(opts?: {
    project?: string;
    sprint?: 'active';
    epicKey?: string;
  }): Promise<{ ok: true; issues: JiraIssue[] }>;
  getIssue(key: string): Promise<{ ok: true; issue: JiraIssue }>;
}

export interface ResolveWorkAnchorOptions {
  cwd: string;
  explicitIssueKey?: string;
  pickedIssueKey?: string;
  /** Test seam. Default: resolve credentials + new JiraClient. */
  makeClient?: () => AnchorJiraClient;
}

function defaultMakeClient(): AnchorJiraClient {
  const creds = resolveJiraCredentials();
  return new JiraClient(creds) as unknown as AnchorJiraClient;
}

export async function resolveWorkAnchor(
  opts: ResolveWorkAnchorOptions,
): Promise<AnchorResolution> {
  const { binding } = loadRepoJiraBinding(opts.cwd);
  if (!binding) return { status: 'unbound' };

  const makeClient = opts.makeClient ?? defaultMakeClient;

  const explicit = opts.explicitIssueKey?.trim();
  const picked = opts.pickedIssueKey?.trim();
  const key = explicit || picked;
  if (key) {
    const client = makeClient();
    const res = await client.getIssue(key);
    return {
      status: 'anchored',
      anchor: {
        issueKey: res.issue.key,
        summary: res.issue.summary,
        source: explicit ? 'explicit' : 'picked',
      },
    };
  }

  if (!binding.epicKey) {
    return {
      status: 'refused',
      reason: 'no-epic-no-pick',
      fixHint:
        'Set jira.epicKey in specship.config.json (or pick an issue with specship_jira_pick <KEY>).',
    };
  }

  // Bound + epic + no pick → list the epic's open stories/tasks so the caller
  // can render the pick in the same round-trip (A1).
  let pickable: JiraIssue[] = [];
  try {
    const client = makeClient();
    const res = await client.listMyIssues({
      project: binding.projectKey,
      epicKey: binding.epicKey,
    });
    pickable = res.issues;
  } catch {
    // Degrade to a refusal without pickable list — the fixHint still names
    // the exact next step.
  }
  return {
    status: 'refused',
    reason: 'no-pick',
    fixHint:
      'Run specship_jira_issues to list the epic\'s open work, then specship_jira_pick <KEY> to anchor this run.',
    pickable,
  };
}

/** Canonical human-facing refusal message for CLI/MCP callers. */
export function formatRefusal(res: AnchorRefused): string {
  const header =
    res.reason === 'no-epic-no-pick'
      ? 'Work refused: no JIRA anchor — no epic bound and no issue picked.'
      : 'Work refused: no JIRA anchor — pick an issue under the bound epic.';
  const lines = [header, res.fixHint];
  if (res.pickable && res.pickable.length) {
    lines.push('', 'Pickable issues:');
    for (const i of res.pickable) {
      lines.push(`- ${i.key} — ${i.summary} [${i.status}]`);
    }
  }
  return lines.join('\n');
}
