/**
 * The shared spec read view (components/spec-detail.tsx) — the approved
 * read-view scope of REQ-DESKTOP-001…005 and 012: section order + copy-id +
 * state accent (001), escaped keyword decoration incl. XSS and word
 * boundaries (002), criterion marks / segment bar / met rollup (003), linked
 * code and the orphaned alarm (004), workflow-gated actions (005), and the
 * guidance / skeleton / error-retry / unknown-state safety states (012).
 *
 * These suites used to drive the pane through the Specs screen; Review
 * replaced that screen (REQ-DASHSIMPLE-004), so they render the pane directly
 * and keep one deep-link case through Review itself.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecDetail } from '../components/spec-detail';
import { ReviewPage } from '../pages/review';
import { reviewRoutesFromSpecs } from './review-fixtures';

const NOW = Date.now();

const SPECS = {
  specs: [
    { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' },
    { id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    { id: 'REQ-A-2', kind: 'requirement', title: 'Reject expired tokens', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    { id: 'INGEST-DOC', kind: 'document', title: 'Ingest', sourcePath: 'specs/ingest.md' },
    { id: 'REQ-I-1', kind: 'requirement', title: 'Tail JSONL incrementally', sourcePath: 'specs/ingest.md', parentId: 'INGEST-DOC' },
  ],
  linkStates: { 'REQ-A-1': 'verified', 'REQ-A-2': 'drifted' },
};

const AUTH_DOC = { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' };

const DETAIL_A1 = {
  spec: {
    id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token',
    body: 'The server MUST validate the session token before **any** handler runs, using `validateSession`.',
    sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC', priority: 'P0', owner: 'selva',
  },
  parent: AUTH_DOC,
  siblings: [],
  children: [
    { id: 'REQ-A-1.A1', kind: 'acceptance', title: 'A1', body: 'Every route calls `validateSession`.', parentId: 'REQ-A-1' },
    { id: 'REQ-A-1.A2', kind: 'acceptance', title: 'A2', body: 'Invalid signatures are rejected.', parentId: 'REQ-A-1' },
    { id: 'REQ-A-1.A3', kind: 'acceptance', title: 'A3', body: 'Revoked tokens stop working.', parentId: 'REQ-A-1' },
  ],
  links: [{
    id: 1, specId: 'REQ-A-1', kind: 'implements', state: 'verified',
    targetFilePath: 'src/auth.ts', targetQualifiedName: 'validateSession',
    provenance: 'agent-asserted', resolvedNodeId: 'node-7', updatedAt: NOW - 7_200_000,
  }],
  childLinks: {
    // A1 is proven by a verified test → met. A2 has an implements link in the
    // best possible state and STILL isn't met: implementation is not evidence
    // (REQ-TVIZ-006.A3). A3 has nothing at all.
    'REQ-A-1.A1': [{ specId: 'REQ-A-1.A1', kind: 'tests', state: 'verified' }],
    'REQ-A-1.A2': [{ specId: 'REQ-A-1.A2', kind: 'implements', state: 'verified' }],
    'REQ-A-1.A3': [],
  },
  source: null,
};

// Drifted rollup (pulse + warn accent), one unknown-state link, an axis pill,
// no owner, and a body that tries XSS and keyword lookalikes.
const DETAIL_A2 = {
  spec: {
    id: 'REQ-A-2', kind: 'requirement', title: 'Reject expired tokens',
    body: 'MUSTARD is not a keyword and dismay is prose, but the server MUST reject <script>alert(1)</script> payloads.',
    sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC',
  },
  parent: AUTH_DOC,
  siblings: [],
  children: [],
  links: [
    { id: 2, specId: 'REQ-A-2', kind: 'implements', state: 'drifted', driftAxis: 'code', targetFilePath: 'src/auth.ts', targetQualifiedName: 'rejectExpired', provenance: 'agent-asserted', updatedAt: NOW - 60_000 },
    { id: 3, specId: 'REQ-A-2', kind: 'implements', state: 'wibble', targetFilePath: 'src/auth.ts', targetQualifiedName: 'expiryClock', provenance: 'heuristic', updatedAt: NOW - 60_000 },
  ],
  childLinks: {},
  source: null,
};

// Zero links (orphaned alarm) and zero criteria (section omitted).
const DETAIL_I1 = {
  spec: {
    id: 'REQ-I-1', kind: 'requirement', title: 'Tail JSONL incrementally',
    body: 'The watcher SHOULD tail the transcript.',
    sourcePath: 'specs/ingest.md', parentId: 'INGEST-DOC',
  },
  parent: { id: 'INGEST-DOC', kind: 'document', title: 'Ingest', sourcePath: 'specs/ingest.md' },
  siblings: [],
  children: [],
  links: [],
  childLinks: {},
  source: null,
};

function routesWithDetails(): Record<string, unknown> {
  return {
    '/api/specs': SPECS,
    ...reviewRoutesFromSpecs(SPECS),
    '/api/spec/REQ-A-1': DETAIL_A1,
    '/api/spec/REQ-A-2': DETAIL_A2,
    '/api/spec/REQ-I-1': DETAIL_I1,
  };
}

/** Pathname-keyed fetch mock; the map stays live so tests can mutate it. */
function mockFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    // Fastify decodes path params; a spec id like `brief:sso` arrives encoded.
    const body = routes[decodeURIComponent(u.pathname)];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    }
    return { ok: true, json: async () => body };
  }));
  return calls;
}

