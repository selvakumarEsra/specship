import { test, expect, type Page, type Route } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';

/**
 * REQ-WFGATE-002 — the run view offers the verify step's test report and its
 * outcome (passed / failed + passed, failed and skipped counts), from that
 * run's own verify step; a missing or unreadable report is never shown as
 * passing; a report that disagrees with the step's result shows failed and
 * says so; a rerun shows its latest attempt; a purged run keeps its report.
 *
 * The workflow API is stubbed with `page.route` (as run-step-timing.spec.ts
 * does), so every report body is fixed and every assertion exact. What the
 * real route serves for each on-disk case is proven in
 * __tests__/workflow-test-report-route.test.ts.
 */

const T0 = Date.UTC(2026, 10, 7, 10, 0, 0);

const DEFINITION = {
  workflow: {
    name: 'spec-implement',
    description: 'Implement a spec.',
    inputs: [],
    nodes: [
      { id: 'implement', kind: 'prompt' },
      { id: 'verify', kind: 'bash', depends_on: ['implement'] },
      { id: 'link', kind: 'prompt', depends_on: ['verify'] },
    ],
  },
  scope: 'bundled',
  sourcePath: 'bundled:spec-implement.yaml',
};

type Ev = { id: number; workflowRunId: string; eventType: string; data: Record<string, unknown>; createdAt: number };
type Report = Record<string, unknown>;

const ev = (runId: string, id: number, eventType: string, stepId: string | null, createdAt: number): Ev => ({
  id, workflowRunId: runId, eventType, data: stepId ? { stepId } : {}, createdAt,
});

const available = (passed: number, failed: number, skipped: number, stepStatus: string, disagreement = false): Report => ({
  state: 'available', outcome: failed > 0 || stepStatus === 'failed' ? 'failed' : 'passed',
  passed, failed, skipped, stepStatus, disagreement,
});
const unavailable = (reason: string, stepStatus: string): Report => ({
  state: 'unavailable', outcome: null, passed: null, failed: null, skipped: null, stepStatus, disagreement: false, reason,
});

interface StubRun { run: Record<string, unknown>; events: Ev[]; report: Report }

/** A run whose verify step ran once and ended `end`. */
function runWith(id: string, base: number, end: 'step_completed' | 'step_failed', report: Report, status?: string): StubRun {
  let n = 0;
  const e = (type: string, step: string | null, at: number) => ev(id, ++n + base / 1000, type, step, at);
  return {
    run: {
      id, workflowName: 'spec-implement', status: status ?? (end === 'step_failed' ? 'failed' : 'completed'),
      inputs: {}, startedAt: base, completedAt: base + 90_000, lastActivityAt: base + 90_000, createdAt: base, metadata: {},
    },
    events: [
      e('run_started', null, base),
      e('step_started', 'implement', base + 1_000),
      e('step_completed', 'implement', base + 40_000),
      e('step_started', 'verify', base + 41_000),
      e(end, 'verify', base + 80_000),
    ],
    report,
  };
}

function buildRuns(): Record<string, StubRun> {
  const runs: StubRun[] = [
    runWith('run-green', T0, 'step_completed', available(12, 0, 3, 'completed')),
    runWith('run-red', T0 + 1_000_000, 'step_failed', available(4, 3, 0, 'failed')),
    runWith('run-cargo', T0 + 2_000_000, 'step_completed', unavailable('not-vitest', 'completed')),
    runWith('run-noframework', T0 + 3_000_000, 'step_completed', unavailable('skipped', 'completed')),
    runWith('run-buildfail', T0 + 4_000_000, 'step_failed', unavailable('build-failed', 'failed')),
    runWith('run-envfail', T0 + 5_000_000, 'step_failed', unavailable('env-failed', 'failed')),
    runWith('run-truncated', T0 + 6_000_000, 'step_completed', {
      state: 'unreadable', outcome: null, passed: null, failed: null, skipped: null, stepStatus: 'completed',
      disagreement: false, detail: 'Unexpected end of JSON input',
    }),
    runWith('run-liar', T0 + 7_000_000, 'step_failed', available(9, 0, 0, 'failed', true)),
    runWith('run-purged', T0 + 8_000_000, 'step_completed', available(5, 0, 1, 'completed'), 'rejected'),
  ];
  // A resumed run: verify failed on attempt 1; the live tail (held until the
  // test releases it) carries attempt 2, which passes.
  const rerun = runWith('run-rerun', T0 + 9_000_000, 'step_failed', available(18, 2, 0, 'failed'), 'running');
  runs.push(rerun);
  return Object.fromEntries(runs.map((r) => [r.run.id as string, r]));
}

const RERUN_BASE = T0 + 9_000_000;
const RERUN_LIVE: Ev[] = [
  ev('run-rerun', 9_001, 'step_started', 'verify', RERUN_BASE + 120_000),
  ev('run-rerun', 9_002, 'step_completed', 'verify', RERUN_BASE + 150_000),
];

