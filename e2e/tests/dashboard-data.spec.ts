import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';

/**
 * The dashboard-renders-live-data guard, ported to the built SPA. `specship desktop`
 * serves the real app which fetches `/api/*` same-origin at
 * 127.0.0.1 — the exact condition the CORS/blank-dashboard class of bug (#55)
 * regressed on. If those fetches were cross-origin-blocked the Overview's
 * requirement-count tiles would never fill, so a rendered live count IS the
 * regression guard (REQ-DASHSIMPLE-002: the Overview shows no cost figures).
 */
test.describe('SPA Overview renders live data @ 127.0.0.1', () => {
  test('the Overview renders live requirement counts from /api data', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto('/dashboard');

    const region = page.locator('[data-screen="dashboard"]');
    await expect(region).toBeVisible();
    // A count tile shows a real rendered number (from /api/spec/coverage + /api/drift),
    // not a skeleton — proof the same-origin fetch resolved and painted.
    await expect(region.locator('[data-overview-count] .display-num').first()).toHaveText(/^\d+$/);
    await expect(region.getByTestId('freshness-text')).toBeVisible();

    await page.waitForTimeout(300);
    expect(guard.errors(), `dashboard console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('the APIs the Overview renders from return data', async ({ page }) => {
    const status = await page.request.get('/api/status');
    expect(status.ok()).toBeTruthy();
    const { nodeCount } = await status.json();
    expect(nodeCount, 'indexed graph should have nodes').toBeGreaterThan(0);

    const coverage = await page.request.get('/api/spec/coverage');
    expect(coverage.ok()).toBeTruthy();
    expect((await coverage.json())?.requirements?.length, 'the fixture spec should be indexed').toBeGreaterThan(0);

    const runs = await page.request.get('/api/workflows/runs');
    expect(runs.ok()).toBeTruthy();
    expect(Array.isArray((await runs.json())?.runs)).toBe(true);
  });
});
