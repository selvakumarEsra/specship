import { test, expect } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4319);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * REQ-DASHLEAN-004 / 006 — every kept page is server-rendered, and the dropped
 * write/interactive routes are not served.
 *
 * Assertions use the raw HTTP response (no JS) so they prove the page's content
 * comes from the server, not a client framework.
 */
const KEPT = [
  '/dashboard', '/specs', '/graph', '/drift', '/specship-impact', '/maintainability',
  '/domain', '/mcp', '/memory', '/improvements', '/compare', '/costs', '/heatmap',
  '/runs', '/sessions', '/tips', '/design-system', '/settings',
];
const DROPPED = ['/chat', '/design', '/workflows'];

test.describe('SSR pages render (REQ-DASHLEAN-004/006)', () => {
  for (const route of KEPT) {
    test(`server-renders ${route}`, async ({ page }) => {
      const res = await page.request.get(`${ORIGIN}${route}`);
      expect(res.status(), `${route} status`).toBe(200);
      const html = await res.text();
      expect(html, `${route} is server-rendered`).toContain('var(--sidebar-w)');
      expect(html, `${route} must not ship the Angular SPA`).not.toContain('app-root');
    });
  }

  for (const route of DROPPED) {
    test(`does not serve dropped route ${route}`, async ({ page }) => {
      const res = await page.request.get(`${ORIGIN}${route}`);
      expect(res.status(), `${route} should not be served`).toBe(404);
    });
  }

  test('the graph page renders the design screen with no client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/graph');
    // The design's graph screen renders server-side (SVG canvas panel); the
    // interactive pan/zoom island is re-wired into this markup as a follow-up.
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 30_000 });
    expect(errors, `graph page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
