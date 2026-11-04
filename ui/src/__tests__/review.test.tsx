/**
 * REQ-DASHSIMPLE-004 — the Review screen sorts every requirement into
 * Drifted / Pending / Completed, filters by group through the URL, names the
 * fix for a drifted link, and shows an error + retry when its data fails.
 * Rendered against fixture /api/spec/coverage and /api/drift responses.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverageVerdict, CriterionCoverage, DriftLink, RequirementCoverage } from '../api';
import { App } from '../App';
import { __clearApiCache } from '../hooks';
import { ReviewPage } from '../pages/review';
import { DRIFT_STATES, classifyRequirement, fixCommand, groupRequirements } from '../review-groups';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---- Fixture builders ----

const rollup = (count: number, state = 'implemented') => ({ count, states: count ? { [state]: count } : {} });

function crit(id: string, verdict: CoverageVerdict, testState = 'verified'): CriterionCoverage {
  const tested = verdict !== 'untested';
  return {
    specId: id, title: id, kind: 'acceptance',
    implementsLinks: rollup(0),
    testsLinks: tested ? rollup(1, verdict === 'broken' ? 'broken' : testState) : rollup(0),
    verdict,
  };
}

function req(id: string, opts: { code?: number; codeState?: string; criteria?: CriterionCoverage[]; title?: string } = {}): RequirementCoverage {
  const criteria = opts.criteria ?? [];
  const totals: Record<CoverageVerdict, number> = { untested: 0, tested: 0, verified: 0, broken: 0 };
  for (const c of criteria) totals[c.verdict]++;
  return {
    specId: id, title: opts.title ?? 'Title of ' + id, kind: 'requirement',
    implementsLinks: rollup(opts.code ?? 0, opts.codeState ?? 'implemented'),
    testsLinks: rollup(0),
    verdict: 'untested',
    criteria,
    criteriaTotals: totals,
    criteriaWithTests: criteria.filter((c) => c.verdict !== 'untested').length,
    criteriaCount: criteria.length,
  };
}

/** REQ-C-1 completed, REQ-D-1 drifted (orphaned + all verified), REQ-P-1 pending, REQ-P-2 no criteria, REQ-U-1 unimplemented. */
const REQS: RequirementCoverage[] = [
  req('REQ-C-1', { code: 1, criteria: [crit('REQ-C-1.A1', 'verified'), crit('REQ-C-1.A2', 'verified')], title: 'Completed thing' }),
  req('REQ-D-1', { code: 1, codeState: 'orphaned', criteria: [crit('REQ-D-1.A1', 'verified')], title: 'Orphaned thing' }),
  req('REQ-P-1', { code: 1, criteria: [crit('REQ-P-1.A1', 'untested'), crit('REQ-P-1.A2', 'untested')], title: 'Pending thing' }),
  req('REQ-P-2', { code: 1, criteria: [], title: 'No criteria thing' }),
  req('REQ-U-1', { code: 0, criteria: [crit('REQ-U-1.A1', 'untested')], title: 'Unimplemented thing' }),
];

const DRIFT: DriftLink[] = [
  { id: 7, specId: 'REQ-D-1', kind: 'implements', state: 'orphaned', specTitle: 'Orphaned thing', targetFilePath: 'src/gone.ts', targetQualifiedName: 'removedFn', driftAxis: null },
];

const COVERAGE = { specId: null, requirements: REQS, totals: { requirements: REQS.length, criteria: 0, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0 } };

const STATUS = {
  projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal',
  nodeCount: 100, edgeCount: 200, fileCount: 30, drift: 1,
  lastIndexed: null, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
};

const DETAIL_C1 = {
  spec: { id: 'REQ-C-1', kind: 'requirement', title: 'Completed thing', body: 'The thing MUST be complete in every respect.', sourcePath: 'specs/x.md', parentId: 'X-DOC' },
  parent: { id: 'X-DOC', kind: 'document', title: 'Example', sourcePath: 'specs/x.md' },
  siblings: [], children: [],
  links: [{ id: 1, specId: 'REQ-C-1', kind: 'implements', state: 'implemented', targetFilePath: 'src/thing.ts', targetQualifiedName: 'doThing' }],
  childLinks: {}, source: null,
};

type Route = unknown | ((u: URL) => { ok: boolean; status?: number; body: unknown });

function mockFetch(routes: Record<string, Route>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    const r = routes[u.pathname];
    if (typeof r === 'function') {
      const out = (r as (u: URL) => { ok: boolean; status?: number; body: unknown })(u);
      return { ok: out.ok, status: out.status ?? 200, statusText: out.ok ? 'OK' : 'Server Error', json: async () => out.body };
    }
    if (r === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    return { ok: true, json: async () => r };
  }));
  return calls;
}

