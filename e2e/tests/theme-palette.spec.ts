import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';

/**
 * REQ-DESKTOP-032 core flows: theme toggle persists across a reload, and the
 * ⌘/Ctrl-K command palette opens and navigates. Both drive the built SPA's real
 * behaviour (theme.ts localStorage persistence + the App command palette).
 */

test('theme toggle persists across reload', async ({ page }) => {
  const guard = captureConsoleErrors(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();

  // Fresh context boots dark (theme.ts default + index.html data-theme).
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // The tri-state toggle cycles dark → light; the DOM reflects it immediately.
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');

  // Persisted: a reload restores the chosen theme from localStorage.
  await page.reload();
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('specship-theme'))).toBe('light');

  expect(guard.errors(), `theme console errors:\n${guard.errors().join('\n')}`).toEqual([]);
});

test('command palette opens with ⌘/Ctrl-K and navigates', async ({ page }) => {
  const guard = captureConsoleErrors(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();

  // Open the palette via the keyboard shortcut (meta OR ctrl + K).
  await page.keyboard.press('ControlOrMeta+KeyK');
  const input = page.getByPlaceholder(/Search pages, nodes, specs, prompts/i);
  await expect(input).toBeVisible();

  // Filter to a page and jump to it with Enter.
  await input.fill('Heatmap');
  await page.keyboard.press('Enter');

  // It navigated: the URL and the rendered screen both switched to Heatmap.
  await expect(page).toHaveURL(/\/heatmap$/);
  const region = page.locator('[data-screen="heatmap"]');
  await expect(region).toBeVisible();
  await expect(region.getByText('Heatmap', { exact: false }).first()).toBeVisible();
  // Palette closed after navigating.
  await expect(input).toBeHidden();

  expect(guard.errors(), `palette console errors:\n${guard.errors().join('\n')}`).toEqual([]);
});
