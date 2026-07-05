import { test, expect } from '@playwright/test';
import { SCREENS } from '../lib/screens.mjs';
import { captureConsoleErrors } from '../lib/console';

/**
 * REQ-DESKTOP-032.A1 — the built SPA, served by the real dashboard server over
 * a real indexed fixture, renders EVERY routed screen with its key content and
 * ZERO console errors.
 *
 * One fresh page per screen (Playwright isolates context/localStorage): attach
 * the console guard, navigate, prove the React app mounted and the screen's own
 * content region rendered its key token (scoped to `[data-screen]` so a
 * same-named sidebar label can't stand in), then assert no console.error and no
 * uncaught pageerror fired on that screen.
 */
test.describe('Every routed screen renders clean (REQ-DESKTOP-032.A1)', () => {
  for (const screen of SCREENS) {
    test(`renders ${screen.id}`, async ({ page }) => {
      const guard = captureConsoleErrors(page);

      await page.goto(screen.path);

      // The React SPA mounted — index.html ships an empty #root the app fills.
      await expect(page.locator('#root')).not.toBeEmpty();

      // The routed screen — and its key content — actually rendered.
      const region = page.locator(`[data-screen="${screen.id}"]`);
      await expect(region).toBeVisible();
      await expect(
        region.getByText(screen.content, { exact: false }).first(),
        `${screen.id}: expected key content "${screen.content}"`,
      ).toBeVisible();

      // Let any post-render data fetch settle so a late failure still counts.
      await page.waitForTimeout(400);

      expect(
        guard.errors(),
        `${screen.id} console errors:\n${guard.errors().join('\n')}`,
      ).toEqual([]);
    });
  }
});
