/**
 * REQ-DASHSIMPLE-003 — the Plan screen renders epic → story → task as a
 * distraction-free reader. Rendered against a fixture /api/spec/plan response.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverageVerdict, CriterionCoverage, DriftLink, PlanResponse, PlanStory, RequirementCoverage } from '../api';
import { __clearApiCache } from '../hooks';
import { PlanPage, storyStatus } from '../pages/plan';
import { classifyRequirement } from '../review-groups';
import { specParagraphs, specProse } from '../spec-prose';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- Fixture builders ----

const rollup = (count: number, state = 'implemented') => ({ count, states: count ? { [state]: count } : {} });

function crit(id: string, verdict: CoverageVerdict): CriterionCoverage {
  const tested = verdict !== 'untested';
  return {
    specId: id, title: 'Criterion text of ' + id, kind: 'acceptance',
    implementsLinks: rollup(0),
    testsLinks: tested ? rollup(1, verdict === 'broken' ? 'broken' : verdict === 'verified' ? 'verified' : 'implemented') : rollup(0),
    verdict,
  };
}

function cov(id: string, code: number, criteria: CriterionCoverage[], codeState = 'implemented'): RequirementCoverage {
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

function story(id: string, title: string, coverage: RequirementCoverage, jiraKey: string | null = null): PlanStory {
  return {
    specId: id, title, body: 'Body of ' + id + '.', jiraKey, coverage,
    tasks: coverage.criteria.map((c) => ({ specId: c.specId, title: c.title, verdict: c.verdict })),
  };
}

const ALL_VERDICTS = cov('REQ-A-001', 1, [
  crit('REQ-A-001.A1', 'untested'), crit('REQ-A-001.A2', 'tested'),
  crit('REQ-A-001.A3', 'verified'), crit('REQ-A-001.A4', 'broken'),
]);
const COMPLETED = cov('REQ-A-002', 1, [crit('REQ-A-002.A1', 'verified')]);
const DRIFTED = cov('REQ-B-001', 1, [crit('REQ-B-001.A1', 'verified')], 'orphaned');
const UNIMPL = cov('REQ-C-001', 0, [crit('REQ-C-001.A1', 'untested')]);

const DRIFT: DriftLink[] = [
  { id: 9, specId: 'REQ-B-001', kind: 'implements', state: 'orphaned', specTitle: 'Beta one', targetFilePath: 'src/gone.ts', targetQualifiedName: 'gone', driftAxis: null },
];

function plan(jiraBaseUrl: string | null): PlanResponse {
  return {
    jiraBaseUrl,
    driftLinks: DRIFT,
    epics: [
      {
        key: 'SSHIP-600', title: 'Alpha doc',
        docs: [
          { id: 'A-DOC', title: 'Alpha doc', stories: [story('REQ-A-001', 'Alpha one', ALL_VERDICTS, 'SSHIP-601'), story('REQ-A-002', 'Alpha two', COMPLETED)] },
          { id: 'B-DOC', title: 'Beta doc', stories: [story('REQ-B-001', 'Beta one', DRIFTED)] },
        ],
      },
      { key: null, title: 'Gamma doc', docs: [{ id: 'C-DOC', title: 'Gamma doc', stories: [story('REQ-C-001', 'Gamma one', UNIMPL)] }] },
    ],
  };
}

function mockFetch(body: unknown): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, 'http://local');
    if (u.pathname === '/api/spec/plan') return { ok: true, json: async () => body };
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not found' }) };
  }));
  return calls;
}

const storyIds = (root: ParentNode) =>
  Array.from(root.querySelectorAll('[data-plan-story]')).map((e) => e.getAttribute('data-plan-story'));

beforeEach(() => {
  history.replaceState(null, '', '/plan');
  localStorage.clear();
  __clearApiCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---- A1 ----

async function reqDashsimple003A1(): Promise<void> {
  mockFetch(plan(null));
  render(<PlanPage project={null} query={{}} />);
  const reader = await screen.findByTestId('plan-reader');
  const epicHeadings = within(reader).getAllByRole('heading', { level: 2 });
  expect(epicHeadings.filter((h) => h.textContent?.includes('SSHIP-600'))).toHaveLength(1);
  const epic = reader.querySelector('[data-plan-epic="SSHIP-600"]')!;
  // Both documents' requirements, in file order, under one epic.
  expect(storyIds(epic)).toEqual(['REQ-A-001', 'REQ-A-002', 'REQ-B-001']);
}

// ---- A2 ----

async function reqDashsimple003A2(): Promise<void> {
  mockFetch(plan(null));
  render(<PlanPage project={null} query={{}} />);
  await screen.findByTestId('plan-reader');
  const tasks = screen.getByRole('list', { name: 'Tasks of REQ-A-001' });
  const items = within(tasks).getAllByRole('listitem');
  expect(items.map((i) => i.getAttribute('data-verdict'))).toEqual(['untested', 'tested', 'verified', 'broken']);
  for (const [i, v] of (['untested', 'tested', 'verified', 'broken'] as const).entries()) {
    expect(items[i]!.textContent).toContain('Criterion text of REQ-A-001.A' + (i + 1));
    expect(within(items[i]!).getByText(v)).toBeTruthy();
  }
  // Each task deep-links to its place in Review.
  expect(within(items[0]!).getByRole('link').getAttribute('href')).toBe('/review/REQ-A-001.A1');
  expect(screen.getByRole('link', { name: 'Alpha one' }).getAttribute('href')).toBe('/review/REQ-A-001');

  // A story's status is the very group Review puts that requirement in.
  const p = plan(null);
  for (const s of p.epics.flatMap((e) => e.docs.flatMap((d) => d.stories))) {
    const reviewGroup = classifyRequirement(s.coverage!, p.driftLinks).group;
    expect(storyStatus(s, p.driftLinks)).toBe(reviewGroup);
    expect(document.querySelector(`[data-plan-story="${s.specId}"]`)!.getAttribute('data-status')).toBe(reviewGroup);
  }
  expect(document.querySelector('[data-plan-story="REQ-B-001"]')!.getAttribute('data-status')).toBe('drifted');
  expect(document.querySelector('[data-plan-story="REQ-A-002"]')!.getAttribute('data-status')).toBe('completed');
  expect(document.querySelector('[data-plan-story="REQ-C-001"]')!.getAttribute('data-status')).toBe('pending');
}

// ---- A3 ----

async function reqDashsimple003A3(): Promise<void> {
  mockFetch(plan(null));
  render(<PlanPage project={null} query={{}} />);
  const reader = await screen.findByTestId('plan-reader');
  const gamma = reader.querySelector('[data-plan-epic="Gamma doc"]')!;
  expect(gamma).toBeTruthy();
  expect(gamma.parentElement).toBe(reader); // a top-level group
  expect(within(gamma as HTMLElement).getByRole('heading', { level: 2 }).textContent).toBe('Gamma doc');
  expect(storyIds(gamma)).toEqual(['REQ-C-001']);
}

// ---- A4 ----

async function reqDashsimple003A4(): Promise<void> {
  const calls = mockFetch(plan('https://acme.atlassian.net'));
  const { unmount } = render(<PlanPage project={null} query={{}} />);
  await screen.findByTestId('plan-reader');
  const linked = document.querySelector('[data-jira-key="SSHIP-601"]')!;
  expect(linked.tagName).toBe('A');
  expect(linked.getAttribute('href')).toBe('https://acme.atlassian.net/browse/SSHIP-601');
  unmount();
  __clearApiCache();

  const calls2 = mockFetch(plan(null));
  render(<PlanPage project={null} query={{}} />);
  await screen.findByTestId('plan-reader');
  const plain = document.querySelector('[data-jira-key="SSHIP-601"]')!;
  expect(plain.tagName).toBe('SPAN');
  expect(plain.getAttribute('href')).toBeNull();

  // No JIRA network request — only the dashboard's own /api route.
  for (const u of [...calls, ...calls2]) {
    expect(u).not.toMatch(/atlassian|jira|\/rest\/api/i);
    expect(new URL(u, 'http://local').pathname).toBe('/api/spec/plan');
  }
}

// ---- A5 ----

async function reqDashsimple003A5(): Promise<void> {
  mockFetch(plan(null));
  render(<PlanPage project={null} query={{}} />);
  const reader = await screen.findByTestId('plan-reader');
  expect(reader.tagName).toBe('ARTICLE');
  expect(reader.classList.contains('plan-reader')).toBe(true);
  // The stylesheet caps the column at 75ch.
  const css = readFileSync(join(HERE, '..', 'styles', 'app.css'), 'utf8');
  const rule = css.match(/\.plan-reader\s*\{([^}]*)\}/);
  expect(rule?.[1]).toMatch(/max-width:\s*75ch/);
  // No side panels inside the reading area.
  expect(reader.querySelector('aside, nav, [role="complementary"], [role="navigation"], [class*="sidebar"], [class*="rail"]')).toBeNull();
}

// ---- A6 ----

async function reqDashsimple003A6(): Promise<void> {
  mockFetch(plan(null));
  const { unmount } = render(<PlanPage project={null} query={{}} />);
  const reader = await screen.findByTestId('plan-reader');
  const depth = () => ({
    epics: document.querySelectorAll('[data-plan-epic]').length,
    stories: document.querySelectorAll('[data-plan-story]').length,
    tasks: document.querySelectorAll('[data-plan-task]').length,
  });
  const group = screen.getByRole('radiogroup', { name: 'Plan depth' });
  const pick = (name: string) => fireEvent.click(within(group).getByRole('radio', { name }));

  expect(depth()).toEqual({ epics: 2, stories: 4, tasks: 7 }); // default: everything
  expect(reader).toBeTruthy();

  pick('Epics only');
  expect(depth()).toEqual({ epics: 2, stories: 0, tasks: 0 });
  pick('Epics + stories');
  expect(depth()).toEqual({ epics: 2, stories: 4, tasks: 0 });
  pick('Everything');
  expect(depth()).toEqual({ epics: 2, stories: 4, tasks: 7 });

  // The choice survives a reload.
  pick('Epics + stories');
  unmount();
  __clearApiCache();
  render(<PlanPage project={null} query={{}} />);
  await screen.findByTestId('plan-reader');
  expect(depth()).toEqual({ epics: 2, stories: 4, tasks: 0 });
  expect(within(screen.getByRole('radiogroup', { name: 'Plan depth' })).getByRole('radio', { name: 'Epics + stories' }).getAttribute('aria-checked')).toBe('true');
}

// ---- A7 ----

const WORDS = ['the', 'order', 'total', 'MUST', 'reader', 'story', 'plan', 'shows', 'each', 'item', 'with', 'a', '**bold**', '`code`', 'epic', 'task'];
const idArb = fc.tuple(fc.constantFrom('REQ-A-001', 'REQ-X-042', 'REQ-DASHSIMPLE-003'), fc.option(fc.integer({ min: 1, max: 9 })))
  .map(([id, n]) => (n == null ? id : id + '.A' + n));
const proseArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 14 }).map((w) => w.join(' '));
const symbolArb = fc.tuple(fc.constantFrom('src/a.ts', 'ui/src/pages/plan.tsx', '__tests__/x.test.ts'), fc.constantFrom('foo', 'Bar.baz', 'reqX'))
  .map(([f, s]) => '  - ' + f + ':' + s);
type Piece = { kind: 'prose'; text: string; wrapAt: number } | { kind: 'raw'; text: string };
const pieceArb: fc.Arbitrary<Piece> = fc.oneof(
  fc.record({ kind: fc.constant('prose' as const), text: proseArb, wrapAt: fc.integer({ min: 2, max: 8 }) }),
  idArb.map((id): Piece => ({ kind: 'raw', text: '<!-- id: ' + id + ' -->' })),
  fc.tuple(fc.constantFrom('implementations:', 'verifies:'), fc.array(symbolArb, { minLength: 0, maxLength: 4 }))
    .map(([label, items]): Piece => ({ kind: 'raw', text: [label, ...items].join('\n') })),
);
const acceptanceArb = fc.array(fc.tuple(idArb, proseArb), { minLength: 1, maxLength: 4 })
  .map((cs) => ['## Acceptance', ...cs.flatMap(([id, t]) => ['<!-- id: ' + id + ' -->', '- ' + t])].join('\n'));

/** Hard-wrap a paragraph every `n` words, the way spec files wrap prose. */
function wrap(text: string, n: number): string {
  const w = text.split(' ');
  const lines: string[] = [];
  for (let i = 0; i < w.length; i += n) lines.push(w.slice(i, i + n).join(' '));
  return lines.join('\n');
}

