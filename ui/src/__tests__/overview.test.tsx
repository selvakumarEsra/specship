/**
 * REQ-DASHSIMPLE-002 — the Overview summarises the project in one screen of
 * agent-agnostic facts. Rendered through the full App against fixture
 * /api responses:
 *   A1 the three counts match Review's groups, and each opens Review filtered;
 *   A2 index freshness + at most five recent runs, each with status and the
 *      agent recorded on the run;
 *   A3 no token / cost / session / transcript value, and no request to such an
 *      endpoint;
 *   A4 zero specs → one agent-neutral next step, no tiles or charts.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverageVerdict, CriterionCoverage, DriftLink, RequirementCoverage, WorkflowRun } from '../api';
import { App } from '../App';
import { __clearApiCache } from '../hooks';
import { FIRST_SPEC_STEP } from '../pages/dashboard';
import { groupRequirements } from '../review-groups';

// ---- Fixtures ----

const rollup = (count: number, state = 'implemented') => ({ count, states: count ? { [state]: count } : {} });

function crit(id: string, verdict: CoverageVerdict): CriterionCoverage {
  return {
    specId: id, title: id, kind: 'acceptance',
    implementsLinks: rollup(0),
    testsLinks: verdict === 'untested' ? rollup(0) : rollup(1, verdict === 'broken' ? 'broken' : 'verified'),
    verdict,
  };
}

function req(id: string, code: number, criteria: CriterionCoverage[], codeState = 'implemented'): RequirementCoverage {
  const totals: Record<CoverageVerdict, number> = { untested: 0, tested: 0, verified: 0, broken: 0 };
  for (const c of criteria) totals[c.verdict]++;
  return {
    specId: id, title: 'Title of ' + id, kind: 'requirement',
    implementsLinks: rollup(code, codeState), testsLinks: rollup(0), verdict: 'untested',
    criteria, criteriaTotals: totals,
    criteriaWithTests: criteria.filter((c) => c.verdict !== 'untested').length,
    criteriaCount: criteria.length,
  };
}

/** 2 completed, 1 drifted, 3 pending — distinct counts so a swapped tile shows. */
const REQS: RequirementCoverage[] = [
  req('REQ-C-1', 1, [crit('REQ-C-1.A1', 'verified')]),
  req('REQ-C-2', 1, [crit('REQ-C-2.A1', 'verified'), crit('REQ-C-2.A2', 'verified')]),
  req('REQ-D-1', 1, [crit('REQ-D-1.A1', 'verified')], 'orphaned'),
  req('REQ-P-1', 1, [crit('REQ-P-1.A1', 'untested')]),
  req('REQ-P-2', 0, [crit('REQ-P-2.A1', 'untested')]),
  req('REQ-P-3', 1, []),
];

const DRIFT: DriftLink[] = [
  { id: 9, specId: 'REQ-D-1', kind: 'implements', state: 'orphaned', specTitle: 'Title of REQ-D-1', targetQualifiedName: 'goneFn', driftAxis: null },
];

const coverageOf = (reqs: RequirementCoverage[]) => ({
  specId: null, requirements: reqs,
  totals: { requirements: reqs.length, criteria: 0, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0 },
});

const INDEXED_AT = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

const STATUS = {
  projectPath: '/Users/dev/acme', backend: 'native', journalMode: 'wal', version: '9.9.9',
  nodeCount: 1234, edgeCount: 5678, fileCount: 42, drift: 1,
  lastIndexed: INDEXED_AT, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
};

const STATUSES = ['completed', 'failed', 'running', 'paused', 'cancelled', 'completed', 'failed'];

/** Seven runs, oldest first in the payload; run-6 (newest) ran on gemini. Each carries a model + cost the Overview must not show. */
const RUNS: WorkflowRun[] = STATUSES.map((status, i) => ({
  id: `run-${i}`,
  workflowName: `wf-${i}`,
  status,
  startedAt: Date.now() - (7 - i) * 60_000,
  metadata: { agent: i === 6 ? 'gemini' : 'claude' },
  model: 'some-model-xyz',
  totalCostUsd: 4.2,
}));

function mockFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    const r = routes[u.pathname];
    if (r === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    return { ok: true, json: async () => r };
  }));
  return calls;
}

function routes(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '/api/status': STATUS,
    '/api/projects': { claudeRoot: '', projects: [] },
    '/api/spec/coverage': coverageOf(REQS),
    '/api/drift': { links: DRIFT },
    '/api/workflows/runs': { runs: RUNS },
    ...over,
  };
}

const overview = () => screen.findByTestId('overview');
const countTile = (g: string) => document.querySelector(`[data-overview-count="${g}"] button`) as HTMLButtonElement;
const tileValue = (g: string) => document.querySelector(`[data-overview-count="${g}"] .display-num`)?.textContent;

