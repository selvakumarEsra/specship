import { test, expect } from '@playwright/test';
import { FIXTURE_SPEC_ID } from '../lib/screens.mjs';
import { captureConsoleErrors } from '../lib/console';

/**
 * List → detail drill-down on the built SPA (REQ-DESKTOP-032 core flows):
 * selecting a requirement in the Review queue (REQ-DASHSIMPLE-004, which
 * replaced the Specs tree) renders its detail. An in-app selection (state,
 * not a full navigation), so we assert the detail content appears.
 */
test.describe('List rows open detail views', () => {
  test('select a requirement in Review → its detail renders', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto('/review');
    await expect(page.locator('[data-screen="review"]')).toBeVisible();

    const row = page.getByRole('option').filter({ hasText: FIXTURE_SPEC_ID }).first();
    await expect(row).toBeVisible();
    await row.click();

    // The read view rendered: breadcrumb id + the workflow-gated Edit control.
    await expect(page.locator('.sp-breadcrumb').getByText(FIXTURE_SPEC_ID).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /edit spec/i })).toBeVisible();

    await page.waitForTimeout(200);
    expect(guard.errors(), `review nav console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });
});
