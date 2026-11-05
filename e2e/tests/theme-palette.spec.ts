import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';

/**
 * REQ-DESKTOP-032 core flows: the dashboard is dark-only (the theme toggle was
 * removed), and the ⌘/Ctrl-K command palette opens and navigates.
 */

test('the dashboard is dark-only (no theme toggle)', async ({ page }) => {
  const guard = captureConsoleErrors(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveCount(0);
  expect(guard.errors(), `theme console errors:\n${guard.errors().join('\n')}`).toEqual([]);
});

test('command palette opens with ⌘/Ctrl-K and navigates', async ({ page }) => {
  const guard = captureConsoleErrors(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();

  // Open the palette via the keyboard shortcut (meta OR ctrl + K).
  await page.keyboard.press('ControlOrMeta+KeyK');
  const input = page.getByPlaceholder(/Search pages, nodes, specs/i);
  await expect(input).toBeVisible();

  // Filter to a page and jump to it with Enter.
  await input.fill('Traceability');
  await page.keyboard.press('Enter');

  // It navigated: the URL and the rendered screen both switched to Traceability.
  await expect(page).toHaveURL(/\/traceability$/);
  const region = page.locator('[data-screen="traceability"]');
  await expect(region).toBeVisible();
  await expect(region.getByText('Traceability', { exact: false }).first()).toBeVisible();
  // Palette closed after navigating.
  await expect(input).toBeHidden();

  expect(guard.errors(), `palette console errors:\n${guard.errors().join('\n')}`).toEqual([]);
});
