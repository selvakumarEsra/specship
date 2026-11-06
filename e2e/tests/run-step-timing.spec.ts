import { test, expect, type Page, type Route } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';

/**
 * REQ-WFGATE-001 — the run view shows each step's own status, start time,
 * and (once ended) finish time + duration, all from that run's own step
 * events, separate from the run's overall status.
 *
 * The workflow API is stubbed with `page.route` (as api-failure.spec.ts heals
 * its route), so every event timestamp is fixed and every assertion is exact.
 * The live SSE tail is answered with an immediate `done` frame so it never
 * appends anything the stub didn't declare.
 */

const T0 = Date.UTC(2026, 10, 7, 9, 0, 0); // fixed, well clear of "now"

const DEFINITION = {
  workflow: {
    name: 'spec-fix',
    description: 'Fix a drifted spec link.',
    inputs: [],
    // Deliberately listed out of order: the view must topo-sort (A1).
    nodes: [
      { id: 'verify', kind: 'bash', depends_on: ['gate'] },
      { id: 'gate', kind: 'approval', depends_on: ['docs'] },
      { id: 'docs', kind: 'prompt', depends_on: ['lint'] },
      { id: 'lint', kind: 'bash', depends_on: ['plan'] },
      { id: 'plan', kind: 'prompt' },
    ],
  },
  scope: 'bundled',
  sourcePath: 'bundled:spec-fix.yaml',
};

type Ev = { id: number; workflowRunId: string; eventType: string; data: Record<string, unknown>; createdAt: number };

const ev = (runId: string, id: number, eventType: string, stepId: string | null, createdAt: number): Ev => ({
  id, workflowRunId: runId, eventType, data: stepId ? { stepId } : {}, createdAt,
});

/**
 * A paused run at its gate: plan completed, lint failed (later resumed past),
 * docs skipped, gate awaiting approval, verify never started.
 */
function pausedRun(runId: string, base: number) {
  return {
    run: {
      id: runId,
      workflowName: 'spec-fix',
      status: 'paused',
      inputs: {},
      startedAt: base,
      lastActivityAt: base + 60_000,
      createdAt: base,
      metadata: { approval: { type: 'approval', nodeId: 'gate', message: 'Review before merge' } },
    },
    events: [
      ev(runId, 1, 'run_started', null, base),
      ev(runId, 2, 'step_started', 'plan', base + 1_000),
      ev(runId, 3, 'step_completed', 'plan', base + 31_000),
      ev(runId, 4, 'step_started', 'lint', base + 32_000),
      ev(runId, 5, 'step_failed', 'lint', base + 37_000),
      ev(runId, 6, 'step_skipped', 'docs', base + 38_000),
      ev(runId, 7, 'approval_requested', null, base + 39_000),
    ],
  };
}

const RUN_A = pausedRun('run-alpha', T0);
// Same workflow, overlapping, different times and a different step outcome.
const RUN_B = (() => {
  const base = T0 + 7_000;
  const r = pausedRun('run-beta', base);
  r.run.status = 'running';
  r.run.metadata = {} as typeof r.run.metadata;
  r.events = [
    ev('run-beta', 101, 'run_started', null, base),
    ev('run-beta', 102, 'step_started', 'plan', base + 2_000),
    ev('run-beta', 103, 'step_completed', 'plan', base + 14_000),
    ev('run-beta', 104, 'step_started', 'lint', base + 15_000),
  ];
  return r;
})();

const RUNS: Record<string, { run: Record<string, unknown>; events: Ev[] }> = {
  'run-alpha': RUN_A,
  'run-beta': RUN_B,
};

