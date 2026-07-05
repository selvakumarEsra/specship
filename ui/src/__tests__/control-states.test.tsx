/**
 * REQ-DESKTOP-013…016 — shared control-state tokens, assistive-tech
 * operability, narrow-width degradation, and interaction latency.
 *
 * jsdom computes no layout and never evaluates :hover/:active/:focus-visible,
 * media queries, or paint timing. Pseudo-state, breakpoint, and motion rules
 * are therefore asserted as CSS contracts against app.css's text (the rules
 * the browser will apply), while selection semantics, keyboard operability,
 * radiogroup behavior, accessible names, detail caching, and typing echo are
 * asserted on the rendered DOM. What genuinely cannot be verified here (real
 * hover paint, actual reduced-motion playback, wall-clock keystroke latency)
 * is called out at the assertion site instead of being approximated.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphPage } from '../pages/graph';
import { SpecsPage } from '../pages/specs';
import { Segmented } from '../components/ui';

// node:fs, not `app.css?raw`: vitest's CSS interception returns an empty
// module for raw CSS imports (see node-builtins.d.ts for the local typings).
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(SRC, 'styles/app.css'), 'utf8');

/** Every non-test component source, path → raw text, for the bespoke-timing sweep. */
const TSX_SOURCES: Record<string, string> = {};
for (const dir of ['components', 'pages', '.']) {
  for (const f of readdirSync(join(SRC, dir))) {
    if (f.endsWith('.tsx')) TSX_SOURCES[dir + '/' + f] = readFileSync(join(SRC, dir, f), 'utf8');
  }
}

/** First declaration block for a selector ("sel { … }") in app.css. */
function cssRule(selector: string): string {
  const m = CSS.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  if (!m) throw new Error('no CSS rule for selector: ' + selector);
  return m[1]!;
}

// ---- Fixtures (Specs page + editable detail) ----

const STATEMENT = 'The server MUST validate the session token before **any** handler runs.';

const SOURCE = `<!-- id: AUTH-DOC -->
# Auth

<!-- id: REQ-A-1 -->
## Validate session token

${STATEMENT}

## Acceptance
<!-- id: REQ-A-1.A1 -->
- Every route calls \`validateSession\`.
<!-- id: REQ-A-1.A2 -->
- Invalid signatures are rejected.
`;