interface Stub {
  runs: Record<string, StubRun>;
  reportRequests: string[];
  /** Release run-rerun's held SSE tail (its second verify attempt). */
  releaseRerun: () => void;
}

async function stubWorkflowApi(page: Page): Promise<Stub> {
  const runs = buildRuns();
  const reportRequests: string[] = [];
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let rerunDone = false;

  await page.route((url) => url.pathname.startsWith('/api/workflows'), async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/workflows') return json({ workflows: [DEFINITION], errors: [] });
    if (path === '/api/workflows/runs') return json({ runs: Object.values(runs).map((r) => r.run) });
    const m = path.match(/^\/api\/workflows\/runs\/([^/]+)(\/.*)?$/);
    const id = m ? decodeURIComponent(m[1]!) : '';
    const r = runs[id];
    if (!r) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
    const sub = m![2];
    if (sub === '/events') {
      if (id === 'run-rerun' && !rerunDone) {
        await released;
        rerunDone = true;
        // Attempt 2 passed and replaced the report; the run then completed.
        r.events = [...r.events, ...RERUN_LIVE];
        r.report = available(20, 0, 0, 'completed');
        r.run = { ...r.run, status: 'completed' };
        const frames = RERUN_LIVE.map((e) => `event: ${e.eventType}\ndata: ${JSON.stringify(e)}\n\n`).join('');
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `${frames}event: done\ndata: {}\n\n` });
      }
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' });
    }
    if (sub === '/artifacts') return json({ artifacts: [] });
    if (sub === '/test-report') { reportRequests.push(id); return json(r.report); }
    if (sub === '/purge' && req.method() === 'POST') {
      r.events = [...r.events, ev(id, 99_999, 'run_purged', null, (r.run.lastActivityAt as number) + 1_000)];
      return json({ ok: true, worktreeRemoved: true });
    }
    return json({ run: r.run, events: r.events });
  });
  return { runs, reportRequests, releaseRerun: () => release() };
}

const panel = (page: Page) => page.locator('[data-test-report-state]');
const count = (page: Page, k: 'passed' | 'failed' | 'skipped') => panel(page).locator(`[data-count="${k}"]`);

async function openRun(page: Page, runId: string): Promise<void> {
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-node-id="verify"]')).toBeVisible();
}

/** Assert the panel shows no passing outcome in any form. */
async function expectNoPass(page: Page): Promise<void> {
  await expect(page.locator('[data-test-report-outcome="passed"]')).toHaveCount(0);
  await expect(panel(page).locator('[data-count]')).toHaveCount(0);
  await expect(panel(page)).not.toContainText(/\bpassed\b/i);
}

async function reqWfgate002A1({ page }: { page: Page }) {
  const guard = captureConsoleErrors(page);
  const stub = await stubWorkflowApi(page);
  await openRun(page, 'run-green');

  await expect(panel(page)).toHaveAttribute('data-test-report-state', 'available');
  await expect(panel(page)).toHaveAttribute('data-test-report-outcome', 'passed');
  await expect(panel(page)).toContainText('Verify tests');
  await expect(count(page, 'passed')).toHaveText('12 passed');
  await expect(count(page, 'failed')).toHaveText('0 failed');
  await expect(count(page, 'skipped')).toHaveText('3 skipped');
  // Fetched from this run's own report endpoint.
  expect(stub.reportRequests.length).toBeGreaterThan(0);
  expect(new Set(stub.reportRequests)).toEqual(new Set(['run-green']));
  expect(guard.errors()).toEqual([]);
}

