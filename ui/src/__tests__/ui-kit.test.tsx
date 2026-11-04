/**
 * REQ-DASHTHEME-004 — the shared UI kit is rebuilt in the BookMyGame UI
 * visual language with React + CSS only.
 *
 * A1 runs the real dependency check (scripts/check-ui-deps.mjs) on
 * ui/package.json and scans ui/src for forbidden imports. A2 renders the
 * Design system screen and proves every kit component appears in each of its
 * states, built on the kit tokens. A3 renders every kept screen and proves no
 * interactive control is unstyled. A4 is a CSS contract (jsdom never
 * evaluates :hover/:active/:disabled): every kit state rule reads shared
 * state tokens and carries no literal.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { DashboardPage } from '../pages/dashboard';
import { DesignSystemPage } from '../pages/designsystem';
import { GraphPage } from '../pages/graph';
import { RunsPage } from '../pages/runs';
import { SettingsPage } from '../pages/settings';
import { ReviewPage } from '../pages/review';
import { reviewRoutes } from './review-fixtures';
import { TraceabilityPage } from '../pages/traceability';
import { WorkflowsPage } from '../pages/workflows';
import { BUTTON_VARIANTS, KIT_COMPONENT_STATES } from '../tokens';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = join(SRC, '..');
const REPO = join(UI_DIR, '..');
const TOKENS_CSS = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
const APP_CSS = readFileSync(join(SRC, 'styles/app.css'), 'utf8');

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const f of readdirSync(join(dir, rel))) {
    const r = rel ? rel + '/' + f : f;
    if (statSync(join(dir, r)).isDirectory()) out.push(...walk(dir, r));
    else if (/\.(tsx?|css|mjs|js)$/.test(f)) out.push(r);
  }
  return out;
}

/** First declaration block for an exact selector text ("sel { … }"). */
function cssRule(css: string, selector: string): string {
  const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  if (!m) throw new Error('no CSS rule for selector: ' + selector);
  return m[1]!;
}

/** Every top-level rule in app.css as { selectors, body } (comments stripped). */
function cssRules(css: string): Array<{ selectors: string[]; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2]!,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ============================================================
// A1 — dependencies stay exactly react + react-dom
// ============================================================

