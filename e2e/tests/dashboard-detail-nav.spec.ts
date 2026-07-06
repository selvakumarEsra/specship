import { test, expect } from '@playwright/test';
import { FIXTURE_SPEC_ID } from '../lib/screens.mjs';
import { captureConsoleErrors } from '../lib/console';

/**
 * List → detail drill-down on the built SPA (REQ-DESKTOP-032 core flows):
 * selecting a spec in the tree renders its detail, and clicking a session row
 * opens its detail. These are in-app selections (state, not full navigations),
 * so we assert the detail content appears rather than a server-rendered page.
 */
test.describe('List rows open detail views', () => {
  test('select a spec in the tree → its detail renders', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto('/specs');
    await expect(page.locator('[data-screen="specs"]')).toBeVisible();

    // The fixture spec's tree row (group defaults open).
    const row = page.getByRole('treeitem').filter({ hasText: FIXTURE_SPEC_ID });
    await expect(row).toBeVisible();
    await row.click();

    // The read view rendered: breadcrumb id + the workflow-gated Edit control.
    await expect(page.locator('.sp-breadcrumb').getByText(FIXTURE_SPEC_ID)).toBeVisible();
    await expect(page.getByRole('button', { name: /edit spec/i })).toBeVisible();

    await page.waitForTimeout(200);
    expect(guard.errors(), `specs nav console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('click a session row → its session detail renders', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto('/sessions');
    const region = page.locator('[data-screen="sessions"]');
    await expect(region).toBeVisible();

    // Session rows carry an explicit role="button"; the toolbar uses <button>.
    const row = region.locator('[role="button"]').first();
    await expect(row).toBeVisible();
    await row.click();

    // The session drill-in: its Prompts stat + the back-to-Sessions control.
    await expect(page.getByText('Prompts').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();

    await page.waitForTimeout(200);
    expect(guard.errors(), `sessions nav console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });
});