beforeEach(() => {
  history.replaceState(null, '', '/review');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SpecDetail read view (REQ-DESKTOP-001…005, 012)', () => {
  it('A1: shows guidance with no selection, then a skeleton and the detail contract for a selection', async () => {
    const calls = mockFetch(routesWithDetails());
    const none = render(<SpecDetail id={null} project={null} />);

    // No-selection guidance with the copyable command (REQ-DESKTOP-012.A1).
    expect(screen.getByText('Pick a requirement to read it')).toBeTruthy();
    expect(screen.getByText('specship init -i')).toBeTruthy();
    none.unmount();

    // Skeleton shimmer appears immediately on selection (REQ-DESKTOP-012.A2)…
    const { container } = render(<SpecDetail id="REQ-A-1" project={null} />);
    expect(screen.getByTestId('spec-skeleton')).toBeTruthy();

    // …then the detail contract renders in reading order (REQ-DESKTOP-001.A1).
    await screen.findByRole('heading', { name: 'Validate session token' });
    expect(calls).toContain('/api/spec/REQ-A-1');
    expect(screen.getByText('specs/auth.md')).toBeTruthy();          // breadcrumb doc path
    expect(screen.getByText('P0')).toBeTruthy();                     // priority pill
    expect(screen.getByText('selva')).toBeTruthy();                  // owner
    expect(screen.getByText('1 / 3 met')).toBeTruthy();              // acceptance rollup (test-proven only)
    expect(screen.getByText('src/auth.ts:validateSession')).toBeTruthy(); // linked code target
    expect(screen.getByText('agent-asserted')).toBeTruthy();         // provenance pill

    // Verified metaline fact uses the relative timestamp, not a placeholder.
    expect(screen.getByText('2h ago')).toBeTruthy();

    // Statement accent edge takes the state color token (REQ-DESKTOP-001.A3).
    const statement = container.querySelector('.sp-statement') as HTMLElement;
    expect(statement.getAttribute('style')).toContain('--sp-accent: var(--accent)'); // verified → accent (REQ-DASHTHEME-001)

    // Copy-id control confirms in the success token (REQ-DESKTOP-001.A2).
    const copy = within(container.querySelector('.sp-breadcrumb') as HTMLElement).getByTitle('Copy');
    fireEvent.click(copy);
    expect((copy as HTMLElement).style.color).toBe('var(--success)');

    // Workflow-gated actions (REQ-DESKTOP-005.A1) + editor gate note.
    const implement = screen.getByText('Implement').closest('button') as HTMLButtonElement;
    expect(implement.disabled).toBe(true);
    expect(implement.title).toContain('implementation workflow');
    // Verify is live now (REQ-TVIZ-009.A1); this spec's only implements link
    // is already verified, so there is nothing to promote.
    const verify = screen.getByText('Verify').closest('button') as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    expect(verify.title).toContain('Nothing to verify');
    // Edit enables only when the raw source is available (REQ-DESKTOP-005);
    // these fixtures ship source: null, so it stays disabled with the reason.
    const edit = screen.getByText('Edit spec').closest('button') as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toContain('Source file not available');
    const showInGraph = screen.getByText('Show in graph').closest('button') as HTMLButtonElement;
    expect(showInGraph.disabled).toBe(false);
  });

  it('A1: a retired ?sel= deep-link still opens that requirement in Review', async () => {
    mockFetch(routesWithDetails());
    render(<ReviewPage project={null} query={{ sel: 'REQ-I-1' }} />);
    await screen.findByRole('heading', { name: 'Tail JSONL incrementally' });
  });

  it('002: keyword chips operate on escaped, word-bounded text — script tags render literal', async () => {
    mockFetch(routesWithDetails());
    const { container } = render(<SpecDetail id="REQ-A-2" project={null} />);
    await screen.findByRole('heading', { name: 'Reject expired tokens' });

    // No element from the body is parsed into the page (002.A3).
    expect(container.querySelector('script')).toBeNull();
    const prose = container.querySelector('.sp-statement .sp-prose') as HTMLElement;
    expect(prose.textContent).toContain('<script>alert(1)</script>');

    // Word boundaries: only the standalone MUST is chipped (002.A2).
    const kws = Array.from(container.querySelectorAll('.sp-statement .sp-kw')).map((e) => e.textContent);
    expect(kws).toEqual(['MUST']);
    expect(container.querySelector('.sp-kw-must')).toBeTruthy();
    expect(prose.textContent).toContain('MUSTARD');
    expect(prose.textContent).toContain('dismay');

    // Drifted rollup: pulse pill + warn accent + neutral owner placeholder (001.A4).
    const metaPill = container.querySelector('.sp-metaline .pill') as HTMLElement;
    expect(metaPill.textContent).toBe('Drifted');
    expect(metaPill.style.animation).toContain('pulsePill');
    const statement = container.querySelector('.sp-statement') as HTMLElement;
    expect(statement.getAttribute('style')).toContain('--sp-accent: var(--danger)'); // drifted → danger (REQ-DASHTHEME-001)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2); // owner + verified placeholders

    // Axis pill on the drifted link (004.A2), and the unknown-state link
    // renders the info treatment instead of crashing (012.A4).
    expect(screen.getByText('code drift')).toBeTruthy();
    expect(screen.getByText('Info')).toBeTruthy();
  });

  it('002.A4 + 003: code/bold decorate every prose surface; marks, segment bar, and rollup follow the data', async () => {
    mockFetch(routesWithDetails());
    const { container } = render(<SpecDetail id="REQ-A-1" project={null} />);
    await screen.findByRole('heading', { name: 'Validate session token' });

    // Inline code + bold render in the statement and in criterion text alike.
    expect(container.querySelector('.sp-statement .sp-code')?.textContent).toBe('validateSession');
    expect(container.querySelector('.sp-statement strong')?.textContent).toBe('any');
    expect(container.querySelector('.sp-crit-text .sp-code')?.textContent).toBe('validateSession');

    // Exactly one row and one equal-width segment per criterion (003.A2/A4).
    expect(container.querySelectorAll('.sp-crit')).toHaveLength(3);
    const segments = Array.from(container.querySelectorAll('.row.gap-4 > div'));
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.getAttribute('title'))).toEqual([
      'A1 · Verified', 'A2 · Verified', 'A3 · Pending',
    ]);

    // Mark classes: two met checks, one hollow ring for pending (003.A1).
    const marks = Array.from(container.querySelectorAll('.sp-crit-mark'));
    expect(marks).toHaveLength(3);
    expect(marks[0]!.querySelector('svg')).toBeTruthy();  // verified → glyph
    expect(marks[1]!.querySelector('svg')).toBeTruthy();  // verified link → glyph
    expect(marks[2]!.querySelector('svg')).toBeNull();    // pending → hollow ring
    expect(marks[2]!.querySelector('span')).toBeTruthy();

    // Rollup is muted while unmet (003.A3).
    const rollup = screen.getByText('1 / 3 met') as HTMLElement;
    expect(rollup.style.color).toBe('var(--text-muted)');
  });

  it('004.A3 + 003.A4: zero links renders the orphaned alarm card; zero criteria omits the section', async () => {
    mockFetch(routesWithDetails());
    const { container } = render(<SpecDetail id="REQ-I-1" project={null} />);
    await screen.findByRole('heading', { name: 'Tail JSONL incrementally' });

    const alarm = screen.getByText(/Orphaned — no code implements this requirement yet/);
    expect((alarm.closest('.card') as HTMLElement).style.color).toBe('var(--error)');
    expect(screen.queryByText('Acceptance criteria')).toBeNull();
  });

  it('012.A3: a failed detail fetch renders an error with a working retry', async () => {
    const routes = routesWithDetails();
    delete routes['/api/spec/REQ-A-1'];
    mockFetch(routes);
    render(<SpecDetail id="REQ-A-1" project={null} />);

    await screen.findByText(/Couldn.t load REQ-A-1/);
    routes['/api/spec/REQ-A-1'] = DETAIL_A1;
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByRole('heading', { name: 'Validate session token' });
  });

});

describe('SpecDetail idea read view (REQ-TVIZ-007.A3)', () => {
  it('A3: an idea-stage brief opens the idea read view, not a requirement view', async () => {
    const routes = routesWithDetails();
    routes['/api/spec/brief:rate-limits'] = {
      spec: { id: 'brief:rate-limits', kind: 'brief', title: 'Brainstorm: rate limits', body: 'What if we **capped** bursts?', sourcePath: 'specs/rate-limits/brief.md', metadata: { created: '2026-09-01' } },
      parent: null, siblings: [], children: [], links: [], childLinks: {}, source: null,
    };
    mockFetch(routes);
    render(<SpecDetail id="brief:rate-limits" project={null} />);
    await screen.findByRole('heading', { name: 'Brainstorm: rate limits' });
    expect(screen.getByText('Idea')).toBeTruthy();
    expect(screen.getByText('Brief')).toBeTruthy();
  });
});