describe('REQ-DASHTHEME-004.A1 — no new dependencies', () => {
  it('REQ-DASHTHEME-004.A1: the UI dependency check passes with exactly react + react-dom, and nothing imports react-native-web or @bmg/components', function reqDashtheme004A1() {
    const checkPath = join(REPO, 'scripts', 'check-ui-deps.mjs');
    // The real CLI check (as `npm run build` runs it) exits 0…
    expect(() => execFileSync(process.execPath, [checkPath], { cwd: UI_DIR, stdio: 'pipe' })).not.toThrow();
    // …and its exported checks, called directly (in a child node: the script
    // lives outside the ui/ vite root, which vitest refuses to import from).
    const pkgPath = join(UI_DIR, 'package.json');
    const probe = `import(${JSON.stringify(pathToFileURL(checkPath).href)}).then((m) => process.stdout.write(JSON.stringify({ allow: m.RUNTIME_DEP_ALLOWLIST, errors: m.assertRuntimeDepsAllowlist(${JSON.stringify(pkgPath)}) })))`;
    const deps = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })) as { allow: string[]; errors: string[] };
    expect([...deps.allow].sort()).toEqual(['react', 'react-dom']);
    expect(deps.errors).toEqual([]);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['react', 'react-dom']);
    // Not smuggled in as a dev dependency either.
    for (const banned of ['react-native-web', '@bmg/components']) {
      expect(Object.keys(pkg.devDependencies ?? {})).not.toContain(banned);
    }

    const FORBIDDEN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|@import\s+)['"](?:react-native-web|@bmg\/components)(?:\/[^'"]*)?['"]/;
    const sources = walk(SRC);
    expect(sources.length).toBeGreaterThan(20); // the scan actually scanned
    const hits = sources.filter((f) => FORBIDDEN.test(readFileSync(join(SRC, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});

// ============================================================
// A2 — the Design system screen shows every kit component in every state
// ============================================================

/** The DOM marker each forced/real state must carry on the rendered control. */
const STATE_MARKER: Record<string, string> = {
  hover: '.is-hover',
  pressed: '.is-active',
  disabled: ':disabled',
  loading: '[aria-busy="true"]',
  on: '[aria-pressed="true"], [aria-checked="true"]',
};

/** The kit class (and the kit token its base rule must read) per component. */
const KIT_BASE: Record<string, { cls: string; token: string }> = {
  button: { cls: '.btn', token: 'var(--radius-control)' },
  card: { cls: '.card', token: 'var(--radius-card)' },
  'stat-tile': { cls: '.stat-tile', token: 'var(--space-md)' },
  badge: { cls: '.pill', token: 'var(--badge-pad-x)' },
  chip: { cls: '.chip', token: 'var(--radius-chip)' },
  segmented: { cls: '.seg', token: 'var(--radius-seg)' },
  switch: { cls: '.switch', token: 'var(--switch-track-w)' },
  empty: { cls: '.empty', token: 'var(--empty-min-h)' },
  error: { cls: '.error-state', token: 'var(--empty-min-h)' },
};

describe('REQ-DASHTHEME-004.A2 — Design system screen', () => {
  it('REQ-DASHTHEME-004.A2: renders every kit component in each of its states using the new tokens', function reqDashtheme004A2() {
    const { container } = render(<DesignSystemPage />);

    // The manifest covers every kit component the spec names.
    expect(Object.keys(KIT_COMPONENT_STATES).sort()).toEqual(Object.keys(KIT_BASE).sort());
    for (const [kit, states] of Object.entries(KIT_COMPONENT_STATES)) {
      for (const st of states) {
        const samples = container.querySelectorAll(`[data-kit="${kit}"][data-kit-state="${st}"]`);
        expect(samples.length, `${kit} · ${st}`).toBeGreaterThan(0);
        for (const sample of samples) {
          // The sample renders the kit component itself…
          const base = KIT_BASE[kit]!.cls;
          const control = sample.matches(base) ? sample : sample.querySelector(base);
          // stat-tile "loading" is the shared skeleton placeholder, not a tile.
          if (!(kit === 'stat-tile' && st === 'loading')) expect(control, `${kit} · ${st} renders ${base}`).not.toBeNull();
          // …in the state it is labelled with.
          const marker = STATE_MARKER[st];
          if (marker) expect(sample.querySelector(marker), `${kit} · ${st} carries ${marker}`).not.toBeNull();
        }
      }
    }

    // Every button variant (primary / ghost / outline + kept aliases) × all five states.
    for (const v of ['primary', 'ghost', 'outline']) expect(BUTTON_VARIANTS.map((b) => b.variant)).toContain(v);
    for (const v of BUTTON_VARIANTS) {
      for (const st of ['default', 'hover', 'pressed', 'disabled', 'loading']) {
        const btn = screen.getByRole('button', { name: `${v.label} ${st}` });
        expect(btn.className).toContain('btn-' + v.variant);
        if (st === 'loading') expect(btn.getAttribute('aria-busy')).toBe('true');
      }
    }
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThanOrEqual(KIT_COMPONENT_STATES.switch!.length);

    // "Using the new tokens": each kit base rule reads its kit token, and the
    // kit shape tokens alias the design system's --bmg-* values.
    for (const { cls, token } of Object.values(KIT_BASE)) {
      const rule = cls === '.error-state' ? cssRule(APP_CSS, '.empty ') : cssRule(APP_CSS, cls + ' ');
      expect(rule, cls).toContain(token);
    }
    const ALIASES: Record<string, string> = {
      '--radius-control': 'var(--bmg-radius-lg)',
      '--radius-control-primary': 'var(--bmg-radius-xl)',
      '--radius-chip': 'var(--bmg-radius-xs)',
      '--radius-card': 'var(--bmg-radius-3xl)',
      '--radius-seg': 'var(--bmg-radius-lg)',
      '--radius-seg-btn': 'var(--bmg-radius-sm)',
      '--radius-switch': 'var(--bmg-radius-pill)',
      '--control-pad-x': 'var(--bmg-space-lg)',
      '--chip-pad-x': 'var(--bmg-space-sm)',
      '--chip-pad-y': 'var(--bmg-space-xs)',
      '--switch-track-w': '44px',
      '--switch-track-h': '26px',
      '--switch-thumb': '20px',
      '--seg-h': '36px',
    };
    for (const [name, value] of Object.entries(ALIASES)) {
      expect(TOKENS_CSS, name).toMatch(new RegExp(name.replace(/-/g, '\\-') + ':\\s*' + value.replace(/[().]/g, '\\$&') + ';'));
    }
    // Buttons and chips are rounded rectangles, not pills.
    expect(cssRule(APP_CSS, '.btn ')).not.toContain('--r-pill');
    expect(cssRule(APP_CSS, '.chip ')).not.toContain('--r-pill');
  });
});

// ============================================================
// A3 — every kept screen renders with the kit, no unstyled control
// ============================================================

const NOW = Date.now();

/** One union fixture for every kept screen; unknown routes 404 (error states render). */
const ROUTES: Record<string, unknown> = {
  '/api/status': {
    projectPath: '/Users/dev/specship', backend: 'native', journalMode: 'wal', version: '0.0.0',
    nodeCount: 100, edgeCount: 200, fileCount: 30, drift: 1,
    lastIndexed: null, nodesByKind: {}, filesByLanguage: {}, dbSizeBytes: 0,
  },
  '/api/config': { ingestEnabled: false },
  '/api/projects': { claudeRoot: '', projects: [] },
  '/api/claude/tips': { tips: [] },
  '/api/drift': {
    links: [
      { id: 1, specId: 'REQ-A-2', state: 'drifted', specTitle: 'Reject expired tokens', targetFilePath: 'src/auth.ts', targetQualifiedName: 'rejectExpired', driftAxis: 'code', provenance: 'agent-asserted', updatedAt: NOW - 3_600_000 },
    ],
  },
  '/api/workflows': {
    workflows: [{
      workflow: { name: 'spec-implement', description: 'Plan, implement and verify.', requires: ['git'], inputs: [{ name: 'SPEC_ID', required: true }], nodes: [{ id: 'plan', kind: 'prompt' }] },
      scope: 'bundled', sourcePath: 'bundled:spec-implement.yaml',
    }],
    errors: [],
  },
  '/api/workflows/runs': { runs: [] },
  '/api/specs': {
    specs: [
      { id: 'AUTH-DOC', kind: 'document', title: 'Auth', sourcePath: 'specs/auth.md' },
      { id: 'REQ-A-1', kind: 'requirement', title: 'Validate session token', sourcePath: 'specs/auth.md', parentId: 'AUTH-DOC' },
    ],
    linkStates: { 'REQ-A-1': 'verified' },
  },
  '/api/graph/full': {
    nodes: [{ id: 'n1', name: 'toolsHandler', kind: 'function', filePath: 'src/mcp/tools.ts', degree: 2 }],
    edges: [], total: 1, shown: 1,
  },
  '/api/graph/health': { linkHealth: {}, edgeKinds: {}, hubs: [], anchored: [] },
};

function mockFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = new URL(url, 'http://local');
    const body = routes[u.pathname];
    if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found: ' + u.pathname }) };
    return { ok: true, json: async () => body };
  }));
}

