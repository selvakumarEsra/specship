import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';
import { FAULT_ROUTE, URL_FAULT } from '../lib/ports';

/**
 * REQ-TVIZ-004.A1/.A2 — when a data route fails, the SPA must show a visible
 * error state, not a blank screen.
 *
 * The fault server (playwright.config.ts) boots with `E2E_FAULT=/api/claude/stats`,
 * so the dashboard's usage-stats fetch 500s while every other route stays
 * healthy. That isolates the question these tests exist to answer: does the app
 * degrade in place, or does the whole screen go dark?
 *
 * Console-error policy: a 500 response makes Chrome log a "Failed to load
 * resource" error that no product change can suppress, so the strict
 * zero-console-error bar can't apply verbatim here. Rather than widen the
 * shared allowlist in `lib/console.ts` (kept empty by design), this spec passes
 * its OWN allowlist matching only that browser-emitted resource line, and then
 * independently asserts that the injected route was the only failing request —
 * so an unrelated 500, or an uncaught exception in the app's error path, still
 * fails the test.
 */
const RESOURCE_500 = /Failed to load resource.*\b500\b/;

test.describe('A failing API route degrades to an error state (REQ-TVIZ-004.A1)', () => {
  test('the dashboard renders a visible error state, not a blank screen', async ({ page }) => {
    const guard = captureConsoleErrors(page, [RESOURCE_500]);
    const failures: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 400) failures.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(`${URL_FAULT}/dashboard`);

    // Not blank: the React app mounted and the dashboard screen is present.
    await expect(page.locator('#root')).not.toBeEmpty();
    const region = page.locator('[data-screen="dashboard"]');
    await expect(region).toBeVisible();

    // The failed module renders the shared error state with its Retry affordance
    // (components/dashboard-modules.tsx `Module`), naming what couldn't load.
    await expect(region.getByText(/Couldn't load usage stats/i)).toBeVisible();
    await expect(region.getByRole('button', { name: 'Retry' }).first()).toBeVisible();

    // Neighbouring modules still painted — the failure is contained, not global.
    await expect(region.getByText('Dashboard', { exact: false }).first()).toBeVisible();

    await page.waitForTimeout(400);

    // Only the deliberately-injected route failed.
    expect(failures.filter((f) => !f.includes(FAULT_ROUTE)), `unexpected failing requests:\n${failures.join('\n')}`)
      .toEqual([]);
    expect(failures.some((f) => f.includes(FAULT_ROUTE)), 'the injected fault should have fired').toBe(true);

    // Nothing beyond the unavoidable browser resource line — in particular the
    // app's error path must not throw.
    expect(guard.errors(), `unexpected console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('the fault knob 500s only the selected route (REQ-TVIZ-004.A2)', async ({ page }) => {
    const faulted = await page.request.get(`${URL_FAULT}${FAULT_ROUTE}?range=week`);
    expect(faulted.status()).toBe(500);
    expect((await faulted.json()).code).toBe('e2e_fault');

    // Same server, unselected routes — untouched.
    const status = await page.request.get(`${URL_FAULT}/api/status`);
    expect(status.ok(), 'unselected /api routes must still succeed').toBeTruthy();
    expect((await status.json()).nodeCount).toBeGreaterThan(0);
  });

  test('Retry recovers once the route stops failing', async ({ page }) => {
    const guard = captureConsoleErrors(page, [RESOURCE_500]);
    await page.goto(`${URL_FAULT}/dashboard`);

    const region = page.locator('[data-screen="dashboard"]');
    await expect(region.getByText(/Couldn't load usage stats/i)).toBeVisible();

    // Heal the route from here on (the server keeps faulting; the browser no
    // longer reaches it), then click the module's Retry: the error state must be
    // replaced by rendered data, proving the failure isn't sticky.
    const metric = { value: 1.23, delta: 0, series: [1, 2, 3] };
    await page.route(`**${FAULT_ROUTE}**`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionCount: 1,
        lastSessionCost: metric,
        toolCalls: metric,
        subagentPct: metric,
        drift: metric,
        ingest: null,
      }),
    }));

    await region.getByRole('button', { name: 'Retry' }).first().click();
    await expect(region.getByText(/Couldn't load usage stats/i)).toHaveCount(0);

    expect(guard.errors(), `unexpected console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });
});
