/**
 * REQ-TVIZ-008 — the traceability matrix: one row per requirement with code
 * links, proving-test links, criteria N/M, rolled-up state and drift age (A1),
 * backed by the Wave 2 coverage rollup rather than a third local derivation
 * (A2), each row opening that requirement's detail (A3).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceabilityPage, buildRows, type MatrixRow } from '../pages/traceability';
import type { RequirementCoverage } from '../api';

const NOW = Date.now();

function cov(
  specId: string,
  code: number,
  tests: number,
  withTests: number,
  count: number,
  verdict: RequirementCoverage['verdict'],
): RequirementCoverage {
  return {
    specId, title: specId + ' title', kind: 'requirement',
    implementsLinks: { count: code, states: {} },
    testsLinks: { count: tests, states: {} },
    verdict, criteria: [],
    criteriaTotals: { untested: 0, tested: 0, verified: 0, broken: 0 },
    criteriaWithTests: withTests, criteriaCount: count,
  };
}

const COVERAGE = {
  specId: null,
  requirements: [
    cov('REQ-A-1', 2, 1, 3, 3, 'verified'),
    cov('REQ-A-2', 1, 0, 0, 2, 'untested'),
    cov('REQ-I-1', 0, 2, 1, 2, 'broken'),
  ],
  totals: { requirements: 3, criteria: 7, criteriaWithTests: 4, criteriaVerified: 3, criteriaBroken: 1 },
};

const SPECS = {
  specs: [
    { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' },
    { id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    { id: 'REQ-A-2', kind: 'requirement', title: 'Reject expired tokens', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    { id: 'INGEST-DOC', kind: 'document', title: 'Ingest', sourcePath: 'specs/ingest.md' },
    { id: 'REQ-I-1', kind: 'requirement', title: 'Tail JSONL', sourcePath: 'specs/ingest.md', parentId: 'INGEST-DOC' },
  ],
  linkStates: {},
};

const DRIFT = {
  links: [
    { id: 1, specId: 'REQ-I-1', state: 'broken', specTitle: 'Tail JSONL', updatedAt: NOW - 3 * 86_400_000 },
    { id: 2, specId: 'REQ-A-2', state: 'drifted', specTitle: 'Reject expired tokens', updatedAt: NOW - 3_600_000 },
  ],
};

const ROUTES: Record<string, unknown> = {
  '/api/spec/coverage': COVERAGE,
  '/api/specs': SPECS,
  '/api/drift': DRIFT,
};

function mockFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    const body = routes[u.pathname];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    }
    return { ok: true, json: async () => body };
  }));
  return calls;
}

/** Data rows only — the header band is not inside role="table". */
function rows(): HTMLElement[] {
  return screen.getAllByRole('row');
}