async function stubWorkflowApi(page: Page): Promise<void> {
  await page.route((url) => url.pathname.startsWith('/api/workflows'), async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/workflows') return json({ workflows: [DEFINITION], errors: [] });
    if (path === '/api/workflows/runs') return json({ runs: Object.values(RUNS).map((r) => r.run) });
    const m = path.match(/^\/api\/workflows\/runs\/([^/]+)(\/.*)?$/);
    const r = m ? RUNS[decodeURIComponent(m[1]!)] : undefined;
    if (!r) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
    if (m![2] === '/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' });
    }
    if (m![2] === '/artifacts') return json({ artifacts: [] });
    return json(r);
  });
}

/** Format a timestamp the way the view does (browser locale + timezone). */
const clock = (page: Page, ms: number) => page.evaluate((v) => new Date(v).toLocaleTimeString(), ms);

const chip = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);

async function openRun(page: Page, runId: string): Promise<void> {
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
}

async function reqWfgate001A1({ page }: { page: Page }) {
  const guard = captureConsoleErrors(page);
  await stubWorkflowApi(page);
  await openRun(page, 'run-alpha');

  const order = await page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')));
  expect(order).toEqual(['plan', 'lint', 'docs', 'gate', 'verify']);

  const states = await page.locator('[data-node-id]').evaluateAll((els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute('data-node-id'), e.getAttribute('data-node-state')])));
  expect(states).toEqual({ plan: 'completed', lint: 'failed', docs: 'skipped', gate: 'paused', verify: 'pending' });
  expect(guard.errors()).toEqual([]);
}

async function reqWfgate001A2({ page }: { page: Page }) {
  await stubWorkflowApi(page);
  await openRun(page, 'run-alpha');

  // Ended step: start, finish and duration all from its own events.
  const plan = chip(page, 'plan');
  await expect(plan.locator('[data-step-started]')).toHaveAttribute('data-step-started', String(T0 + 1_000));
  await expect(plan.locator('[data-step-finished]')).toHaveAttribute('data-step-finished', String(T0 + 31_000));
  await expect(plan.locator('[data-step-duration]')).toHaveAttribute('data-step-duration', '30000');
  await expect(plan.locator('[data-step-started]')).toHaveText(await clock(page, T0 + 1_000));
  await expect(plan.locator('[data-step-finished]')).toContainText(await clock(page, T0 + 31_000));
  await expect(plan.locator('[data-step-duration]')).toContainText('30s');

  // A failed step has ended too.
  const lint = chip(page, 'lint');
  await expect(lint.locator('[data-step-duration]')).toHaveAttribute('data-step-duration', '5000');

  // Started-but-not-ended step (run-beta's lint): start time only.
  await openRun(page, 'run-beta');
  const running = chip(page, 'lint');
  await expect(running).toHaveAttribute('data-node-state', 'running');
  await expect(running.locator('[data-step-started]')).toHaveAttribute('data-step-started', String(T0 + 7_000 + 15_000));
  await expect(running.locator('[data-step-finished]')).toHaveCount(0);
  await expect(running.locator('[data-step-duration]')).toHaveCount(0);
}

async function reqWfgate001A3({ page }: { page: Page }) {
  await stubWorkflowApi(page);
  await openRun(page, 'run-alpha');
  await expect(chip(page, 'plan').locator('[data-step-started]')).toHaveAttribute('data-step-started', String(T0 + 1_000));
  await expect(chip(page, 'lint')).toHaveAttribute('data-node-state', 'failed');

  // In-app navigation to the other concurrent run of the same workflow.
  await page.getByRole('button', { name: 'Runs' }).first().click();
  await page.getByText('run-beta', { exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/run-beta$/);

  const B = T0 + 7_000;
  await expect(chip(page, 'plan').locator('[data-step-started]')).toHaveAttribute('data-step-started', String(B + 2_000));
  await expect(chip(page, 'plan').locator('[data-step-finished]')).toHaveAttribute('data-step-finished', String(B + 14_000));
  await expect(chip(page, 'plan').locator('[data-step-duration]')).toHaveAttribute('data-step-duration', '12000');
  await expect(chip(page, 'lint')).toHaveAttribute('data-node-state', 'running');
  // Nothing of run-alpha's survives: docs/gate never ran in run-beta.
  await expect(chip(page, 'docs')).toHaveAttribute('data-node-state', 'pending');
  await expect(chip(page, 'gate')).toHaveAttribute('data-node-state', 'pending');
  await expect(chip(page, 'docs').locator('[data-step-timing]')).toHaveCount(0);
  const allStarts = await page.locator('[data-step-started]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-step-started'))));
  expect(allStarts).toEqual([B + 2_000, B + 15_000]);
}

