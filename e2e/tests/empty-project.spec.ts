import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';
import { URL_EMPTY } from '../lib/ports';

/**
 * REQ-TVIZ-004.A1 — an initialized-but-unindexed project with no ingested
 * transcripts must render EXPLICIT empty states, never a blank panel, a crash,
 * or zeros presented as truth.
 *
 * The empty server (playwright.config.ts, `E2E_MODE=empty`) serves a project
 * that has had `specship init` and nothing else: no sources, no specs, no index
 * pass, no `~/.claude` transcripts. That's a real first-run state, and it's the
 * one most likely to regress into a white screen, so the strict
 * zero-console-error bar applies here unchanged.
 */
test.describe('An empty/unindexed project renders empty states (REQ-TVIZ-004.A1)', () => {
  test('the empty server is really empty', async ({ page }) => {
    const status = await page.request.get(`${URL_EMPTY}/api/status`);
    expect(status.ok()).toBeTruthy();
    expect((await status.json()).nodeCount, 'the empty fixture must have no nodes').toBe(0);
  });

  test('the dashboard points at the ingest path instead of rendering zeros', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto(`${URL_EMPTY}/dashboard`);

    await expect(page.locator('#root')).not.toBeEmpty();
    const region = page.locator('[data-screen="dashboard"]');
    await expect(region).toBeVisible();

    // The zero-ingest guidance (REQ-DESKTOP-020.A4) — an explicit statement that
    // there is no data, not a grid of $0.00s.
    await expect(region.getByText(/No Claude Code data ingested yet/i).first()).toBeVisible();
    await expect(region.getByText(/no transcript data/i).first()).toBeVisible();

    await page.waitForTimeout(400);
    expect(guard.errors(), `dashboard console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('the Specs page says there are no specs yet', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto(`${URL_EMPTY}/specs`);

    const region = page.locator('[data-screen="specs"]');
    await expect(region).toBeVisible();
    await expect(region.getByText(/No specs yet/i).first()).toBeVisible();

    await page.waitForTimeout(400);
    expect(guard.errors(), `specs console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('the Graph page says nothing is indexed yet', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto(`${URL_EMPTY}/graph`);

    const region = page.locator('[data-screen="graph"]');
    await expect(region).toBeVisible();
    await expect(region.getByText(/Nothing indexed yet/i).first()).toBeVisible();

    await page.waitForTimeout(400);
    expect(guard.errors(), `graph console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });
});
