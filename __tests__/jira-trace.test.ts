import { describe, it, expect } from 'vitest';
import {
  diffIssueVsSpec,
  reportHasDivergence,
  type SpecViewForDiff,
} from '../src/jira/reconcile';
import { buildIssueFields, issueContentFingerprint, subtaskSummary } from '../src/jira/publish';
import type { JiraIssue } from '../src/jira/types';

/**
 * REQ-THRU-009 (specs/throughput.md): the story↔criterion trace is checked
 * in both directions — criteria with no matching Sub-task, and criteria
 * matched by more than one, alongside today's Sub-tasks with no criterion.
 * Pure diff: no I/O, no JIRA.
 */

const VIEW: SpecViewForDiff = {
  specRelPath: 'specs/auth.md',
  requirementId: 'REQ-AUTH-001',
  title: 'Failed login attempts must be rate-limited',
  body: 'The endpoint rejects more than 5 failures per minute.',
  acceptance: [
    { id: 'REQ-AUTH-001.A1', text: 'A 6th failure within 60s returns 429.' },
    { id: 'REQ-AUTH-001.A2', text: 'The lockout clears after 15 minutes.' },
  ],
};

function liveIssue(subtasks: Array<{ key: string; summary: string }>): {
  issue: JiraIssue;
  fingerprint: string;
} {
  const fields = buildIssueFields({
    specId: VIEW.requirementId,
    title: VIEW.title,
    body: VIEW.body,
    specRelPath: VIEW.specRelPath,
    acceptance: VIEW.acceptance,
  });
  return {
    issue: {
      key: 'PROJ-1',
      id: '10001',
      summary: fields.summary,
      description: fields.description,
      status: 'To Do',
      issueType: 'Story',
      subtasks: subtasks.map((s) => ({ ...s, status: 'To Do' })),
    },
    fingerprint: issueContentFingerprint(fields.summary, fields.description),
  };
}

const a1 = subtaskSummary(VIEW.acceptance[0]!.text);
const a2 = subtaskSummary(VIEW.acceptance[1]!.text);

describe('diffIssueVsSpec two-way trace — REQ-THRU-009', () => {
  it('REQ-THRU-009.A1: a criterion with no matching sub-task is reported as missing one', function criterionWithoutSubtaskIsReported() {
    const { issue, fingerprint } = liveIssue([{ key: 'PROJ-2', summary: a1 }]);
    const report = diffIssueVsSpec(issue, VIEW, fingerprint);
    expect(report.missingSubtasks).toEqual([
      {
        criterionId: 'REQ-AUTH-001.A2',
        criterionText: 'The lockout clears after 15 minutes.',
        expectedSummary: a2,
      },
    ]);
    expect(report.duplicateSubtasks).toEqual([]);
    expect(report.subtasks).toEqual([]);
    expect(reportHasDivergence(report)).toBe(true);
  });

  it('REQ-THRU-009.A2: a criterion matched by two sub-tasks is reported as duplicated', function duplicateSubtasksAreReported() {
    const { issue, fingerprint } = liveIssue([
      { key: 'PROJ-2', summary: a1 },
      { key: 'PROJ-3', summary: a2 },
      { key: 'PROJ-4', summary: a1 },
    ]);
    const report = diffIssueVsSpec(issue, VIEW, fingerprint);
    expect(report.duplicateSubtasks).toEqual([
      {
        criterionId: 'REQ-AUTH-001.A1',
        criterionText: 'A 6th failure within 60s returns 429.',
        subtaskKeys: ['PROJ-2', 'PROJ-4'],
      },
    ]);
    expect(report.missingSubtasks).toEqual([]);
    expect(reportHasDivergence(report)).toBe(true);
  });

  it('REQ-THRU-009.A3: a one-to-one mapped issue reports no missing or duplicate entries', function fullyMappedReportsNothingNew() {
    const { issue, fingerprint } = liveIssue([
      { key: 'PROJ-2', summary: a1 },
      { key: 'PROJ-3', summary: a2 },
    ]);
    const report = diffIssueVsSpec(issue, VIEW, fingerprint);
    expect(report.missingSubtasks).toEqual([]);
    expect(report.duplicateSubtasks).toEqual([]);
    expect(report.subtasks).toEqual([]);
    expect(report.content).toBeUndefined();
    expect(reportHasDivergence(report)).toBe(false);
  });
});