beforeEach(() => { history.replaceState(null, '', '/traceability'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('buildRows (REQ-TVIZ-008.A1)', () => {
  const docs = new Map([['REQ-A-1', 'auth.md'], ['REQ-A-2', 'auth.md'], ['REQ-I-1', 'ingest.md']]);
  const drift = new Map([['REQ-I-1', NOW - 3 * 86_400_000]]);
  const ids = (r: MatrixRow[]) => r.map((x) => x.specId);

  it('sorts by test-link count, criteria proportion, and state', () => {
    expect(ids(buildRows(COVERAGE.requirements, docs, drift, 'tests', false))).toEqual(['REQ-I-1', 'REQ-A-1', 'REQ-A-2']);
    // 3/3 beats 1/2 beats 0/2 — a proportion, not a raw numerator.
    expect(ids(buildRows(COVERAGE.requirements, docs, drift, 'criteria', false))).toEqual(['REQ-A-1', 'REQ-I-1', 'REQ-A-2']);
    // Worst state first: broken, then untested, then verified.
    expect(ids(buildRows(COVERAGE.requirements, docs, drift, 'state', true))).toEqual(['REQ-I-1', 'REQ-A-2', 'REQ-A-1']);
  });

  it('sorts clean rows last by drift age, in both directions', () => {
    expect(ids(buildRows(COVERAGE.requirements, docs, drift, 'drift', true))[0]).toBe('REQ-I-1');
    expect(ids(buildRows(COVERAGE.requirements, docs, drift, 'drift', false)).slice(-1)[0]).toBe('REQ-I-1');
  });
});

describe('TraceabilityPage (REQ-TVIZ-008)', () => {
  it('A1/A2: renders one row per requirement from the coverage rollup, with drift age', async () => {
    const calls = mockFetch(ROUTES);
    render(<TraceabilityPage project={null} query={{}} />);

    await screen.findByText('REQ-A-1');
    expect(calls.some((c) => c.startsWith('/api/spec/coverage'))).toBe(true);
    expect(rows()).toHaveLength(3);

    const r1 = within(rows()[0]!);
    expect(r1.getByText('REQ-A-1')).toBeTruthy();
    expect(r1.getByText('auth.md')).toBeTruthy();
    expect(r1.getByTitle('2 code link(s)').textContent).toBe('2');
    expect(r1.getByTitle('1 proving test link(s)').textContent).toBe('1');
    expect(r1.getByText('3 / 3')).toBeTruthy();
    expect(r1.getByText('Verified')).toBeTruthy();

    // Drift age comes from the queue; a clean requirement shows no age.
    expect(within(rows()[2]!).getByText('3d')).toBeTruthy();
    expect(within(rows()[0]!).getByTitle('No drifted, broken, or orphaned link').textContent).toBe('—');

    // Header summary quotes the rollup's own totals, not a recount.
    expect(screen.getByText(/4 of 7 criteria have a proving test/)).toBeTruthy();
  });

  it('A1: sorting by a column header reorders, and clicking again reverses', async () => {
    mockFetch(ROUTES);
    render(<TraceabilityPage project={null} query={{}} />);
    await screen.findByText('REQ-A-1');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Tests' }));
    await waitFor(() => expect(within(rows()[0]!).getByText('REQ-A-2')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Tests' }));
    await waitFor(() => expect(within(rows()[0]!).getByText('REQ-I-1')).toBeTruthy());
  });

  it('A1: filters by document and by state', async () => {
    mockFetch(ROUTES);
    render(<TraceabilityPage project={null} query={{}} />);
    await screen.findByText('REQ-A-1');

    fireEvent.change(screen.getByLabelText('Filter by document'), { target: { value: 'ingest.md' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('REQ-I-1')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by document'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: 'untested' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('REQ-A-2')).toBeTruthy();

    // A filter combination that matches nothing says so.
    fireEvent.change(screen.getByLabelText('Filter by document'), { target: { value: 'ingest.md' } });
    await screen.findByText('No requirement matches these filters.');
  });

  it('A3: clicking a row opens that requirement on the Specs screen', async () => {
    mockFetch(ROUTES);
    render(<TraceabilityPage project={null} query={{}} />);
    await screen.findByText('REQ-A-1');

    fireEvent.click(rows()[1]!);
    expect(location.pathname).toBe('/specs');
    expect(location.search).toContain('sel=REQ-A-2');
  });

  it('A2: a missing coverage endpoint renders a clean unavailable state, not invented numbers', async () => {
    const routes = { ...ROUTES };
    delete routes['/api/spec/coverage'];
    mockFetch(routes);
    render(<TraceabilityPage project={null} query={{}} />);

    await screen.findByText('Coverage endpoint unavailable');
    expect(screen.getByText(/will not guess at coverage/)).toBeTruthy();
    expect(screen.queryByRole('row')).toBeNull();

    // Retry picks the endpoint up once the server can answer.
    routes['/api/spec/coverage'] = COVERAGE;
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByText('REQ-A-1');
  });

  it('renders an explicit empty state when the project has no requirements', async () => {
    mockFetch({ ...ROUTES, '/api/spec/coverage': { specId: null, requirements: [], totals: { requirements: 0, criteria: 0, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0 } } });
    render(<TraceabilityPage project={null} query={{}} />);
    await screen.findByText('No requirements indexed');
  });
});
