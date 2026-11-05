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

  test('the Overview shows one next step instead of empty charts', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto(`${URL_EMPTY}/dashboard`);

    await expect(page.locator('#root')).not.toBeEmpty();
    const region = page.locator('[data-screen="dashboard"]');
    await expect(region).toBeVisible();

    // The no-specs next step (REQ-DASHSIMPLE-002.A4) — one agent-neutral
    // instruction, not a grid of zero tiles.
    await expect(region.getByText('Write your first spec as a Markdown file under specs/, then run specship sync.')).toBeVisible();
    await expect(region.locator('[data-overview-count]')).toHaveCount(0);

    await page.waitForTimeout(400);
    expect(guard.errors(), `dashboard console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  });

  test('the Review page says there are no requirements yet', async ({ page }) => {
    const guard = captureConsoleErrors(page);
    await page.goto(`${URL_EMPTY}/review`);

    const region = page.locator('[data-screen="review"]');
    await expect(region).toBeVisible();
    await expect(region.getByText(/No requirements yet/i).first()).toBeVisible();

    await page.waitForTimeout(400);
    expect(guard.errors(), `review console errors:\n${guard.errors().join('\n')}`).toEqual([]);
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
