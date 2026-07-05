import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';

/**
 * The dashboard-renders-live-data guard, ported to the built SPA. `serve --ui
 * --no-ssr` serves the real app which fetches `/api/*` same-origin at
 * 127.0.0.1 — the exact condition the CORS/blank-dashboard class of bug (#55)
 * regressed on. If those fetches were cross-origin-blocked the KPI tiles would
 * never fill, so a rendered live cost value IS the regression guard.
 */
test.describe('SPA dashboard renders live data @ 127.0.0.1', () => {
  test('the dashboard renders a real cost value from live /api data', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto('/dashboard');

    const region = page.locator('[data-screen="dashboard"]');
    await expect(region).toBeVisible();
    // A KPI tile shows a real rendered currency value (from /api/claude/stats),
    // not a skeleton — proof the same-origin fetch resolved and painted.
    await expect(region.getByText(/\$\d+\.\d{2}/).first()).toBeVisible();

    await page.waitForTimeout(300);
    expect(guard.errors(), `dashboard console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('the analytics + graph APIs the dashboard renders from return data', async ({ page }) => {
    const status = await page.request.get('/api/status');
    expect(status.ok()).toBeTruthy();
    const { nodeCount } = await status.json();
    expect(nodeCount, 'indexed graph should have nodes').toBeGreaterThan(0);

    const stats = await page.request.get('/api/claude/stats');
    expect(stats.ok()).toBeTruthy();
    const statsBody = await stats.json();
    expect(statsBody?.lastSessionCost?.value, 'seeded transcripts should yield a cost')
      .toBeGreaterThan(0);
  });
});