async function reqWfgate001A4({ page }: { page: Page }) {
  await stubWorkflowApi(page);
  await openRun(page, 'run-alpha');

  // Gate awaiting a decision shows paused on the step itself, while the run
  // carries its own separate status pill.
  await expect(chip(page, 'gate')).toHaveAttribute('data-node-state', 'paused');
  await expect(page.getByText('Approval required')).toBeVisible();

  const look = (id: string) => chip(page, id).evaluate((el) => {
    const s = getComputedStyle(el);
    const dot = el.querySelector('span');
    return {
      border: `${s.borderTopStyle} ${s.borderTopColor}`,
      dot: dot ? getComputedStyle(dot).backgroundColor : '',
      icon: dot?.querySelector('svg')?.outerHTML ?? '',
    };
  });
  const completed = await look('plan');
  const failed = await look('lint');
  const skipped = await look('docs');
  const paused = await look('gate');

  expect(failed.border).not.toEqual(completed.border);
  expect(failed.dot).not.toEqual(completed.dot);
  expect(failed.icon).not.toEqual(completed.icon);
  expect(skipped.border).not.toEqual(completed.border);
  expect(skipped.border.startsWith('dotted')).toBe(true);
  expect(skipped.icon).not.toEqual(completed.icon);
  expect(paused.border).not.toEqual(completed.border);
  expect(paused.icon).not.toEqual(completed.icon);
}

async function reqWfgate001A5({ page }: { page: Page }) {
  await stubWorkflowApi(page);
  await openRun(page, 'run-alpha');

  // verify never started: no timing at all, although the run has startedAt
  // and lastActivityAt and its neighbours have times.
  const verify = chip(page, 'verify');
  await expect(verify).toHaveAttribute('data-node-state', 'pending');
  await expect(verify.locator('[data-step-timing]')).toHaveCount(0);
  await expect(verify.locator('[data-step-started], [data-step-finished], [data-step-duration]')).toHaveCount(0);
  const runStart = await clock(page, T0);
  const runLast = await clock(page, T0 + 60_000);
  await expect(verify).not.toContainText(runStart);
  await expect(verify).not.toContainText(runLast);

  // The gate has no step_started of its own — paused, but no borrowed time.
  await expect(chip(page, 'gate').locator('[data-step-timing]')).toHaveCount(0);
  // Skipped without starting: a finish time, but no start or duration.
  const docs = chip(page, 'docs');
  await expect(docs.locator('[data-step-finished]')).toHaveAttribute('data-step-finished', String(T0 + 38_000));
  await expect(docs.locator('[data-step-started]')).toHaveCount(0);
  await expect(docs.locator('[data-step-duration]')).toHaveCount(0);
}

test.describe('Run view step timing and status (REQ-WFGATE-001)', () => {
  test('REQ-WFGATE-001.A1 steps list in execution order, each with its own status', reqWfgate001A1);
  test('REQ-WFGATE-001.A2 started/ended steps show their own start, finish and duration', reqWfgate001A2);
  test('REQ-WFGATE-001.A3 two concurrent runs each show only their own step times and states', reqWfgate001A3);
  test('REQ-WFGATE-001.A4 a waiting gate shows paused; failed and skipped look different from completed', reqWfgate001A4);
  test('REQ-WFGATE-001.A5 a step that has not started shows no borrowed time', reqWfgate001A5);
});
