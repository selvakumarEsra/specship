import { test, expect } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4319);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * The dashboard-renders-live-data guard, for the server-rendered dashboard
 * (DASH-LEAN-DOC). `serve --ui` now renders every page server-side in the same
 * process that serves `/api/*` (data via `app.inject`), so the regression this
 * guards is simpler than the old CORS/blank-SPA class: the page's real values
 * must be present in the *initial HTML* (REQ-DASHLEAN-004.A1), with no Angular
 * SPA and no client framework.
 */
test.describe('SSR dashboard renders live data @ 127.0.0.1', () => {
  test('the dashboard is server-rendered with real values', async ({ page }) => {
    // Raw HTML straight from the server — no JS executed. If the KPI values are
    // here, they were rendered server-side.
    const res = await page.request.get(`${ORIGIN}/dashboard`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();

    expect(html, 'server-rendered shell').toContain('class="shell"');
    expect(html, 'KPI tiles present').toMatch(/stat-tile/);
    // A tile's value is a real rendered number, not a skeleton.
    expect(html, 'a stat tile rendered a number').toMatch(/stat-value">[\d,]/);
    // No Angular SPA, no framework runtime.
    expect(html, 'no Angular shell').not.toContain('app-root');
    expect(html, 'no framework version marker').not.toMatch(/ng-version/);
    // The only client script is the islands enhancement layer.
    expect(html).toContain('/islands.js');
  });

  test('the analytics + graph APIs the dashboard renders from return data', async ({ page }) => {
    const status = await page.request.get(`${ORIGIN}/api/status`);
    expect(status.ok()).toBeTruthy();
    const { nodeCount } = await status.json();
    expect(nodeCount, 'indexed graph should have nodes').toBeGreaterThan(0);

    const stats = await page.request.get(`${ORIGIN}/api/claude/stats`);
    expect(stats.ok()).toBeTruthy();
    const statsBody = await stats.json();
    expect(statsBody?.lastSessionCost?.value, 'seeded transcripts should yield a cost')
      .toBeGreaterThan(0);
  });
});
