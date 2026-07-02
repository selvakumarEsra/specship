import { test, expect } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4319);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * The dashboard-blank regression guard.
 *
 * The dashboard is served (and here opened) at 127.0.0.1. The bug this guards
 * against: the Angular client called the API at a *different* origin
 * (`localhost`), so every request — including the SSE streams — was
 * cross-origin and got CORS-blocked, and the whole dashboard rendered empty
 * even though the backend had data. This test opens the page at 127.0.0.1 and
 * asserts (a) the KPI tiles actually leave their loading skeleton and render
 * values, and (b) every /api call stayed same-origin, succeeded, and at least
 * one such call happened. On a regressed build the API calls go to a foreign
 * origin, the tiles never leave the skeleton, and both halves fail.
 */
test.describe('SpecShip Desktop dashboard @ 127.0.0.1', () => {
  test('renders live data with no cross-origin or failed API calls', async ({ page }) => {
    const failed: string[] = [];
    const crossOrigin: string[] = [];
    let sameOriginOk = 0;

    page.on('requestfailed', (req) => {
      if (req.url().includes('/api/')) {
        failed.push(`${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`);
      }
    });
    page.on('response', (res) => {
      const url = res.url();
      if (!url.includes('/api/')) return;
      if (!url.startsWith(ORIGIN)) crossOrigin.push(url);
      else if (res.status() < 400) sameOriginOk++;
    });

    await page.goto('/');

    // The real "data rendered" signal: all four KPI tiles leave their skeleton.
    await expect(page.locator('.stat-tile')).toHaveCount(4);
    await expect(page.locator('.stat-value:not(.skel)')).toHaveCount(4, { timeout: 30_000 });

    // The grid must show actual rendered numbers — not blank/skeleton.
    const gridText = (await page.locator('.stat-grid').innerText()).trim();
    expect(gridText, `stat grid rendered: ${JSON.stringify(gridText)}`).toMatch(/\d/);

    // The #55 guard: data flowed, and every /api call was same-origin & ok.
    expect(sameOriginOk, 'at least one same-origin /api call should have succeeded').toBeGreaterThan(0);
    expect(crossOrigin, `cross-origin /api requests:\n${crossOrigin.join('\n')}`).toEqual([]);
    expect(failed, `failed /api requests:\n${failed.join('\n')}`).toEqual([]);
  });

  test('the analytics + graph APIs the dashboard depends on return data', async ({ page }) => {
    // Graph: indexing the fixture produced nodes.
    const status = await page.request.get(`${ORIGIN}/api/status`);
    expect(status.ok()).toBeTruthy();
    const { nodeCount } = await status.json();
    expect(nodeCount, 'indexed graph should have nodes').toBeGreaterThan(0);

    // Analytics: the seeded transcripts were ingested and priced. lastSessionCost
    // is resolved through primaryProjectMatcher, so it is robust to the lossy
    // slug decode regardless of where the fixture lives on disk.
    const stats = await page.request.get(`${ORIGIN}/api/claude/stats`);
    expect(stats.ok()).toBeTruthy();
    const statsBody = await stats.json();
    expect(statsBody?.lastSessionCost?.value, 'seeded transcripts should yield a cost')
      .toBeGreaterThan(0);
  });
});