const SPECS = {
  specs: [
    { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' },
    { id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    { id: 'REQ-I-1', kind: 'requirement', title: 'Tail JSONL incrementally', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
  ],
  linkStates: { 'REQ-A-1': 'verified' },
};

const AUTH_DOC = { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' };

const DETAIL_A1 = {
  spec: {
    id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token',
    body: STATEMENT, sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC', priority: 'P1',
  },
  parent: AUTH_DOC,
  siblings: [],
  children: [
    { id: 'REQ-A-1.A1', kind: 'acceptance', title: 'A1', body: 'Every route calls `validateSession`.', parentId: 'REQ-A-1' },
    { id: 'REQ-A-1.A2', kind: 'acceptance', title: 'A2', body: 'Invalid signatures are rejected.', parentId: 'REQ-A-1' },
  ],
  links: [{
    id: 1, specId: 'REQ-A-1', kind: 'implements', state: 'verified',
    targetFilePath: 'src/auth.ts', targetQualifiedName: 'validateSession', provenance: 'agent-asserted',
  }],
  childLinks: { 'REQ-A-1.A1': [{ specId: 'REQ-A-1.A1', kind: 'verifies', state: 'verified' }], 'REQ-A-1.A2': [] },
  source: SOURCE,
};

const DETAIL_I1 = {
  spec: { id: 'REQ-I-1', kind: 'requirement', title: 'Tail JSONL incrementally', body: 'The watcher SHOULD tail.', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
  parent: AUTH_DOC, siblings: [], children: [], links: [], childLinks: {}, source: null,
};

function specRoutes(): Record<string, unknown> {
  return { '/api/specs': SPECS, '/api/spec/REQ-A-1': DETAIL_A1, '/api/spec/REQ-I-1': DETAIL_I1 };
}

const GRAPH_ROUTES: Record<string, unknown> = {
  '/api/graph/full': {
    nodes: [{ id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts', degree: 2 }],
    edges: [], total: 1, shown: 1,
  },
  '/api/graph/health': { linkHealth: {}, edgeKinds: {}, hubs: [], anchored: [] },
  '/api/graph/node': {
    n1: {
      matches: [{
        id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts',
        callers: [], callees: [], linkedSpecs: [],
      }],
    },
  },
};

/** Pathname-keyed fetch mock; /api/graph/node serves per-id bodies. */
function mockFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    let body = routes[u.pathname];
    if (u.pathname === '/api/graph/node') {
      body = (body as Record<string, unknown> | undefined)?.[u.searchParams.get('id') ?? ''];
    }
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    return { ok: true, json: async () => body };
  }));
  return calls;
}

const treeRow = (name: RegExp) => screen.getByRole('treeitem', { name });

beforeEach(() => {
  history.replaceState(null, '', '/specs');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ============================================================
// REQ-DESKTOP-013 — control states from the shared tokens
// ============================================================

describe('control-state CSS contract (REQ-DESKTOP-013)', () => {
  it('defines the single motion token and no bespoke 100ms timing survives anywhere', () => {
    expect(CSS).toContain('--motion-fast: 100ms ease');
    // The token definition is the ONLY literal 100ms left in the stylesheet.
    expect(CSS.match(/100ms/g)).toHaveLength(1);
    // Every control-state transition rides the token.
    expect(cssRule('.btn ')).toContain('background var(--motion-fast)');
    expect(cssRule('.input ')).toContain('border-color var(--motion-fast)');
    expect(cssRule('.list-row ')).toContain('background var(--motion-fast)');
    expect(cssRule('.seg-btn ')).toContain('background var(--motion-fast)');
    // And no component carries an inline color/surface transition with a
    // literal millisecond timing (layout motion like the sidebar width is a
    // different treatment and stays out of this contract).
    const bespoke = Object.entries(TSX_SOURCES)
      .filter(([, text]) => /transition:\s*'[^']*(?:background|color|border|box-shadow)[^']*\d+ms/.test(text))
      .map(([path]) => path);
    expect(Object.keys(TSX_SOURCES).length).toBeGreaterThan(10); // the sweep actually swept
    expect(bespoke).toEqual([]);
  });

  it('hover uses bg-hover (rows, ghost) or elevated+strong-border (secondary); pressed uses bg-active', () => {
    expect(cssRule('.list-row:hover')).toContain('var(--bg-hover)');
    expect(cssRule('.btn-ghost:hover:not(:disabled)')).toContain('var(--bg-hover)');
    const secondary = cssRule('.btn-secondary:hover:not(:disabled)');
    expect(secondary).toContain('var(--bg-elevated)');
    expect(secondary).toContain('var(--border-strong)');
    expect(CSS).not.toContain('#283039'); // the bespoke hover color is gone
    // Pressed state — previously the --bg-active token was defined but unused.
    expect(cssRule('.list-row:active')).toContain('var(--bg-active)');
    expect(cssRule('.btn-ghost:active:not(:disabled)')).toContain('var(--bg-active)');
    expect(cssRule('.btn-secondary:active:not(:disabled)')).toContain('var(--bg-active)');
  });

  it('A1: the selected row rule uses accent-soft and is declared after hover/pressed so selection survives both', () => {
    const sel = CSS.indexOf('.list-row.selected');
    expect(sel).toBeGreaterThan(-1);
    expect(CSS.slice(sel)).toMatch(/^[^}]*var\(--accent-soft\)/);
    expect(CSS).toContain('.list-row[aria-selected="true"]');
    // Equal specificity ⇒ order decides: selected must come last.
    expect(sel).toBeGreaterThan(CSS.indexOf('.list-row:hover'));
    expect(sel).toBeGreaterThan(CSS.indexOf('.list-row:active'));
  });

  it('A2: focused inputs take the focus border + accent-soft glow; placeholders the muted token', () => {
    const focus = cssRule('.input:focus');
    expect(focus).toContain('var(--border-focus)');
    expect(focus).toContain('var(--accent-soft)');
    expect(cssRule('.input::placeholder')).toContain('var(--text-muted)');
  });

  it('A3: disabled controls are dimmed with not-allowed, and every hover rule is scoped :not(:disabled)', () => {
    const disabled = cssRule('.btn:disabled');
    expect(disabled).toContain('opacity');
    expect(disabled).toContain('not-allowed');
    expect(cssRule('.seg-btn:disabled')).toContain('not-allowed');
    // No button-family hover selector fires on a disabled control.
    const unguarded = [...CSS.matchAll(/\.(?:btn|seg-btn|card-btn)[\w.-]*:hover(?![\w-])(?!:not\(:disabled\))/g)];
    expect(unguarded.map((m) => m[0])).toEqual([]);
  });

  it('A4: the global focus-visible ring renders in the accent token', () => {
    expect(cssRule(':focus-visible')).toContain('var(--accent)');
  });

  it('A1 (rendered): selection is class/ARIA-driven with no inline background for hover handlers to fight', async () => {
    mockFetch(specRoutes());
    render(<SpecsPage project={null} query={{}} />);
    await screen.findByText('auth.md');

    fireEvent.click(screen.getByText('REQ-A-1'));
    await screen.findByRole('heading', { name: 'Validate session token' });

    const selected = treeRow(/REQ-A-1/);
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.className).toContain('selected');
    expect(selected.style.background).toBe('');
    // No JS hover mutation left: hovering changes neither class nor style.
    fireEvent.mouseEnter(selected);
    fireEvent.mouseLeave(selected);
    expect(selected.className).toContain('selected');
    expect(selected.style.background).toBe('');

    const other = treeRow(/REQ-I-1/);
    expect(other.getAttribute('aria-selected')).toBe('false');
    expect(other.className).not.toContain('selected');
  });

  it('A4 (rendered): rows and segmented options are keyboard-focusable controls', async () => {
    mockFetch(specRoutes());
    render(<SpecsPage project={null} query={{}} />);
    await screen.findByText('auth.md');

    expect(treeRow(/REQ-A-1/).tabIndex).toBe(0);
    expect(treeRow(/auth\.md/).tabIndex).toBe(0);

    const onChange = vi.fn();
    render(<Segmented options={['P0', 'P1']} value="P1" onChange={onChange} label="Priority" />);
    const radios = within(screen.getByRole('radiogroup', { name: 'Priority' })).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLButtonElement).tagName)).toEqual(['BUTTON', 'BUTTON']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0]); // roving tabindex
  });

  it('disabled Segmented options are real disabled buttons (no hover/press reaction possible)', () => {
    render(<Segmented options={['Write', 'Preview']} value="Write" onChange={() => {}} label="Mode" disabled />);
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true);
  });
});