/** Review's coverage fixture — served to the Review screen only, so the other screens' sweep is unchanged. */
const REVIEW_ROUTES: Record<string, unknown> = {
  ...ROUTES,
  '/api/spec/coverage': reviewRoutes([
    { id: 'REQ-A-1', title: 'Validate session token' },
    { id: 'REQ-A-2', title: 'Reject expired tokens' },
  ])['/api/spec/coverage'],
};

/** Classes that make a control a styled kit control (app.css rules exist for each). */
const KIT_CONTROL_CLASSES = ['btn', 'chip', 'seg-btn', 'switch', 'card-btn', 'list-row', 'sp-icon-btn'];

/** Controls whose class list has no kit class, as readable descriptors. */
function unstyledControls(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('button, [role="switch"], [role="radio"]')]
    .filter((el) => !KIT_CONTROL_CLASSES.some((c) => el.classList.contains(c)))
    .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}"> ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}`);
}

const KEPT_SCREENS: Array<[string, string, () => ReactElement]> = [
  ['dashboard', '/', () => <DashboardPage project={null} query={{}} />],
  ['review', '/review', () => <ReviewPage project={null} query={{}} />],
  ['graph', '/graph', () => <GraphPage project={null} query={{}} />],
  ['traceability', '/traceability', () => <TraceabilityPage project={null} query={{}} />],
  ['runs', '/runs', () => <RunsPage project={null} query={{}} />],
  ['workflows', '/workflows', () => <WorkflowsPage project={null} query={{}} />],
  ['settings', '/settings', () => <SettingsPage project={null} query={{}} />],
  ['designsystem', '/designsystem', () => <DesignSystemPage />],
];

describe('REQ-DASHTHEME-004.A3 — kept screens use the kit', () => {
  beforeEach(() => localStorage.clear());

  it('REQ-DASHTHEME-004.A3: every kept screen renders with the kit and no unstyled control', async function reqDashtheme004A3() {
    const report: Record<string, string[]> = {};
    let controls = 0;
    for (const [name, path, el] of KEPT_SCREENS) {
      history.replaceState(null, '', path);
      mockFetch(name === 'review' ? REVIEW_ROUTES : ROUTES);
      const { container } = render(el());
      // Let every module's fetch settle (data or error state).
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      // Open the drifted row so the detail pane's action buttons render too.
      if (name === 'review') {
        const row = screen.queryByText('REQ-A-2');
        if (row) {
          fireEvent.click(row);
          await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        }
      }
      controls += container.querySelectorAll('button, [role="switch"], [role="radio"]').length;
      const bad = unstyledControls(container);
      if (bad.length) report[name] = bad;
      cleanup();
      vi.unstubAllGlobals();
    }
    expect(controls).toBeGreaterThan(30); // the sweep actually found controls
    expect(report).toEqual({});
  });
});

