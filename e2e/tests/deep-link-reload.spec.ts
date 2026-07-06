import { test, expect } from '@playwright/test';
import { captureConsoleErrors } from '../lib/console';
import { FIXTURE_SPEC_ID } from '../lib/screens.mjs';

/**
 * REQ-DESKTOP-018.A2 — a deep, multi-segment route survives a FRESH full-page
 * load (not just in-app navigation). Regression guard for the `base: './'`
 * bug: relative asset URLs resolved against `/specs/` on a fresh
 * `/specs/:id` load and 404'd, so the app never booted. With `base: '/'` the
 * assets resolve from the origin root at any route depth.
 */
test('a deep spec route boots the app on a fresh full-page load (REQ-DESKTOP-018.A2)', async ({ page }) => {
  const console = captureConsoleErrors(page);

  // Fresh navigation straight to a 2-segment deep route — the case in-app
  // clicks never exercise.
  const bad: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/assets/') && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`/specs/${FIXTURE_SPEC_ID}`, { waitUntil: 'networkidle' });

  // The SPA mounted (assets loaded from root, not from /specs/…).
  await expect(page.locator('#root')).not.toBeEmpty();
  // No hashed asset 404'd — proves the base fix.
  expect(bad, `deep-route asset loads should all succeed:\n${bad.join('\n')}`).toEqual([]);
  // And the app booted clean.
  expect(console.errors(), `deep-route load should be console-clean:\n${console.errors().join('\n')}`).toEqual([]);
});