beforeEach(() => {
  history.replaceState(null, '', '/dashboard');
  localStorage.clear();
  __clearApiCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---- A1 ----

async function reqDashsimple002A1(): Promise<void> {
  const expected = groupRequirements(REQS, DRIFT);
  for (const g of ['drifted', 'pending', 'completed'] as const) {
    cleanup();
    __clearApiCache();
    history.replaceState(null, '', '/dashboard');
    mockFetch(routes());
    render(<App />);
    await overview();
    await waitFor(() => expect(countTile(g)).toBeTruthy());

    // Counts are Review's classifier verbatim: 1 drifted, 3 pending, 2 completed.
    expect(tileValue('drifted')).toBe(String(expected.drifted.length));
    expect(tileValue('pending')).toBe(String(expected.pending.length));
    expect(tileValue('completed')).toBe(String(expected.completed.length));
    expect([expected.drifted.length, expected.pending.length, expected.completed.length]).toEqual([1, 3, 2]);

    fireEvent.click(countTile(g));
    await waitFor(() => expect(location.pathname).toBe('/review'));
    expect(new URLSearchParams(location.search).get('group')).toBe(g);
    const section = await screen.findByTestId('review-group-' + g);
    expect(section.querySelectorAll('[data-review-row]').length).toBe(expected[g].length);
    for (const other of ['drifted', 'pending', 'completed'].filter((x) => x !== g)) {
      expect(screen.queryByTestId('review-group-' + other)).toBeNull();
    }
  }
}

// ---- A2 ----

async function reqDashsimple002A2(): Promise<void> {
  mockFetch(routes());
  render(<App />);
  await overview();
  const list = await screen.findByTestId('recent-runs');
  await waitFor(() => expect(list.querySelectorAll('[data-run-row]').length).toBe(5));

  const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-run-row]'));
  // Newest first: run-6 … run-2; run-1 and run-0 fall off.
  expect(rows.map((r) => r.getAttribute('data-run-row'))).toEqual(['run-6', 'run-5', 'run-4', 'run-3', 'run-2']);
  for (const row of rows) {
    const run = RUNS.find((r) => r.id === row.getAttribute('data-run-row'))!;
    const statusLabel = run.status[0]!.toUpperCase() + run.status.slice(1);
    expect(within(row).getByTestId('run-status').textContent).toBe(statusLabel);
    expect(within(row).getByTestId('run-agent').textContent).toBe(String(run.metadata!.agent));
  }
  expect(within(rows[0]!).getByTestId('run-agent').textContent).toBe('gemini');

  // Index freshness from /api/status.lastIndexed.
  expect(screen.getByTestId('freshness-text').textContent).toBe('Indexed 3h ago');
  cleanup();

  // A run with no recorded agent shows a dash — the Overview never guesses one.
  __clearApiCache();
  mockFetch(routes({ '/api/workflows/runs': { runs: [{ id: 'run-x', workflowName: 'wf-x', status: 'completed', startedAt: Date.now() }] } }));
  render(<App />);
  const row = await waitFor(() => {
    const r = document.querySelector<HTMLElement>('[data-run-row="run-x"]');
    expect(r).toBeTruthy();
    return r!;
  });
  expect(within(row).getByTestId('run-agent').textContent).toBe('—');
}

// ---- A3 ----

async function reqDashsimple002A3(): Promise<void> {
  const calls = mockFetch(routes());
  render(<App />);
  await overview();
  await waitFor(() => expect(document.querySelectorAll('[data-run-row]').length).toBe(5));
  await waitFor(() => expect(countTile('completed')).toBeTruthy());

  // No request reaches a transcript, cost, session, heatmap, tips or cache endpoint.
  const forbidden = /claude|cost|session|transcript|heatmap|tips|cache/i;
  const offending = calls.filter((u) => forbidden.test(new URL(u, 'http://local').pathname));
  expect(offending, offending.join('\n')).toEqual([]);

  // No token, cost, session or transcript value is rendered on the Overview.
  const text = screen.getByTestId('overview').textContent ?? '';
  expect(text).not.toMatch(/\$/);
  expect(text).not.toMatch(/tokens?/i);
  expect(text).not.toMatch(/cost/i);
  expect(text).not.toMatch(/session/i);
  expect(text).not.toMatch(/transcript/i);
  // The runs carry a model and a cost; neither reaches the screen.
  expect(text).not.toContain('some-model-xyz');
  expect(text).not.toContain('4.2');
}

// ---- A4 ----

async function reqDashsimple002A4(): Promise<void> {
  mockFetch(routes({ '/api/spec/coverage': coverageOf([]), '/api/drift': { links: [] } }));
  render(<App />);
  const empty = await screen.findByTestId('overview-empty');

  // Exactly one next-step message, agent-neutral: names the spec location and the CLI, no slash command.
  expect(screen.getAllByText(FIRST_SPEC_STEP)).toHaveLength(1);
  expect(FIRST_SPEC_STEP).toBe('Write your first spec as a Markdown file under specs/, then run specship sync.');
  expect(empty.textContent).not.toContain('/specship:');
  expect(empty.textContent).not.toMatch(/(^|\s)\/[a-z]+:/);

  // No count tiles, runs list, freshness card, chart or SVG chart surface.
  expect(document.querySelector('[data-overview-count]')).toBeNull();
  expect(screen.queryByTestId('recent-runs')).toBeNull();
  expect(screen.queryByTestId('index-freshness')).toBeNull();
  expect(screen.queryByTestId('overview')).toBeNull();
  const main = document.querySelector('[data-screen="dashboard"]')!;
  expect(main).toBeTruthy();
  // Every SVG left on the screen is a 24×24 kit icon — no chart surface, no canvas.
  const charts = Array.from(main.querySelectorAll('svg')).filter((s) => s.getAttribute('viewBox') !== '0 0 24 24');
  expect(charts).toHaveLength(0);
  expect(main.querySelectorAll('canvas, .display-num').length).toBe(0);
}

describe('REQ-DASHSIMPLE-002 — the Overview screen', () => {
  it('REQ-DASHSIMPLE-002.A1: counts match Review groups and each opens Review filtered to its group', reqDashsimple002A1);
  it('REQ-DASHSIMPLE-002.A2: shows index freshness and at most five recent runs with status and recorded agent', reqDashsimple002A2);
  it('REQ-DASHSIMPLE-002.A3: renders no token/cost/session/transcript value and requests no such endpoint', reqDashsimple002A3);
  it('REQ-DASHSIMPLE-002.A4: zero specs shows one agent-neutral next step and no empty charts', reqDashsimple002A4);
});
