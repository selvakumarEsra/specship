import { describe, it, expect } from 'vitest';
import {
  diffIssueVsSpec,
  nextAcceptanceId,
  proposeCriterionFromSubtask,
  reportHasDivergence,
  type SpecViewForDiff,
} from '../../src/jira/reconcile';
import { issueContentFingerprint, buildIssueFields, subtaskSummary } from '../../src/jira/publish';
import type { JiraIssue } from '../../src/jira/types';

/**
 * REQ-JIRATEAM-005 — the pure diff. No I/O; no JIRA; no fs. Every case
 * constructs a live `JiraIssue` + a `SpecViewForDiff` and asserts the report.
 */

function spec(overrides: Partial<SpecViewForDiff> = {}): SpecViewForDiff {
  return {
    specRelPath: 'specs/req-auth-001.md',
    requirementId: 'REQ-AUTH-001',
    title: 'Failed login attempts must be rate-limited',
    body: 'The endpoint rejects more than 5 failures per minute.',
    acceptance: [
      { id: 'REQ-AUTH-001.A1', text: 'A 6th failure within 60s returns 429.' },
    ],
    ...overrides,
  };
}

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'PROJ-1',
    id: '10001',
    summary: 'Failed login attempts must be rate-limited',
    status: 'To Do',
    issueType: 'Story',
    description: 'body',
    subtasks: [],
    ...overrides,
  };
}

/**
 * Build a `JiraIssue` whose summary/description match what publish would
 * have written for `view` — the fingerprint over these fields equals
 * `fingerprintFor(view)`, so the content-divergence axis reads as "in sync"
 * unless the test explicitly diverges it.
 */
function inSyncIssue(view: SpecViewForDiff, overrides: Partial<JiraIssue> = {}): JiraIssue {
  const fields = buildIssueFields({
    specId: view.requirementId,
    title: view.title,
    body: view.body,
    specRelPath: view.specRelPath,
    acceptance: view.acceptance,
  });
  return {
    key: 'PROJ-1',
    id: '10001',
    summary: fields.summary,
    description: fields.description,
    status: 'To Do',
    issueType: 'Story',
    subtasks: [],
    ...overrides,
  };
}

/** Fingerprint what publish would have written for this spec, so an
 *  unedited issue matches. */
function fingerprintFor(view: SpecViewForDiff): string {
  const fields = buildIssueFields({
    specId: view.requirementId,
    title: view.title,
    body: view.body,
    specRelPath: view.specRelPath,
    acceptance: view.acceptance,
  });
  return issueContentFingerprint(fields.summary, fields.description);
}

describe('nextAcceptanceId', () => {
  it('returns .A1 when the requirement has no acceptance yet', () => {
    expect(nextAcceptanceId('REQ-X-001', [])).toBe('REQ-X-001.A1');
  });
  it('picks max+1 across gaps and out-of-order ids', () => {
    expect(
      nextAcceptanceId('REQ-X-001', [
        'REQ-X-001.A3',
        'REQ-X-001.A1',
        'REQ-OTHER-001.A9', // ignored — different requirement
      ]),
    ).toBe('REQ-X-001.A4');
  });
});

describe('proposeCriterionFromSubtask', () => {
  it('trims whitespace and collapses runs', () => {
    expect(proposeCriterionFromSubtask('  foo   bar\nbaz  ')).toBe('foo bar baz');
  });
});

describe('diffIssueVsSpec — REQ-JIRATEAM-005', () => {
  it('A1: an edited summary/description is reported as content divergence', () => {
    const s = spec();
    const stored = fingerprintFor(s);
    const live = issue({
      summary: 'Rate-limiting now bans the IP after 5 failures — edited in JIRA',
      description: 'Rewritten description',
    });
    const report = diffIssueVsSpec(live, s, stored);
    expect(reportHasDivergence(report)).toBe(true);
    expect(report.content).toBeDefined();
    expect(report.content!.liveSummary).toContain('edited in JIRA');
    expect(report.content!.liveFingerprint).not.toBe(stored);
    expect(report.subtasks).toEqual([]);
  });

  it('A2: a JIRA-added Sub-task surfaces as a proposed .A<N+1>', () => {
    const s = spec();
    const stored = fingerprintFor(s);
    const live = inSyncIssue(s, {
      subtasks: [
        { key: 'PROJ-2', summary: subtaskSummary(s.acceptance[0]!.text), status: 'To Do' },
        { key: 'PROJ-3', summary: 'A 100th failure locks the account for 24h', status: 'To Do' },
      ],
    });
    const report = diffIssueVsSpec(live, s, stored);
    expect(report.content).toBeUndefined();
    expect(report.subtasks).toHaveLength(1);
    expect(report.subtasks[0]!.proposedCriterionId).toBe('REQ-AUTH-001.A2');
    expect(report.subtasks[0]!.proposedCriterionText).toBe(
      'A 100th failure locks the account for 24h',
    );
    expect(report.subtasks[0]!.subtaskKey).toBe('PROJ-3');
  });

  it('combined: both content and sub-task divergences populate together', () => {
    const s = spec();
    const stored = fingerprintFor(s);
    const live = issue({
      summary: 'Edited',
      description: 'Edited body',
      subtasks: [{ key: 'PROJ-9', summary: 'New criterion', status: 'To Do' }],
    });
    const report = diffIssueVsSpec(live, s, stored);
    expect(report.content).toBeDefined();
    expect(report.subtasks).toHaveLength(1);
  });

  it('clean: matching fingerprint + matching sub-tasks produces an empty report', () => {
    const s = spec();
    const stored = fingerprintFor(s);
    const fields = buildIssueFields({
      specId: s.requirementId,
      title: s.title,
      body: s.body,
      specRelPath: s.specRelPath,
      acceptance: s.acceptance,
    });
    const live = issue({
      summary: fields.summary,
      description: fields.description,
      subtasks: [
        { key: 'PROJ-2', summary: subtaskSummary(s.acceptance[0]!.text), status: 'To Do' },
      ],
    });
    const report = diffIssueVsSpec(live, s, stored);
    expect(reportHasDivergence(report)).toBe(false);
    expect(report.content).toBeUndefined();
    expect(report.subtasks).toEqual([]);
  });

  it('no stored fingerprint skips the content check (we cannot judge drift without a baseline)', () => {
    const s = spec();
    const live = issue({ summary: 'anything', description: 'anything' });
    const report = diffIssueVsSpec(live, s, null);
    expect(report.content).toBeUndefined();
  });

  it('multiple new sub-tasks get successive .A ids in order', () => {
    const s = spec();
    const stored = fingerprintFor(s);
    const live = inSyncIssue(s, {
      subtasks: [
        { key: 'PROJ-2', summary: 'first new', status: 'To Do' },
        { key: 'PROJ-3', summary: 'second new', status: 'To Do' },
      ],
    });
    const report = diffIssueVsSpec(live, s, stored);
    expect(report.subtasks.map((d) => d.proposedCriterionId)).toEqual([
      'REQ-AUTH-001.A2',
      'REQ-AUTH-001.A3',
    ]);
  });
});