async function reqWfgate002A2({ page }: { page: Page }) {
  const stub = await stubWorkflowApi(page);
  await openRun(page, 'run-green');
  await expect(count(page, 'passed')).toHaveText('12 passed');

  // Switch runs without a remount through the list (as back/forward does).
  await page.evaluate(() => {
    history.pushState(null, '', '/runs/run-red');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/runs\/run-red$/);
  await expect(panel(page)).toHaveAttribute('data-test-report-outcome', 'failed');
  await expect(count(page, 'passed')).toHaveText('4 passed');
  await expect(count(page, 'failed')).toHaveText('3 failed');
  await expect(count(page, 'skipped')).toHaveText('0 skipped');
  await expect(panel(page)).not.toContainText('12 passed');
  expect(stub.reportRequests).toContain('run-red');

  // And back: run-green shows only its own report again.
  await openRun(page, 'run-green');
  await expect(count(page, 'passed')).toHaveText('12 passed');
  await expect(count(page, 'failed')).toHaveText('0 failed');
}

async function reqWfgate002A3({ page }: { page: Page }) {
  await stubWorkflowApi(page);
  const cases: Array<[string, string, RegExp]> = [
    ['run-cargo', 'not-vitest', /not a vitest project/i],
    ['run-noframework', 'skipped', /no recognised test framework/i],
    ['run-buildfail', 'build-failed', /build failed before the tests ran/i],
    ['run-envfail', 'env-failed', /environment failed .* before the tests ran/i],
  ];
  for (const [runId, reason, text] of cases) {
    await openRun(page, runId);
    await expect(panel(page)).toHaveAttribute('data-test-report-state', 'unavailable');
    await expect(panel(page)).toHaveAttribute('data-test-report-reason', reason);
    await expect(panel(page)).toContainText('unavailable');
    await expect(panel(page)).toContainText(text);
    await expectNoPass(page);
  }
}

async function reqWfgate002A4({ page }: { page: Page }) {
  await stubWorkflowApi(page);
  await openRun(page, 'run-truncated');
  await expect(panel(page)).toHaveAttribute('data-test-report-state', 'unreadable');
  await expect(panel(page)).toContainText('unreadable');
  await expect(panel(page)).toContainText('could not be read');
  // The verify step itself completed — the view still never claims a pass.
  await expect(page.locator('[data-node-id="verify"]')).toHaveAttribute('data-node-state', 'completed');
  await expectNoPass(page);
}

async function reqWfgate002A5({ page }: { page: Page }) {
  await stubWorkflowApi(page);

  // A failing suite shows failed with its counts.
  await openRun(page, 'run-red');
  await expect(panel(page)).toHaveAttribute('data-test-report-outcome', 'failed');
  await expect(panel(page).locator('.pill')).toHaveText('failed');
  await expect(count(page, 'failed')).toHaveText('3 failed');
  await expect(page.locator('[data-test-report-disagreement]')).toHaveCount(0);

  // Every test passed in the report, but the verify step failed.
  await openRun(page, 'run-liar');
  await expect(page.locator('[data-node-id="verify"]')).toHaveAttribute('data-node-state', 'failed');
  await expect(panel(page)).toHaveAttribute('data-test-report-outcome', 'failed');
  await expect(panel(page).locator('.pill')).toHaveText('failed');
  await expect(count(page, 'passed')).toHaveText('9 passed');
  await expect(count(page, 'failed')).toHaveText('0 failed');
  await expect(page.locator('[data-test-report-disagreement]')).toBeVisible();
  await expect(page.locator('[data-test-report-disagreement]')).toContainText('disagree');
}

async function reqWfgate002A6({ page }: { page: Page }) {
  const stub = await stubWorkflowApi(page);
  await openRun(page, 'run-rerun');

  // Attempt 1 (failed) until the rerun's events arrive.
  await expect(page.locator('[data-node-id="verify"]')).toHaveAttribute('data-node-state', 'failed');
  await expect(count(page, 'failed')).toHaveText('2 failed');
  await expect(count(page, 'passed')).toHaveText('18 passed');

  stub.releaseRerun();

  // The rerun completed: the view now shows attempt 2's report only.
  await expect(page.locator('[data-node-id="verify"]')).toHaveAttribute('data-node-state', 'completed');
  await expect(page.locator('[data-node-id="verify"] [data-step-started]'))
    .toHaveAttribute('data-step-started', String(RERUN_BASE + 120_000));
  await expect(panel(page)).toHaveAttribute('data-test-report-outcome', 'passed');
  await expect(count(page, 'passed')).toHaveText('20 passed');
  await expect(count(page, 'failed')).toHaveText('0 failed');
  await expect(panel(page)).not.toContainText('18 passed');
}

async function reqWfgate002A7({ page }: { page: Page }) {
  const stub = await stubWorkflowApi(page);
  await openRun(page, 'run-purged');
  await expect(count(page, 'passed')).toHaveText('5 passed');

  const purge = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/workflows/runs/run-purged/purge'));
  await page.getByRole('button', { name: 'Purge worktree' }).click();
  await purge;
  expect(stub.runs['run-purged']!.events.some((e) => e.eventType === 'run_purged')).toBe(true);

  // After the purge the view reloads and the report is still there.
  await page.reload();
  await expect(page.locator('[data-node-id="verify"]')).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-test-report-state', 'available');
  await expect(panel(page)).toHaveAttribute('data-test-report-outcome', 'passed');
  await expect(count(page, 'passed')).toHaveText('5 passed');
  await expect(count(page, 'skipped')).toHaveText('1 skipped');
}

test.describe('Run view verify test report (REQ-WFGATE-002)', () => {
  test('REQ-WFGATE-002.A1 shows the verify report with outcome and counts from this run', reqWfgate002A1);
  test('REQ-WFGATE-002.A2 two runs each show only their own report', reqWfgate002A2);
  test('REQ-WFGATE-002.A3 no report → explicit unavailable state, never passing', reqWfgate002A3);
  test('REQ-WFGATE-002.A4 a truncated / invalid report shows unreadable, not passing', reqWfgate002A4);
  test('REQ-WFGATE-002.A5 outcome matches the report; a pass on a failed step shows failed + disagreement', reqWfgate002A5);
  test('REQ-WFGATE-002.A6 a rerun verify step shows the latest attempt\'s report', reqWfgate002A6);
  test('REQ-WFGATE-002.A7 a purged run still shows its report', reqWfgate002A7);
});
