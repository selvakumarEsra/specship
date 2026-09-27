/**
 * REQ-TVIZ-006 / -009 / -010 — the spec detail pane as an evidence surface.
 *
 * 006: links split into "Linked code" and "Proving tests" with a kind pill per
 *      row (A1), a tested/untested headline derived from `tests` links alone
 *      (A2), and a criteria rollup that refuses to count an `implements`-only
 *      criterion as met (A3).
 * 009: the Verify action posts to /api/spec/link-verify and renders a
 *      `no_test_evidence` refusal as the next action to take (A1).
 * 010: every link row shows its drift age (A2).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecDetail, criterionMet, testVerdict } from '../components/spec-detail';
import type { LinkedSpec } from '../api';

const NOW = Date.now();

const IMPL_LINK = {
  id: 11, specId: 'REQ-T-1', kind: 'implements', state: 'implemented',
  targetFilePath: 'src/auth.ts', targetQualifiedName: 'validateSession',
  provenance: 'spec-declaration', resolvedNodeId: 'node-1', updatedAt: NOW - 7_200_000,
};

const TEST_LINK = {
  id: 12, specId: 'REQ-T-1', kind: 'tests', state: 'verified',
  targetFilePath: '__tests__/auth.test.ts', targetQualifiedName: 'rejects an expired token',
  provenance: 'spec-declaration', resolvedNodeId: 'node-2', updatedAt: NOW - 86_400_000,
};

/** Implementation + proving test; two criteria, only one test-proven. */
const PROVEN = {
  spec: { id: 'REQ-T-1', kind: 'requirement', title: 'Validate session token', body: 'The server MUST validate.', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
  parent: { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' },
  siblings: [],
  children: [
    { id: 'REQ-T-1.A1', kind: 'acceptance', title: 'A1', body: 'Proven by a test.', parentId: 'REQ-T-1' },
    { id: 'REQ-T-1.A2', kind: 'acceptance', title: 'A2', body: 'Implemented only.', parentId: 'REQ-T-1' },
  ],
  links: [IMPL_LINK, TEST_LINK],
  childLinks: {
    'REQ-T-1.A1': [{ id: 21, specId: 'REQ-T-1.A1', kind: 'tests', state: 'verified' }],
    'REQ-T-1.A2': [{ id: 22, specId: 'REQ-T-1.A2', kind: 'implements', state: 'verified' }],
  },
  source: null,
};

/** Implementation only — the untested case the coverage rule exists for. */
const UNTESTED = {
  ...PROVEN,
  spec: { ...PROVEN.spec, id: 'REQ-T-2', title: 'Rotate signing keys' },
  children: [],
  childLinks: {},
  links: [{ ...IMPL_LINK, id: 31, specId: 'REQ-T-2' }],
};

function mockFetch(routes: Record<string, unknown>, posts?: Array<{ url: string; body: unknown }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://local');
    if (init?.method === 'POST') {
      posts?.push({ url: u.pathname, body: JSON.parse(String(init.body)) });
    }
    const body = routes[u.pathname];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found' }) };
    }
    if (body && typeof body === 'object' && '__status' in (body as Record<string, unknown>)) {
      const b = body as { __status: number; payload: unknown };
      return { ok: false, status: b.__status, statusText: 'Conflict', json: async () => b.payload };
    }
    return { ok: true, json: async () => body };
  }));
}

