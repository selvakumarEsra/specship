import { test, expect } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4319);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * List → detail drill-down (REQ-DASHLEAN-005): the design's list rows are
 * real server-rendered links, so clicking a Sessions / Specs item navigates
 * to its detail page (dashboard L1 → list L2 → detail L3). The raw-HTML
 * assertions prove the links exist without JS; the click-through test proves
 * the instant-nav island actually takes the user there in the browser.
 */
test.describe('List rows navigate to detail pages', () => {
  test('session rows are server-rendered links to /sessions/:id', async ({ page }) => {
    const html = await (await page.request.get(`${ORIGIN}/sessions`)).text();
    expect(html, 'seeded session rows are anchors').toMatch(/href="\/sessions\/e2e-sess-\d+"/);
  });

  test('a session detail page server-renders for a seeded session', async ({ page }) => {
    const res = await page.request.get(`${ORIGIN}/sessions/e2e-sess-1`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html, 'detail page keeps the design shell').toContain('var(--sidebar-w)');
    expect(html, 'detail page shows the session prompts').toContain('Prompts');
  });

  test('dashboard → sessions → session detail → back (L1 → L2 → L3)', async ({ page }) => {
    await page.goto('/dashboard');

    // L1 → L2: the sidebar's Sessions entry.
    await page.locator('a[href="/sessions"]').first().click();
    await expect(page).toHaveURL(/\/sessions$/);

    // L2 → L3: click a session row.
    const row = page.locator('a[href^="/sessions/"]').first();
    await expect(row).toBeVisible();
    const href = (await row.getAttribute('href'))!;
    await row.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(page.getByText('← Sessions')).toBeVisible();
    await expect(page.getByText('Prompts').first()).toBeVisible();

    // L3 → L2: the detail page's back link returns to the list.
    await page.getByText('← Sessions').click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.locator('a[href^="/sessions/"]').first()).toBeVisible();
  });

  test('specs tree row → spec detail', async ({ page }) => {
    await page.goto('/specs');
    const row = page.locator('a[href="/specs/REQ-ORDERS-001"]').first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/specs\/REQ-ORDERS-001$/);
    await expect(page.locator('.spec-body')).toBeVisible();
  });
});