// ============================================================
// A4 — interactive states come from shared state tokens (REQ-DESKTOP-013)
// ============================================================

/** Kit control families whose state rules are under contract. */
const FAMILIES = ['btn-primary', 'btn-ghost', 'btn-outline', 'btn-secondary', 'btn-destructive', 'chip', 'card-btn', 'seg-btn', 'switch'];
const STATE_SELECTOR = /:hover|:active|:disabled|\.is-hover|\.is-active|\[aria-busy/;
/** A literal value in a declaration: px/ms/%/bare decimal, or a colour literal. */
const LITERAL = /(?<![\w-])\d*\.?\d+(?:px|ms|s|%|em|rem)?(?![\w-])|#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

describe('REQ-DASHTHEME-004.A4 — kit states use shared state tokens', () => {
  it('REQ-DASHTHEME-004.A4: hover, pressed, focus and disabled for every kit control read var(--…) state tokens and carry no literal', function reqDashtheme004A4() {
    const rules = cssRules(APP_CSS);
    const isFamily = (sel: string, fam: string) => new RegExp('\\.' + fam + '(?![\\w-])').test(sel);
    // Families whose disabled state is inherited from the shared .btn:disabled.
    const inheritsBtn = (fam: string) => fam.startsWith('btn-');

    for (const fam of FAMILIES) {
      // Pseudo-elements (the loading spinner's ::before) are decoration, not state rules.
      const stateRules = rules.filter((r) => !r.selectors.some((s) => s.includes('::')) && r.selectors.some((s) => (isFamily(s, fam) || (inheritsBtn(fam) && /^\.btn[:.[]/.test(s))) && STATE_SELECTOR.test(s)));
      const sels = stateRules.flatMap((r) => r.selectors);
      expect(sels.some((s) => isFamily(s, fam) && s.includes(':hover')), `${fam} hover`).toBe(true);
      expect(sels.some((s) => isFamily(s, fam) && s.includes(':active')), `${fam} pressed`).toBe(true);
      expect(sels.some((s) => s.includes(':disabled') && !s.includes(':not(:disabled)')), `${fam} disabled`).toBe(true);
      // Gallery mirrors exist so the Design system screen shows the same rule.
      expect(sels.some((s) => isFamily(s, fam) && s.includes('.is-hover')), `${fam} .is-hover`).toBe(true);
      expect(sels.some((s) => isFamily(s, fam) && s.includes('.is-active')), `${fam} .is-active`).toBe(true);

      for (const r of stateRules) {
        // Hover never fires on a disabled control (REQ-DESKTOP-013.A3).
        for (const s of r.selectors) {
          if (s.includes(':hover')) expect(s, `${fam}: ${s}`).toContain(':not(:disabled)');
        }
        const decls = r.body.split(';').map((d) => d.trim()).filter(Boolean);
        expect(decls.length, r.selectors.join(', ')).toBeGreaterThan(0);
        for (const d of decls) {
          const value = d.slice(d.indexOf(':') + 1).trim();
          // Every value is a token, or a non-numeric keyword (transparent, not-allowed, progress).
          const ok = value.includes('var(--') || /^[a-z-]+$/.test(value);
          expect(ok, `${r.selectors.join(', ')} → ${d}`).toBe(true);
          expect(value.replace(/var\(--[\w-]+\)/g, ''), `${r.selectors.join(', ')} → ${d} has a literal`).not.toMatch(LITERAL);
        }
      }
    }

    // Focus: the one shared ring, from the shared token chain, for every kit control.
    expect(cssRule(APP_CSS, ':focus-visible')).toContain('var(--focus-ring)');
    expect(rules.filter((r) => r.selectors.some((s) => /focus-visible/.test(s) && s !== ':focus-visible'))
      .filter((r) => r.selectors.some((s) => FAMILIES.some((f) => isFamily(s, f))))).toEqual([]);
    expect(TOKENS_CSS).toMatch(/--focus-ring:\s*2px solid var\(--border-focus\);/);
    // Shared state tokens exist and alias the design system.
    expect(TOKENS_CSS).toMatch(/--state-disabled-opacity:\s*0\.4;/);
    expect(TOKENS_CSS).toMatch(/--bg-hover:\s*var\(--bmg-color-fill-faint\);/);
    expect(TOKENS_CSS).toMatch(/--bg-active:\s*var\(--bmg-color-fill-tile\);/);
    expect(TOKENS_CSS).toMatch(/--accent-hover:\s*var\(--bmg-color-accent-hover\);/);
    expect(TOKENS_CSS).toMatch(/--accent-strong:\s*var\(--bmg-color-accent-pressed\);/);
  });
});