// ============================================================
// REQ-DESKTOP-014 — assistive-tech operability
// ============================================================

describe('assistive tech (REQ-DESKTOP-014)', () => {
  it('A1: keyboard alone selects a spec, opens the editor, edits, and reaches Save/Cancel — fields in visual order', async () => {
    mockFetch(specRoutes());
    const { container } = render(<SpecsPage project={null} query={{}} />);
    await screen.findByText('auth.md');

    // Enter on the focusable tree row selects (Space toggles the doc header).
    const row = treeRow(/REQ-A-1/);
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Validate session token' });

    // Edit is a native <button> — keyboard-activatable by construction (jsdom
    // cannot synthesize a real Tab traversal, so operability is asserted as
    // native-control semantics + DOM order below).
    const edit = screen.getByText('Edit spec').closest('button') as HTMLButtonElement;
    expect(edit.disabled).toBe(false);
    fireEvent.click(edit);
    await screen.findByText('Editing spec');

    // Every field is a native control or a roving-tabindex radio, and DOM
    // order (= focus order) matches the visual order of the editor.
    const fields = Array.from(container.querySelectorAll('input, textarea, select, [role="radio"]'));
    const labelOf = (el: Element) => el.getAttribute('aria-label') ?? el.textContent;
    expect(fields.map(labelOf)).toEqual([
      'Title',
      'P0', 'P1', 'P2', 'P3',
      'Kind', 'Owner',
      'Write', 'Preview',
      'Normative statement',
      'Rationale',
      'Criterion A1 state', 'Criterion A1 text',
      'Criterion A2 state', 'Criterion A2 text',
    ]);

    // Edit a field, then Save/Cancel are reachable native buttons.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited by keyboard' } });
    const save = screen.getAllByText('Save changes')[0]!.closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(screen.getAllByText('Cancel')[0]!.closest('button')).toBeTruthy();

    // Space on the doc header treeitem collapses the group (aria-expanded).
    const doc = treeRow(/auth\.md/);
    expect(doc.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(doc, { key: ' ' });
    expect(doc.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('treeitem', { name: /REQ-A-1/ })).toBeNull();
  });

  it('A2: icon-only controls expose accessible names — copy id, remove criterion', async () => {
    mockFetch(specRoutes());
    render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByRole('heading', { name: 'Validate session token' });
    expect(screen.getByRole('button', { name: 'Copy spec id' })).toBeTruthy();

    fireEvent.click(screen.getByText('Edit spec').closest('button')!);
    expect(screen.getByRole('button', { name: 'Remove criterion A1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove criterion A2' })).toBeTruthy();
  });

  it('A2: the graph rail close and copy-path controls expose accessible names', async () => {
    history.replaceState(null, '', '/graph');
    mockFetch(GRAPH_ROUTES);
    const { container } = render(<GraphPage project={null} query={{ focus: 'n1' }} />);
    const rail = (container.firstElementChild as HTMLElement).lastElementChild as HTMLElement;
    await within(rail).findByText('src/mcp/tools.ts');
    expect(within(rail).getByRole('button', { name: 'Close node detail' })).toBeTruthy();
    expect(within(rail).getByRole('button', { name: 'Copy file path' })).toBeTruthy();
  });

  it('segmented pickers are radiogroups: one checked member, arrow keys move selection and focus', async () => {
    mockFetch(specRoutes());
    render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByText('Edit spec');
    fireEvent.click(screen.getByText('Edit spec').closest('button')!);

    // Priority: one group, the persisted value is the one checked member.
    const priority = screen.getByRole('radiogroup', { name: 'Priority' });
    const checked = within(priority).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.map((r) => r.textContent)).toEqual(['P1']);

    // Write/Preview: ArrowRight moves selection AND focus; wraps around.
    const mode = screen.getByRole('radiogroup', { name: 'Statement editor mode' });
    const write = within(mode).getByRole('radio', { name: 'Write' });
    const preview = within(mode).getByRole('radio', { name: 'Preview' });
    expect(write.getAttribute('aria-checked')).toBe('true');

    write.focus();
    fireEvent.keyDown(write, { key: 'ArrowRight' });
    expect(preview.getAttribute('aria-checked')).toBe('true');
    expect(write.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(preview);
    expect([write.tabIndex, preview.tabIndex]).toEqual([-1, 0]); // roving

    fireEvent.keyDown(preview, { key: 'ArrowRight' }); // wraps to Write
    expect(write.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(write);
  });

  it('A4: reduced-motion zeroes ALL animation and transition durations globally — shimmer, pulse, and --motion-fast are all duration-driven', () => {
    const m = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('animation-duration: 0.001ms !important');
    expect(m![1]).toContain('transition-duration: 0.001ms !important');
    // The zeroing covers everything the spec names because each is expressed
    // as an animation or transition duration (jsdom cannot play them, so the
    // mechanism is what's assertable):
    expect(cssRule('.skel')).toContain('animation: skeleton');       // shimmer
    expect(CSS).toContain('@keyframes pulsePill');                    // pulse
    expect(cssRule('.list-row ')).toContain('var(--motion-fast)');   // transitions
  });

  it('A5: normative prose and criterion text render only in the primary/secondary text tokens', async () => {
    // Token contract (holds in both themes — the classes reference the same
    // custom properties, which each theme block re-points).
    expect(cssRule('.sp-prose')).toContain('var(--text-secondary)');
    expect(cssRule('.sp-statement.lead .sp-prose')).toContain('var(--text-primary)');
    expect(cssRule('.sp-crit-text')).toContain('var(--text-secondary)');
    for (const sel of ['.sp-prose', '.sp-crit-text']) {
      expect(cssRule(sel)).not.toContain('--text-muted');
      expect(cssRule(sel)).not.toContain('--text-faint');
    }
    // Rendered prose carries no inline color override that could bypass them.
    mockFetch(specRoutes());
    const { container } = render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByRole('heading', { name: 'Validate session token' });
    const prose = container.querySelector('.sp-statement .sp-prose') as HTMLElement;
    expect(prose.style.color).toBe('');
    for (const c of Array.from(container.querySelectorAll('.sp-crit-text'))) {
      expect((c as HTMLElement).style.color).toBe('');
    }
  });
});

// ============================================================
// REQ-DESKTOP-015 — narrow-width degradation
// ============================================================

describe('responsive degradation (REQ-DESKTOP-015)', () => {
  it('A3: the content column clamps to its readable measure (CSS contract)', () => {
    expect(cssRule('.sp-doc')).toContain('max-width: 700px');
  });

  it('A1 (rendered): the meta line and action row are wrap-flex; the segment bar is equal-width flex', async () => {
    mockFetch(specRoutes());
    const { container } = render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByRole('heading', { name: 'Validate session token' });

    expect(cssRule('.sp-metaline')).toContain('flex-wrap: wrap');
    const actions = screen.getByText('Implement').closest('div') as HTMLElement;
    expect(actions.style.flexWrap).toBe('wrap');
    // Segment bar: every segment flexes equally — compresses proportionally,
    // never overflows (jsdom does no layout; equal flex-grow is the contract).
    const segments = Array.from(container.querySelectorAll('.row.gap-4 > div'));
    expect(segments.length).toBe(2);
    for (const s of segments) expect((s as HTMLElement).style.flexGrow).toBe('1');
  });

  it('A2: long ids, paths, and link targets ellipsize on a single line', async () => {
    expect(cssRule('.sp-breadcrumb .sp-path')).toContain('text-overflow: ellipsis');
    expect(cssRule('.sp-breadcrumb .sp-path')).toContain('white-space: nowrap');

    mockFetch(specRoutes());
    const { container } = render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByRole('heading', { name: 'Validate session token' });

    expect((container.querySelector('.sp-breadcrumb .sp-path') as HTMLElement).textContent).toBe('specs/auth.md');
    const target = screen.getByText('src/auth.ts:validateSession') as HTMLElement;
    expect(target.style.textOverflow).toBe('ellipsis');
    expect(target.style.whiteSpace).toBe('nowrap');
    // Tree rows: both the id and title lines ellipsize.
    const id = within(treeRow(/REQ-A-1/)).getByText('REQ-A-1') as HTMLElement;
    expect(id.style.textOverflow).toBe('ellipsis');
    expect(id.style.whiteSpace).toBe('nowrap');
  });

  it('the editor metadata grid collapses to one column at the narrow breakpoint (CSS contract)', async () => {
    expect(cssRule('.sp-edit-grid')).toContain('grid-template-columns: 1fr 1fr');
    const narrow = CSS.match(/@media \(max-width: 1100px\)\s*\{\s*\.sp-edit-grid\s*\{([^}]*)\}/);
    expect(narrow).toBeTruthy();
    expect(narrow![1]).toContain('grid-template-columns: 1fr');

    mockFetch(specRoutes());
    render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByText('Edit spec');
    fireEvent.click(screen.getByText('Edit spec').closest('button')!);
    const grid = screen.getByLabelText('Owner').closest('.sp-edit-grid');
    expect(grid).toBeTruthy();
    expect((grid as HTMLElement).style.gridTemplateColumns).toBe(''); // class-driven, not inline
  });
});

// ============================================================
// REQ-DESKTOP-016 — no avoidable waits
// ============================================================

describe('interaction latency (REQ-DESKTOP-016)', () => {
  it('A1: the skeleton shows only while data is genuinely absent — a cached re-selection swaps with no flash', async () => {
    const calls = mockFetch(specRoutes());
    render(<SpecsPage project={null} query={{}} />);
    await screen.findByText('auth.md');

    // First selection: nothing cached yet, the skeleton is legitimate.
    fireEvent.click(screen.getByText('REQ-A-1'));
    expect(screen.getByTestId('spec-skeleton')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Validate session token' });

    fireEvent.click(screen.getByText('REQ-I-1'));
    await screen.findByRole('heading', { name: 'Tail JSONL incrementally' });

    // Re-selection: the cached detail paints synchronously — no skeleton, no
    // blank frame — while the revalidating fetch still runs.
    fireEvent.click(screen.getByText('REQ-A-1'));
    expect(screen.queryByTestId('spec-skeleton')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Validate session token' })).toBeTruthy();
    await waitFor(() => {
      expect(calls.filter((u) => u.startsWith('/api/spec/REQ-A-1')).length).toBe(2);
    });
  });

  it('A3: the Write/Preview toggle renders the preview in the same interaction — no spinner, no skeleton', async () => {
    mockFetch(specRoutes());
    const { container } = render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByText('Edit spec');
    fireEvent.click(screen.getByText('Edit spec').closest('button')!);

    fireEvent.click(screen.getByText('Preview'));
    // Synchronous assertions — no awaits between the toggle and the check.
    expect(container.querySelector('.sp-statement .sp-prose')).toBeTruthy();
    expect(screen.queryByTestId('spec-skeleton')).toBeNull();
    expect(container.querySelector('[style*="spin"]')).toBeNull();
  });

  it('A4: with a statement 10× the design sample, Write-mode keystrokes echo the raw value with zero decoration work in the DOM', async () => {
    mockFetch(specRoutes());
    const { container } = render(<SpecsPage project={null} query={{ sel: 'REQ-A-1' }} />);
    await screen.findByText('Edit spec');
    fireEvent.click(screen.getByText('Edit spec').closest('button')!);

    // Paste a body 10× the design sample, then type onto it key by key: each
    // keystroke must echo exactly, and Write mode must never build decorated
    // DOM (`renderProse` output — .sp-prose/.sp-code, plus keyword chips
    // beyond the static 3-chip legend — exists only in Preview). The absence
    // of decoration work is the assertable mechanism; wall-clock latency is a
    // real-browser property jsdom cannot measure.
    const long = STATEMENT.repeat(10);
    const area = () => screen.getByLabelText('Normative statement') as HTMLTextAreaElement;
    fireEvent.change(area(), { target: { value: long } });
    expect(area().value).toBe(long);
    const kwBaseline = container.querySelectorAll('.sp-kw').length;
    expect(kwBaseline).toBe(3); // MUST / SHOULD / MAY legend, static
    let val = long;
    for (const key of 'expanded!') {
      val += key;
      fireEvent.change(area(), { target: { value: val } });
      expect(area().value).toBe(val);
      expect(container.querySelector('.sp-prose, .sp-code')).toBeNull();
      expect(container.querySelectorAll('.sp-kw').length).toBe(kwBaseline);
    }
    expect(area().value.length).toBeGreaterThan(long.length);
  });
});
