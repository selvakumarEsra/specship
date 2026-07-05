/**
 * REQ-DESKTOP-006…011 — the inline structured spec editor: in-place
 * read/edit swap with a selection-scoped draft (006), dirty-by-value save
 * gating (007), system-managed read-only status (008), structured fields
 * with the live keyword preview reusing the read view's decoration (009,
 * closing 002.A4), the criteria editor with positional A-renumbering (010),
 * and section-scoped serialization through PUT /api/spec/:id with
 * byte-preservation outside the edited requirement, keep-draft failure, and
 * the "saved but not yet indexed" sync-lag hint (011).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecsPage } from '../pages/specs';
import { normalizeSectionDraft, parseRequirementSection, serializeRequirementSection } from '../spec-source';

const STATEMENT = 'The server MUST validate the session token before **any** handler runs, using `validateSession`.';

const SOURCE = `---
id: AUTH-DOC
title: Auth
owner: web
---

<!-- id: AUTH-DOC -->
# Auth

Intro prose that must stay byte-identical.

<!-- id: REQ-A-1 -->
## Validate session token

${STATEMENT}

implementations:
  - src/auth.ts:validateSession

## Acceptance
<!-- id: REQ-A-1.A1 -->
- Every route calls \`validateSession\`.
<!-- id: REQ-A-1.A2 -->
- Invalid signatures are rejected.
<!-- id: REQ-A-1.A3 -->
- Revoked tokens stop working.

<!-- id: REQ-A-2 -->
## Reject expired tokens

Expired tokens MUST be rejected.
`;

/** SOURCE after: title edited + criterion A2 removed (renumbered). Everything
 * outside REQ-A-1's marker-to-marker slice is byte-identical (011.A1). */
const EXPECTED_AFTER_SAVE = `---
id: AUTH-DOC
title: Auth
owner: web
---

<!-- id: AUTH-DOC -->
# Auth

Intro prose that must stay byte-identical.

<!-- id: REQ-A-1 -->
## Validate session token strictly

${STATEMENT}

implementations:
  - src/auth.ts:validateSession

## Acceptance
<!-- id: REQ-A-1.A1 -->
- Every route calls \`validateSession\`.
<!-- id: REQ-A-1.A2 -->
- Revoked tokens stop working.

<!-- id: REQ-A-2 -->
## Reject expired tokens

Expired tokens MUST be rejected.
`;

const SPECS = {
  specs: [
    { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' },
    { id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    { id: 'REQ-A-2', kind: 'requirement', title: 'Reject expired tokens', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
  ],
  linkStates: { 'REQ-A-1': 'verified' },
};

const AUTH_DOC = { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' };

const DETAIL_A1 = {
  spec: {
    id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token',
    body: STATEMENT, sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC',
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
    targetFilePath: 'src/auth.ts', targetQualifiedName: 'validateSession', provenance: 'agent-asserted',
  }],
  childLinks: {
    'REQ-A-1.A1': [{ specId: 'REQ-A-1.A1', kind: 'verifies', state: 'verified' }],
    'REQ-A-1.A2': [{ specId: 'REQ-A-1.A2', kind: 'verifies', state: 'implemented' }],
    'REQ-A-1.A3': [],
  },
  source: SOURCE,
};

// Zero links (drafted), zero criteria — the AutoStatus drafted leg and the
// criteria editor's zero-rows hint.
const DETAIL_A2 = {
  spec: {
    id: 'REQ-A-2', kind: 'requirement', title: 'Reject expired tokens',
    body: 'Expired tokens MUST be rejected.', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC',
  },
  parent: AUTH_DOC,
  siblings: [],
  children: [],
  links: [],
  childLinks: {},
  source: SOURCE,
};

interface Call { url: string; method: string; body?: { content?: string } }
type RouteVal = unknown | ((body: unknown) => { status?: number; body: unknown });

/** Method+pathname-keyed fetch mock ("PUT /api/spec/X"; bare path = GET).
 * The map stays live so handlers can swap in post-save detail responses. */
function mockFetch(routes: Record<string, RouteVal>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const reqBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body: reqBody });
    const u = new URL(url, 'http://local');
    const key = method === 'GET' ? u.pathname : `${method} ${u.pathname}`;
    const val = routes[key];
    if (val === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + key }) };
    }
    const out = typeof val === 'function'
      ? (val as (b: unknown) => { status?: number; body: unknown })(reqBody)
      : { body: val };
    const status = out.status ?? 200;
    return { ok: status < 400, status, statusText: String(status), json: async () => out.body };
  }));
  return calls;
}

