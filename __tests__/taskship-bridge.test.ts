/**
 * TASKSHIP-BRIDGE-DOC — the SpecShip↔taskship bridge over the JIRA bus.
 *   001 — sprint-scoped daily pull (listMyIssues + specship_jira_issues).
 *   002 — the pure, injected taskship-availability probe.
 *   003 — capability-detected add-task (taskship route vs JIRA fallback).
 *
 * @verifies REQ-TASKSHIP-001
 * @verifies REQ-TASKSHIP-002
 * @verifies REQ-TASKSHIP-003
 */

import { describe, it, expect, vi } from 'vitest';
import { detectTaskship, type TaskshipProbes } from '../src/taskship/detect';
import {
  handleSpecshipJiraAddTask,
  type JiraAddTaskDeps,
  type TaskshipAddResult,
} from '../src/mcp/jira-tools';

// --- REQ-TASKSHIP-002: pure injected detector --------------------------------

const probes = (over: Partial<TaskshipProbes> = {}): TaskshipProbes => ({
  commandOnPath: () => false,
  mcpConfigured: () => false,
  ...over,
});

describe('detectTaskship (REQ-TASKSHIP-002)', () => {
  it('A1: reports available (via cli) when the binary is on PATH', () => {
    expect(detectTaskship(probes({ commandOnPath: (c) => c === 'taskship' }))).toEqual({
      available: true,
      via: 'cli',
    });
  });

  it('A1: reports available (via mcp) when only the MCP entry exists', () => {
    expect(detectTaskship(probes({ mcpConfigured: () => true }))).toEqual({
      available: true,
      via: 'mcp',
    });
  });

  it('A1: reports unavailable when neither signal is present', () => {
    expect(detectTaskship(probes())).toEqual({ available: false, via: null });
  });

  it('A2: never throws even when a probe throws', () => {
    const throwing = probes({
      commandOnPath: () => { throw new Error('boom'); },
      mcpConfigured: () => { throw new Error('boom'); },
    });
    expect(() => detectTaskship(throwing)).not.toThrow();
    expect(detectTaskship(throwing)).toEqual({ available: false, via: null });
  });
});

// --- REQ-TASKSHIP-003: add-task routing --------------------------------------

const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';
const isError = (r: { isError?: boolean }) => r.isError === true;

function jiraFake() {
  const createIssue = vi.fn(async (f: Record<string, unknown>) => ({ key: 'PROJ-99', id: '10099', _f: f }));
  return { createIssue, makeJiraClient: () => ({ createIssue }) as never };
}

function deps(over: Partial<JiraAddTaskDeps> = {}): JiraAddTaskDeps {
  return {
    projectRoot: '/tmp/proj',
    detect: () => ({ available: false, via: null }),
    genExternalId: () => 'EXT-1234',
    ...over,
  };
}

describe('handleSpecshipJiraAddTask routing (REQ-TASKSHIP-003)', () => {
  it('A1: taskship available → routes through taskship, creates no JIRA issue', async () => {
    const run = vi.fn(async (): Promise<TaskshipAddResult> => ({ ok: true, detail: 'taskship raise --story S1' }));
    const jira = jiraFake();
    const r = await handleSpecshipJiraAddTask(
      { parent: 'S1', title: 'wire retry', parent_kind: 'story' },
      deps({ detect: () => ({ available: true, via: 'cli' }), runTaskshipAdd: run, makeJiraClient: jira.makeJiraClient }),
    );
    expect(run).toHaveBeenCalledWith({ parent: 'S1', parentKind: 'story', title: 'wire retry', type: 'task' });
    expect(jira.createIssue).not.toHaveBeenCalled();
    expect(text(r)).toContain('via taskship');
    expect(isError(r)).toBe(false);
  });

  it('A2: taskship available but its add fails → error, no JIRA issue', async () => {
    const run = vi.fn(async (): Promise<TaskshipAddResult> => ({ ok: false, error: 'plan.yaml locked' }));
    const jira = jiraFake();
    const r = await handleSpecshipJiraAddTask(
      { parent: 'S1', title: 'wire retry' },
      deps({ detect: () => ({ available: true, via: 'cli' }), runTaskshipAdd: run, makeJiraClient: jira.makeJiraClient }),
    );
    expect(isError(r)).toBe(true);
    expect(text(r)).toContain('plan.yaml locked');
    expect(text(r)).toContain('No JIRA issue was created');
    expect(jira.createIssue).not.toHaveBeenCalled();
  });

  it('A3: taskship absent, parent is a Story → creates a JIRA Sub-task', async () => {
    const jira = jiraFake();
    const r = await handleSpecshipJiraAddTask(
      { parent: 'PROJ-45', title: 'add index', parent_kind: 'story' },
      deps({ makeJiraClient: jira.makeJiraClient }),
    );
    expect(jira.createIssue).toHaveBeenCalledTimes(1);
    const f = jira.createIssue.mock.calls[0]![0] as Record<string, unknown>;
    expect(f.issueType).toBe('Sub-task');
    expect(f.parentKey).toBe('PROJ-45');
    expect(f.projectKey).toBe('PROJ'); // derived from the parent key prefix
    expect(isError(r)).toBe(false);
  });

  it('A3: taskship absent, parent is an Epic → creates a JIRA Task', async () => {
    const jira = jiraFake();
    await handleSpecshipJiraAddTask(
      { parent: 'PROJ-10', title: 'spike', parent_kind: 'epic' },
      deps({ makeJiraClient: jira.makeJiraClient }),
    );
    const f = jira.createIssue.mock.calls[0]![0] as Record<string, unknown>;
    expect(f.issueType).toBe('Task');
  });

  it('A4: the fallback issue carries the taskship watermark + type labels', async () => {
    const jira = jiraFake();
    await handleSpecshipJiraAddTask(
      { parent: 'PROJ-45', title: 'add index', type: 'code' },
      deps({ makeJiraClient: jira.makeJiraClient }),
    );
    const f = jira.createIssue.mock.calls[0]![0] as { labels: string[] };
    expect(f.labels).toContain('taskship:EXT-1234');
    expect(f.labels).toContain('taskship:type:code');
    expect(f.labels).toContain('taskship:source:specship');
  });

  it('requires parent and title', async () => {
    expect(text(await handleSpecshipJiraAddTask({ title: 'x' }, deps()))).toMatch(/parent id is required/i);
    expect(text(await handleSpecshipJiraAddTask({ parent: 'PROJ-1' }, deps()))).toMatch(/title is required/i);
  });
});