const REVIEW_ROUTES: Record<string, Route> = {
  '/api/spec/coverage': COVERAGE,
  '/api/drift': { links: DRIFT },
  '/api/spec/REQ-C-1': DETAIL_C1,
};

const rowsIn = (g: string) =>
  Array.from(screen.getByTestId('review-group-' + g).querySelectorAll('[data-review-row]')).map((e) => e.getAttribute('data-review-row'));

beforeEach(() => {
  history.replaceState(null, '', '/review');
  localStorage.clear();
  __clearApiCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---- A1 ----

async function reqDashsimple004A1(): Promise<void> {
  mockFetch(REVIEW_ROUTES);
  render(<ReviewPage project={null} query={{}} />);
  await screen.findByTestId('review-group-drifted');

  const drifted = rowsIn('drifted');
  const pending = rowsIn('pending');
  const completed = rowsIn('completed');
  const all = [...drifted, ...pending, ...completed];
  expect(all.length).toBe(REQS.length);
  expect(new Set(all).size).toBe(REQS.length); // no requirement in two groups
  expect(new Set(all)).toEqual(new Set(REQS.map((r) => r.specId)));

  // The tab counts are the group sizes and add up to the total.
  const radios = within(screen.getByRole('radiogroup', { name: 'Review group' })).getAllByRole('radio').map((r) => r.textContent);
  expect(radios).toEqual([
    `All (${REQS.length})`, `Drifted (${drifted.length})`, `Pending (${pending.length})`, `Completed (${completed.length})`,
  ]);
  expect(drifted.length + pending.length + completed.length).toBe(REQS.length);

  // Opening a row shows the requirement's full text and links, at /review/<id>.
  fireEvent.click(screen.getByText('REQ-C-1'));
  expect(await screen.findByText(/complete in every respect/)).toBeTruthy();
  expect(location.pathname).toBe('/review/REQ-C-1');
  expect(screen.getAllByText(/doThing/).length).toBeGreaterThan(0);

  // The pure grouping agrees with the screen.
  const g = groupRequirements(REQS, DRIFT);
  expect(g.drifted.length + g.pending.length + g.completed.length).toBe(REQS.length);
}

// ---- A2 ----

async function reqDashsimple004A2(): Promise<void> {
  const r = req('REQ-OK-1', { code: 2, criteria: [crit('REQ-OK-1.A1', 'verified'), crit('REQ-OK-1.A2', 'verified')] });
  expect(classifyRequirement(r, []).group).toBe('completed');
  // Code links alone never complete: same requirement, one criterion merely tested.
  const tested = req('REQ-OK-2', { code: 2, criteria: [crit('REQ-OK-2.A1', 'verified'), crit('REQ-OK-2.A2', 'tested', 'implemented')] });
  expect(classifyRequirement(tested, []).group).toBe('pending');

  mockFetch(REVIEW_ROUTES);
  render(<ReviewPage project={null} query={{}} />);
  await screen.findByTestId('review-group-completed');
  expect(rowsIn('completed')).toEqual(['REQ-C-1']);
}

// ---- A3 ----

async function reqDashsimple004A3(): Promise<void> {
  // Through the real drift data path: Review asks /api/drift for every drift
  // state explicitly, and the orphaned row it returns makes REQ-D-1 Drifted.
  const calls = mockFetch(REVIEW_ROUTES);
  render(<ReviewPage project={null} query={{}} />);
  await screen.findByTestId('review-group-drifted');

  const driftCall = calls.find((u) => u.startsWith('/api/drift'))!;
  expect(new URL(driftCall, 'http://local').searchParams.get('state')?.split(',').sort()).toEqual(['broken', 'drifted', 'orphaned']);

  expect(rowsIn('drifted')).toEqual(['REQ-D-1']);
  const row = document.querySelector('[data-review-row="REQ-D-1"]') as HTMLElement;
  expect(within(row).getByTestId('drift-target').textContent).toBe('removedFn');
  expect(within(row).getByText('code changed')).toBeTruthy();
  expect(within(row).getByTestId('drift-fix').textContent).toBe(fixCommand('orphaned', 'REQ-D-1'));
  expect(within(row).getByTestId('drift-fix').textContent).toContain('specship sync');

  // Drifted wins even though every criterion is verified.
  const allVerified = req('REQ-D-2', { code: 1, criteria: [crit('REQ-D-2.A1', 'verified')] });
  const orphan: DriftLink = { specId: 'REQ-D-2', state: 'orphaned', specTitle: null, targetQualifiedName: 'gone' };
  expect(classifyRequirement(allVerified, [orphan]).group).toBe('drifted');
}

// ---- A4 ----

async function reqDashsimple004A4(): Promise<void> {
  const r = req('REQ-P-9', { code: 1, criteria: [crit('REQ-P-9.A1', 'untested')] });
  expect(classifyRequirement(r, [])).toMatchObject({ group: 'pending', tag: 'implemented, unverified' });

  mockFetch(REVIEW_ROUTES);
  render(<ReviewPage project={null} query={{}} />);
  await screen.findByTestId('review-group-pending');
  const row = document.querySelector('[data-review-row="REQ-P-1"]') as HTMLElement;
  expect(row.getAttribute('data-group')).toBe('pending');
  expect(within(row).getByText('implemented, unverified')).toBeTruthy();
  expect(within(document.querySelector('[data-review-row="REQ-U-1"]') as HTMLElement).getByText('unimplemented')).toBeTruthy();
}

// ---- A5 ----

async function reqDashsimple004A5(): Promise<void> {
  // From the tabs: one group shown, filter in the URL.
  mockFetch(REVIEW_ROUTES);
  render(<ReviewPage project={null} query={{}} />);
  await screen.findByTestId('review-group-drifted');
  fireEvent.click(screen.getByRole('radio', { name: /^Pending/ }));
  expect(screen.queryByTestId('review-group-drifted')).toBeNull();
  expect(screen.queryByTestId('review-group-completed')).toBeNull();
  expect(rowsIn('pending')).toEqual(['REQ-P-1', 'REQ-P-2', 'REQ-U-1']);
  expect(location.search).toContain('group=pending');
  cleanup();

  // A `?group=` deep link renders filtered.
  render(<ReviewPage project={null} query={{ group: 'completed' }} />);
  await screen.findByTestId('review-group-completed');
  expect(screen.queryByTestId('review-group-pending')).toBeNull();
  cleanup();

  // From an Overview count: the drift tile opens Review filtered to Drifted.
  history.replaceState(null, '', '/dashboard');
  __clearApiCache();
  mockFetch({
    ...REVIEW_ROUTES,
    '/api/status': STATUS,
    '/api/projects': { claudeRoot: '', projects: [] },
    '/api/workflows/runs': { runs: [] },
  });
  render(<App />);
  const tile = await waitFor(() => {
    const t = document.querySelector<HTMLButtonElement>('[data-overview-count="drifted"] button');
    expect(t).toBeTruthy();
    return t!;
  });
  fireEvent.click(tile);
  await waitFor(() => expect(location.pathname).toBe('/review'));
  expect(location.search).toContain('group=drifted');
  await screen.findByTestId('review-group-drifted');
  expect(screen.queryByTestId('review-group-pending')).toBeNull();
  expect(screen.queryByTestId('review-group-completed')).toBeNull();
}

// ---- A6 (property) ----

function reqDashsimple004A6(): void {
  const states = ['drafted', 'implementing', 'implemented', 'verified'];
  let n = 0;
  for (const code of [0, 1, 3]) {
    for (const codeState of states) {
      for (const testCount of [0, 1, 2]) {
        for (const testState of states) {
          const r = req(`REQ-N-${n++}`, { code, codeState });
          r.testsLinks = rollup(testCount, testState);
          r.verdict = testCount ? (testState === 'verified' ? 'verified' : 'tested') : 'untested';
          const c = classifyRequirement(r, []);
          expect(c.group, r.specId).not.toBe('completed');
          expect(c).toMatchObject({ group: 'pending', tag: 'no acceptance criteria' });
        }
      }
    }
  }
  expect(n).toBeGreaterThan(100);
  // With a drift link it is Drifted (drift wins), but still never Completed.
  for (const s of DRIFT_STATES) {
    const r = req('REQ-N-D', { code: 1 });
    expect(classifyRequirement(r, [{ specId: 'REQ-N-D', state: s, specTitle: null }]).group).toBe('drifted');
  }
}

// ---- A7 ----

async function reqDashsimple004A7(): Promise<void> {
  for (const failing of ['/api/spec/coverage', '/api/drift']) {
    __clearApiCache();
    let fail = true;
    const routes: Record<string, Route> = {
      ...REVIEW_ROUTES,
      [failing]: () => (fail
        ? { ok: false, status: 500, body: { error: 'database is locked' } }
        : { ok: true, body: (REVIEW_ROUTES[failing] as unknown) }),
    };
    const calls = mockFetch(routes);
    render(<ReviewPage project={null} query={{}} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('database is locked');
    expect(screen.queryByTestId('review-group-drifted')).toBeNull();
    expect(screen.queryByTestId('review-group-pending')).toBeNull();
    expect(screen.queryByTestId('review-group-completed')).toBeNull();

    const before = calls.filter((u) => u.startsWith(failing)).length;
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await screen.findByTestId('review-group-drifted');
    expect(calls.filter((u) => u.startsWith(failing)).length).toBe(before + 1);
    cleanup();
  }
}

/** The fix commands Review shows are real CLI commands, not agent slash commands. */
// ---- A8 ----

async function reqDashsimple004A8(): Promise<void> {
  mockFetch(REVIEW_ROUTES);
  render(<ReviewPage project={null} query={{}} />);
  await screen.findByTestId('review-group-drifted'); // requirements are indexed

  const heading = screen.getByText('Pick a requirement to read it');
  const panel = heading.closest('.empty') as HTMLElement;
  expect(panel).toBeTruthy();
  const text = panel.textContent ?? '';
  expect(text).toMatch(/requirement/i);
  expect(text).not.toMatch(/init/i);
  expect(text).not.toMatch(/index/i);
  expect(Array.from(panel.querySelectorAll('code')).some((c) => /specship init/.test(c.textContent ?? ''))).toBe(false);
  expect(within(panel).queryByRole('button')).toBeNull(); // no copy control
}

function fixCommandsExistInCli(): void {
  const cli = readFileSync(join(REPO, 'src', 'bin', 'specship.ts'), 'utf8');
  const shown = [fixCommand('drifted', 'REQ-X-1'), fixCommand('broken', 'REQ-X-1'), fixCommand('orphaned', 'REQ-X-1')];
  for (const cmd of shown) {
    expect(cmd).not.toMatch(/(^|\s)\//); // no `/slash` command
    const m = cmd.match(/specship (\S+)/);
    expect(m, cmd).not.toBeNull();
    expect(cli, `specship ${m![1]} is a commander subcommand`).toMatch(new RegExp(`\\.command\\('${m![1]}[ ']`));
  }
  // `workflow run spec-fix --input SPEC_ID=…` — the option and the workflow exist.
  expect(cli).toContain("'-i, --input <kv...>'");
  expect(readFileSync(join(REPO, 'src', 'workflows', 'defaults', 'spec-fix.yaml'), 'utf8')).toMatch(/name: SPEC_ID/);
}

describe('Review screen (REQ-DASHSIMPLE-004)', () => {
  it('REQ-DASHSIMPLE-004.A1: every requirement appears in exactly one group and the counts add up', reqDashsimple004A1);
  it('REQ-DASHSIMPLE-004.A2: implemented code plus every criterion verified is Completed', reqDashsimple004A2);
  it('REQ-DASHSIMPLE-004.A3: one orphaned link is Drifted even when all criteria are verified, naming target and fix', reqDashsimple004A3);
  it('REQ-DASHSIMPLE-004.A4: code with an untested criterion is Pending, tagged "implemented, unverified"', reqDashsimple004A4);
  it('REQ-DASHSIMPLE-004.A5: tabs and the Overview count filter to one group, and the filter is in the URL', reqDashsimple004A5);
  it('REQ-DASHSIMPLE-004.A6: a requirement with no acceptance criteria is never Completed (property)', reqDashsimple004A6);
  it('REQ-DASHSIMPLE-004.A7: a failed spec or link load shows an error with a working retry', reqDashsimple004A7);
  it('REQ-DASHSIMPLE-004.A8: with requirements indexed and none selected, the detail panel invites picking one and never suggests indexing', reqDashsimple004A8);
  it('REQ-DASHSIMPLE-004: every shown fix command is a real specship subcommand', fixCommandsExistInCli);
});

// Carried over from the retired Drift queue suite (REQ-DESKTOP-022.A4).
describe('Review sidebar badge (REQ-DESKTOP-022.A4)', () => {
  it('the sidebar Review badge equals the drift link count, not the status roll-up', async () => {
    mockFetch({
      ...REVIEW_ROUTES,
      // Deliberately wrong so the test proves the badge uses the link count.
      '/api/status': { ...STATUS, drift: 99 },
      '/api/projects': { claudeRoot: '', projects: [] },
      '/api/workflows/runs': { runs: [] },
      '/api/drift': { links: [...DRIFT, { ...DRIFT[0]!, id: 8 }, { ...DRIFT[0]!, id: 9 }] },
    });
    history.replaceState(null, '', '/runs');
    render(<App />);
    const navItem = () =>
      screen.getAllByText('Review').find((e) => e.closest('a'))!.closest('a') as HTMLElement;
    await waitFor(() => expect(within(navItem()).getByText('3')).toBeTruthy());
    expect(within(navItem()).queryByText('99')).toBeNull();
  });
});