beforeEach(() => { history.replaceState(null, '', '/specs'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('testVerdict / criterionMet (REQ-TVIZ-006)', () => {
  const link = (kind: string, state: string) => ({ specId: 'x', kind, state }) as LinkedSpec;

  it('A2: a verdict derives from `tests` links only', () => {
    expect(testVerdict([])).toBe('untested');
    expect(testVerdict([link('implements', 'verified')])).toBe('untested');
    expect(testVerdict([link('tests', 'implemented')])).toBe('tested');
    expect(testVerdict([link('tests', 'verified')])).toBe('verified');
    expect(testVerdict([link('tests', 'verified'), link('tests', 'broken')])).toBe('broken');
  });

  it('A3: an implements-only criterion is never met, whatever its link state', () => {
    expect(criterionMet([link('implements', 'verified')])).toBe(false);
    expect(criterionMet([link('tests', 'implemented')])).toBe(false);
    expect(criterionMet([link('tests', 'verified')])).toBe(true);
  });
});

describe('SpecDetail evidence surface (REQ-TVIZ-006)', () => {
  it('A1: groups links into Linked code and Proving tests, with a kind pill per row', async () => {
    mockFetch({ '/api/spec/REQ-T-1': PROVEN });
    const { container } = render(<SpecDetail id="REQ-T-1" project={null} />);
    await screen.findByRole('heading', { name: 'Validate session token' });

    const sections = Array.from(container.querySelectorAll('.sp-sec'));
    const code = sections.find((s) => s.textContent?.startsWith('Linked code'))!;
    const tests = sections.find((s) => s.textContent?.startsWith('Proving tests'))!;

    // The implements link is under code; the tests link is NOT.
    expect(within(code as HTMLElement).getByText('src/auth.ts:validateSession')).toBeTruthy();
    expect(within(code as HTMLElement).queryByText(/auth.test.ts/)).toBeNull();
    expect(within(tests as HTMLElement).getByText('__tests__/auth.test.ts:rejects an expired token')).toBeTruthy();

    // Kind pill on each row (A1).
    expect(within(code as HTMLElement).getByText('implements')).toBeTruthy();
    expect(within(tests as HTMLElement).getByText('tests')).toBeTruthy();

    // Drift age per link row (REQ-TVIZ-010.A2).
    expect(within(code as HTMLElement).getByText('2h')).toBeTruthy();
    expect(within(tests as HTMLElement).getByText('1d')).toBeTruthy();
  });

  it('A2: the headline states test-verified when a proving test passes', async () => {
    mockFetch({ '/api/spec/REQ-T-1': PROVEN });
    render(<SpecDetail id="REQ-T-1" project={null} />);
    await screen.findByRole('heading', { name: 'Validate session token' });
    expect(within(screen.getByTestId('coverage-fact')).getByText('Test-verified')).toBeTruthy();
  });

  it('A2: an implements-only spec reads Untested and says so where the tests go', async () => {
    mockFetch({ '/api/spec/REQ-T-2': UNTESTED });
    render(<SpecDetail id="REQ-T-2" project={null} />);
    await screen.findByRole('heading', { name: 'Rotate signing keys' });

    expect(within(screen.getByTestId('coverage-fact')).getByText('Untested')).toBeTruthy();
    expect(screen.getByText(/No proving test/)).toBeTruthy();
    // The implementation link is still present — untested ≠ unimplemented.
    expect(screen.getByText('src/auth.ts:validateSession')).toBeTruthy();
  });

  it('A3: the criteria rollup counts only test-proven criteria', async () => {
    mockFetch({ '/api/spec/REQ-T-1': PROVEN });
    render(<SpecDetail id="REQ-T-1" project={null} />);
    await screen.findByRole('heading', { name: 'Validate session token' });

    // A2 carries a VERIFIED implements link and still doesn't count.
    expect(screen.getByText('1 / 2 met')).toBeTruthy();
    expect(screen.getByText('untested')).toBeTruthy();
  });
});

describe('Verify action (REQ-TVIZ-009.A1)', () => {
  it('A1: posts the unverified implements link to /api/spec/link-verify', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    mockFetch({ '/api/spec/REQ-T-1': PROVEN, '/api/spec/link-verify': { ok: true, state: 'verified' } }, posts);
    render(<SpecDetail id="REQ-T-1" project={null} />);
    await screen.findByRole('heading', { name: 'Validate session token' });

    fireEvent.click(screen.getByText('Verify').closest('button')!);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe('/api/spec/link-verify');
    // Only the implements link is promoted, and only the unverified one.
    expect(posts[0]!.body).toEqual({ link_id: 11, result: 'pass' });
    await screen.findByText('Verified 1 link.');
  });

  it('A1: a no_test_evidence refusal renders as the next action, not a raw error', async () => {
    mockFetch({
      '/api/spec/REQ-T-2': UNTESTED,
      '/api/spec/link-verify': { __status: 409, payload: { error: 'no test evidence linked to REQ-T-2', code: 'no_test_evidence' } },
    });
    render(<SpecDetail id="REQ-T-2" project={null} />);
    await screen.findByRole('heading', { name: 'Rotate signing keys' });

    fireEvent.click(screen.getByText('Verify').closest('button')!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Declare a proving test first');
    expect(alert.textContent).toContain('verifies:');
  });
});