function baseRoutes(): Record<string, RouteVal> {
  return {
    '/api/specs': SPECS,
    '/api/spec/REQ-A-1': DETAIL_A1,
    '/api/spec/REQ-A-2': DETAIL_A2,
  };
}

/** The 280px tree pane — first child of the page's flex row. */
function treePane(container: HTMLElement): HTMLElement {
  return (container.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
}

async function openEditor(sel = 'REQ-A-1', routes = baseRoutes()) {
  const calls = mockFetch(routes);
  const view = render(<SpecsPage project={null} query={{ sel }} />);
  await screen.findByText('Edit spec');
  fireEvent.click(screen.getByText('Edit spec').closest('button')!);
  return { calls, routes, ...view };
}

const titleInput = () => screen.getByLabelText('Title') as HTMLInputElement;
const saveBtn = () => screen.getAllByText(/Save changes|Saving…/)[0]!.closest('button') as HTMLButtonElement;
const cancelBtn = () => screen.getAllByText('Cancel')[0]!.closest('button') as HTMLButtonElement;

beforeEach(() => {
  history.replaceState(null, '', '/specs');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('spec-source (REQ-DESKTOP-011 unit)', () => {
  it('parses the requirement section: title, statement, criteria', () => {
    const s = parseRequirementSection(SOURCE, 'REQ-A-1')!;
    expect(s.title).toBe('Validate session token');
    expect(s.statement).toBe(STATEMENT);
    expect(s.criteria.map((c) => c.id)).toEqual(['REQ-A-1.A1', 'REQ-A-1.A2', 'REQ-A-1.A3']);
    expect(s.criteria[1]!.text).toBe('Invalid signatures are rejected.');
    expect(parseRequirementSection(SOURCE, 'REQ-NOPE')).toBeNull();
  });

  it('round-trips an unchanged draft byte-identically (both sections)', () => {
    for (const id of ['REQ-A-1', 'REQ-A-2']) {
      const s = parseRequirementSection(SOURCE, id)!;
      const out = serializeRequirementSection(SOURCE, id, normalizeSectionDraft({
        title: s.title, statement: s.statement, criteria: s.criteria,
      }));
      expect(out).toBe(SOURCE);
    }
  });

  it('normalizes at save: trims fields, drops empty criteria, renumbers (011.A4)', () => {
    const norm = normalizeSectionDraft({
      title: '  Padded title  ',
      statement: '\nBody.\n',
      criteria: [{ text: ' keep ' }, { text: '   ' }, { text: 'also keep' }],
    });
    expect(norm.title).toBe('Padded title');
    expect(norm.statement).toBe('Body.');
    expect(norm.criteria).toEqual([{ text: 'keep' }, { text: 'also keep' }]);

    const out = serializeRequirementSection(SOURCE, 'REQ-A-1', norm)!;
    expect(out).toContain('## Padded title');
    expect(out).toContain('<!-- id: REQ-A-1.A1 -->\n- keep');
    expect(out).toContain('<!-- id: REQ-A-1.A2 -->\n- also keep');
    expect(out).not.toContain('REQ-A-1.A3');
    // The sibling requirement and frontmatter are untouched.
    expect(out).toContain('<!-- id: REQ-A-2 -->\n## Reject expired tokens');
    expect(out.startsWith('---\nid: AUTH-DOC')).toBe(true);
  });

  it('omits the Acceptance container entirely at zero criteria', () => {
    const out = serializeRequirementSection(SOURCE, 'REQ-A-1', {
      title: 'T', statement: 'S.', criteria: [],
    })!;
    const reqSlice = out.slice(out.indexOf('<!-- id: REQ-A-1 -->'), out.indexOf('<!-- id: REQ-A-2 -->'));
    expect(reqSlice).not.toContain('## Acceptance');
    expect(reqSlice).toContain('implementations:'); // untouched block survives
  });
});

describe('SpecEditor (REQ-DESKTOP-006…011)', () => {
  it('006.A1 + 009.A1/A3 + 016.A2: Edit swaps the editor in place, tree stays, all fields render, no extra fetch', async () => {
    const { calls, container } = await openEditor();
    const callsAtOpen = calls.length;

    // Edit bar shows the editing context (source path · spec id).
    expect(screen.getByText('Editing spec')).toBeTruthy();
    expect(screen.getByText('specs/auth.md · REQ-A-1')).toBeTruthy();

    // Read view is gone; same panel, tree pane still there and interactive.
    expect(screen.queryByRole('heading', { name: 'Validate session token' })).toBeNull();
    expect(within(treePane(container)).getByText('REQ-A-2')).toBeTruthy();

    // Structured fields (009.A1): title, priority segmented, kind, owner,
    // statement textarea, rationale. Status is the only non-editable field.
    expect(titleInput().value).toBe('Validate session token');
    for (const p of ['P0', 'P1', 'P2', 'P3']) expect(screen.getByText(p)).toBeTruthy();
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('requirement');
    expect((screen.getByLabelText('Owner') as HTMLInputElement).placeholder).toBe('unassigned');
    expect((screen.getByLabelText('Normative statement') as HTMLTextAreaElement).value).toBe(STATEMENT);
    expect(screen.getByLabelText('Rationale')).toBeTruthy();

    // Keyword legend beside the statement editor (009.A3).
    const legend = container.querySelector('.sp-kw-legend') as HTMLElement;
    expect(legend.textContent).toContain('Keywords:');
    expect(legend.querySelector('.sp-kw-must')!.textContent).toBe('MUST');
    expect(legend.querySelector('.sp-kw-should')!.textContent).toBe('SHOULD');
    expect(legend.querySelector('.sp-kw-may')!.textContent).toBe('MAY');

    // Criteria seeded from the source with link-derived states.
    expect((screen.getByLabelText('Criterion A1 text') as HTMLInputElement).value).toBe('Every route calls `validateSession`.');
    expect((screen.getByLabelText('Criterion A3 text') as HTMLInputElement).value).toBe('Revoked tokens stop working.');
    expect((screen.getByLabelText('Criterion A1 state') as HTMLSelectElement).value).toBe('verified');
    expect((screen.getByLabelText('Criterion A3 state') as HTMLSelectElement).value).toBe('pending');

    // Opening the editor issued no network request (016.A2).
    expect(calls.length).toBe(callsAtOpen);
  });

  it('007: Save gates on by-value dirtiness; indicator carries its text label', async () => {
    await openEditor();

    // Fresh editor: Save disabled, no indicator (007.A1).
    expect(saveBtn().disabled).toBe(true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    // Any field edit enables Save and shows dot + text (007.A2).
    fireEvent.change(titleInput(), { target: { value: 'Changed' } });
    expect(saveBtn().disabled).toBe(false);
    const label = screen.getByText('Unsaved changes');
    expect(label.previousElementSibling!.className).toContain('sp-dirty-dot');
    expect(screen.getByText('edited')).toBeTruthy(); // footer reflects it

    // Reverting by value returns to clean (007.A3).
    fireEvent.change(titleInput(), { target: { value: 'Validate session token' } });
    expect(saveBtn().disabled).toBe(true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByText('no changes')).toBeTruthy();
  });

  it('006.A2/A4: Cancel restores the read view with persisted values, no PUT; re-edit reseeds', async () => {
    const { calls } = await openEditor();

    fireEvent.change(titleInput(), { target: { value: 'Discarded draft title' } });
    fireEvent.click(cancelBtn());

    // Read view back with the persisted values (006.A2).
    await screen.findByRole('heading', { name: 'Validate session token' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    // Re-entering starts from the persisted values, not the draft (006.A4).
    fireEvent.click(screen.getByText('Edit spec').closest('button')!);
    expect(titleInput().value).toBe('Validate session token');
  });

  it('006.A3: changing the tree selection while editing discards the draft', async () => {
    const { container } = await openEditor();
    fireEvent.change(titleInput(), { target: { value: 'Doomed draft' } });

    fireEvent.click(within(treePane(container)).getByText('REQ-A-2'));
    await screen.findByRole('heading', { name: 'Reject expired tokens' });
    expect(screen.queryByText('Editing spec')).toBeNull();

    // And coming back to the first spec renders its read view, not the draft.
    fireEvent.click(within(treePane(container)).getByText('REQ-A-1'));
    await screen.findByRole('heading', { name: 'Validate session token' });
  });

  it('008.A1/A2: status is read-only — transition pills + lock, no user-operable control', async () => {
    const { container } = await openEditor(); // REQ-A-1 rolls up verified
    const auto = container.querySelector('.sp-status-auto') as HTMLElement;
    expect(auto).toBeTruthy();
    // Non-drafted spec shows current-state → drafted as pills (008.A2).
    expect(within(auto).getByText('Verified')).toBeTruthy();
    expect(within(auto).getByText('Drafted')).toBeTruthy();
    // No control accepts user input; the field is visibly locked (008.A1).
    expect(auto.querySelector('input, select, button, textarea')).toBeNull();
    expect(auto.querySelector('svg')).toBeTruthy(); // lock / arrow affordance
  });

  it('008.A1: a drafted spec shows the drafted pill with "queued for implementation"', async () => {
    const { container } = await openEditor('REQ-A-2');
    const auto = container.querySelector('.sp-status-auto') as HTMLElement;
    expect(within(auto).getByText('Drafted')).toBeTruthy();
    expect(within(auto).getByText('queued for implementation')).toBeTruthy();
    expect(auto.querySelector('input, select, button, textarea')).toBeNull();
    // Zero criteria renders the hint, not an empty card (010.A4).
    expect(screen.getByText('No criteria yet — add one below.')).toBeTruthy();
  });

  it('009.A2/A4: Preview decorates exactly like the read view; empty statement shows the explicit note', async () => {
    // Capture the read view's decoration for the same text first.
    mockFetch(baseRoutes());
    const read = render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByRole('heading', { name: 'Validate session token' });
    const readHtml = (read.container.querySelector('.sp-statement .sp-prose') as HTMLElement).innerHTML;
    cleanup();
    vi.unstubAllGlobals();

    const { container } = await openEditor();
    fireEvent.click(screen.getByText('Preview'));
    const previewHtml = (container.querySelector('.sp-statement .sp-prose') as HTMLElement).innerHTML;
    expect(previewHtml).toBe(readHtml); // identical chips/code/bold (002.A4)

    // Empty statement → explicit note, not a blank block (009.A4).
    fireEvent.click(screen.getByText('Write'));
    fireEvent.change(screen.getByLabelText('Normative statement'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByText('Nothing to preview yet.')).toBeTruthy();
  });

  it('010.A1–A3: add appends A(n+1), delete renumbers contiguously, state picker recolors only its row', async () => {
    await openEditor();

    // Add appends a row numbered one past the current count (010.A1).
    fireEvent.click(screen.getByText('Add criterion').closest('button')!);
    const added = screen.getByLabelText('Criterion A4 text') as HTMLInputElement;
    expect(added.value).toBe('');
    expect(screen.getByText('4 total')).toBeTruthy();

    // State picker changes only its own row's dot (010.A3).
    fireEvent.change(screen.getByLabelText('Criterion A1 state'), { target: { value: 'drifted' } });
    const dots = screen.getAllByTestId('crit-state-dot') as HTMLElement[];
    expect(dots[0]!.style.background).toBe('var(--warn)');
    expect((screen.getByLabelText('Criterion A2 state') as HTMLSelectElement).value).toBe('implemented');

    // Deleting a middle row renumbers from A1 (010.A2).
    fireEvent.click(screen.getAllByTitle('Remove criterion')[1]!);
    expect((screen.getByLabelText('Criterion A2 text') as HTMLInputElement).value).toBe('Revoked tokens stop working.');
    expect((screen.getByLabelText('Criterion A3 text') as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText('Criterion A4 text')).toBeNull();
  });

  it('011.A1 + 008.A3: Save PUTs the re-serialized file byte-preserving siblings, then the read view shows updated values', async () => {
    const routes = baseRoutes();
    const updated = {
      ...DETAIL_A1,
      spec: { ...DETAIL_A1.spec, title: 'Validate session token strictly' },
      source: EXPECTED_AFTER_SAVE,
    };
    routes['PUT /api/spec/REQ-A-1'] = () => {
      routes['/api/spec/REQ-A-1'] = updated; // re-index replaced the row
      return { body: { ok: true, spec: updated.spec } };
    };
    const { calls } = await openEditor('REQ-A-1', routes);

    fireEvent.change(titleInput(), { target: { value: 'Validate session token strictly' } });
    fireEvent.click(screen.getAllByTitle('Remove criterion')[1]!); // drop A2
    fireEvent.click(saveBtn());

    // Editor closes onto the reloaded read view with the persisted values.
    await screen.findByRole('heading', { name: 'Validate session token strictly' });
    expect(screen.queryByText('Editing spec')).toBeNull();

    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/spec/REQ-A-1');
    // Exact whole-file body: edited slice regenerated, everything else
    // byte-identical (011.A1 + 011.A4 renumbering).
    expect(put.body!.content).toBe(EXPECTED_AFTER_SAVE);
    // The detail was refetched after the save.
    expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/spec/REQ-A-1')).length).toBeGreaterThanOrEqual(2);
    // No sync-lag hint on a clean save.
    expect(screen.queryByText(/not yet indexed/)).toBeNull();
  });

  it('010.A4: empty-text rows survive while typing but are dropped only at save', async () => {
    const routes = baseRoutes();
    routes['PUT /api/spec/REQ-A-1'] = () => ({ body: { ok: true, spec: DETAIL_A1.spec } });
    const { calls } = await openEditor('REQ-A-1', routes);

    fireEvent.click(screen.getByText('Add criterion').closest('button')!);
    expect(screen.getByLabelText('Criterion A4 text')).toBeTruthy(); // not dropped while typing
    fireEvent.click(saveBtn());

    await screen.findByRole('heading', { name: 'Validate session token' });
    const put = calls.find((c) => c.method === 'PUT')!;
    // The blank criterion never persists — the serialized file is unchanged.
    expect(put.body!.content).toBe(SOURCE);
    expect(put.body!.content).not.toContain('REQ-A-1.A4');
  });

  it('011.A2: a failed write keeps the editor open with the draft intact and shows the error', async () => {
    const routes = baseRoutes();
    routes['PUT /api/spec/REQ-A-1'] = () => ({ status: 500, body: { error: 'disk full' } });
    await openEditor('REQ-A-1', routes);

    fireEvent.change(titleInput(), { target: { value: 'Doomed but kept' } });
    fireEvent.click(saveBtn());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('disk full');
    expect((alert as HTMLElement).style.color).toBe('var(--error)');
    // Editor still open, draft intact.
    expect(screen.getByText('Editing spec')).toBeTruthy();
    expect(titleInput().value).toBe('Doomed but kept');
    expect(saveBtn().disabled).toBe(false); // retry stays available
  });

  it('011.A3: a write that succeeds while re-indexing fails shows the sync-lag hint', async () => {
    const routes = baseRoutes();
    routes['PUT /api/spec/REQ-A-1'] = () => (
      { body: { ok: true, spec: DETAIL_A1.spec, syncError: 'fts5 unavailable' } }
    );
    await openEditor('REQ-A-1', routes);

    fireEvent.change(titleInput(), { target: { value: 'Saved, index lagging' } });
    fireEvent.click(saveBtn());

    await screen.findByRole('heading', { name: 'Validate session token' });
    const hint = screen.getByText(/Saved, but not yet indexed/);
    expect(hint.textContent).toContain('fts5 unavailable');
  });
});