async function reqDashsimple003A7(): Promise<void> {
  // Property: whatever mix of prose, id markers and link blocks a body holds
  // (with its Acceptance section last, as spec files do), the cleaned text
  // carries no machine syntax and keeps every prose paragraph, one per block.
  fc.assert(fc.property(
    fc.array(pieceArb, { maxLength: 10 }), fc.option(acceptanceArb), fc.constantFrom('\n\n', '\n\n\n'),
    (pieces, acceptance, sep) => {
      const body = [...pieces.map((p) => (p.kind === 'prose' ? wrap(p.text, p.wrapAt) : p.text)), ...(acceptance ? [acceptance] : [])].join(sep);
      const out = specProse(body);
      expect(out).not.toMatch(/<!--\s*id:/);
      expect(out).not.toMatch(/^implementations:/m);
      expect(out).not.toMatch(/^verifies:/m);
      expect(out).not.toMatch(/^#+\s*Acceptance/m);
      expect(out).not.toMatch(/:(foo|Bar\.baz|reqX)$/m);
      const prose = pieces.filter((p): p is Extract<Piece, { kind: 'prose' }> => p.kind === 'prose').map((p) => p.text);
      expect(specParagraphs(body)).toEqual(prose);
    },
  ), { numRuns: 300 });

  // Rendered: the story body is prose paragraphs; criteria appear only as tasks.
  const raw = [
    '<!-- id: REQ-A-001 -->',
    'Alpha MUST read **well** and call `render()`.',
    'It wraps onto a second line.',
    '',
    'A second paragraph.',
    '',
    'implementations:',
    '  - ui/src/pages/plan.tsx:StorySection',
    '',
    'verifies:',
    '  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A7',
    '',
    '## Acceptance',
    '<!-- id: REQ-A-001.A1 -->',
    '- Criterion prose that belongs in tasks only.',
  ].join('\n');
  const p = plan(null);
  p.epics[0]!.docs[0]!.stories[0] = { ...p.epics[0]!.docs[0]!.stories[0]!, body: raw };
  mockFetch(p);
  render(<PlanPage project={null} query={{}} />);
  await screen.findByTestId('plan-reader');
  const section = document.querySelector('[data-plan-story="REQ-A-001"]') as HTMLElement;
  const tasks = within(section).getByRole('list', { name: 'Tasks of REQ-A-001' });
  const bodyText = Array.from(section.querySelectorAll('p.sp-prose')).map((e) => e.textContent);
  expect(bodyText).toEqual(['Alpha MUST read well and call render(). It wraps onto a second line.', 'A second paragraph.']);
  expect(section.querySelector('p.sp-prose strong')?.textContent).toBe('well');
  expect(section.querySelector('p.sp-prose code')?.textContent).toBe('render()');
  const outsideTasks = (section.textContent ?? '').replace(tasks.textContent ?? '', '');
  for (const s of ['<!--', 'implementations:', 'verifies:', 'Acceptance', 'StorySection', 'Criterion prose', '**']) {
    expect(outsideTasks).not.toContain(s);
  }
  expect(within(tasks).getAllByRole('listitem')).toHaveLength(4);
}

async function reqDashsimple003A8(): Promise<void> {
  // Titles at every level render `code` spans as code; markup stays text.
  const p = plan(null);
  p.epics[0]!.title = 'Epic for `buildPlan`';
  const s0 = p.epics[0]!.docs[0]!.stories[0]!;
  p.epics[0]!.docs[0]!.stories[0] = {
    ...s0,
    title: 'Story `specProse` MUST <b>strip</b>',
    tasks: s0.tasks.map((t, i) => (i === 0 ? { ...t, title: 'Task calls `renderProse()`' } : t)),
  };
  mockFetch(p);
  render(<PlanPage project={null} query={{}} />);
  await screen.findByTestId('plan-reader');
  const epic = document.querySelector('[data-plan-epic="SSHIP-600"] h2') as HTMLElement;
  const storyHead = document.querySelector('[data-plan-story="REQ-A-001"] h3') as HTMLElement;
  const task = document.querySelector('[data-plan-task="REQ-A-001.A1"]') as HTMLElement;
  for (const [el, code] of [[epic, 'buildPlan'], [storyHead, 'specProse'], [task, 'renderProse()']] as const) {
    expect(el.textContent).not.toContain('`');
    expect(el.querySelector('code')?.textContent).toBe(code);
  }
  expect(storyHead.querySelector('b')).toBeNull();
  expect(storyHead.textContent).toContain('<b>strip</b>');
}

describe('Plan reader (REQ-DASHSIMPLE-003)', () => {
  it('REQ-DASHSIMPLE-003.A1: documents sharing an epicKey render as one epic, stories in file order', reqDashsimple003A1);
  it('REQ-DASHSIMPLE-003.A2: each story lists its criteria as tasks with their test-evidence state', reqDashsimple003A2);
  it('REQ-DASHSIMPLE-003.A3: a document without an epicKey is its own group titled after the document', reqDashsimple003A3);
  it('REQ-DASHSIMPLE-003.A4: a JIRA key links only when a base URL is configured, with no JIRA request', reqDashsimple003A4);
  it('REQ-DASHSIMPLE-003.A5: the reader column is capped at 75ch with no side panels inside', reqDashsimple003A5);
  it('REQ-DASHSIMPLE-003.A6: the level toggle changes depth and the choice survives a reload', reqDashsimple003A6);
  it('REQ-DASHSIMPLE-003.A7: a story body renders as readable prose only, criteria only as tasks', reqDashsimple003A7);
  it('REQ-DASHSIMPLE-003.A8: titles render inline code as code, never raw backticks or live markup', reqDashsimple003A8);

  it('filters by epic, story and task titles', async () => {
    mockFetch(plan(null));
    render(<PlanPage project={null} query={{}} />);
    await screen.findByTestId('plan-reader');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the plan' }), { target: { value: 'gamma' } });
    expect(storyIds(document)).toEqual(['REQ-C-001']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the plan' }), { target: { value: 'REQ-A-001.A3' } });
    expect(Array.from(document.querySelectorAll('[data-plan-task]')).map((e) => e.getAttribute('data-plan-task'))).toEqual(['REQ-A-001.A3']);
  });

  it('shows an error with a retry when the plan fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({ error: 'boom' }) })));
    render(<PlanPage project={null} query={{}} />);
    expect(await screen.findByText('Couldn’t load the plan')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
