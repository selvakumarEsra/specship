import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { FIXTURE } from '../lib/paths.mjs';
import { FIXTURE_SPEC_ID } from '../lib/screens.mjs';
import { captureConsoleErrors } from '../lib/console';

/**
 * REQ-DESKTOP-032.A2 — the spec edit flow persists to disk and the re-queued
 * state renders. Drives the built SPA's real editor against the fixture spec:
 * open the detail, enter the editor (which renders the "re-queued as Drafted"
 * status — REQ-DESKTOP-008), change the normative statement, Save, and prove
 * the write reached disk by re-reading the `.md` (011.A1 semantics) and by
 * seeing the edited text render back in the reloaded read view.
 *
 * The fixture spec file is restored afterwards (a PUT of the original content
 * re-syncs the graph too) so the run is idempotent and later specs see the
 * original spec.
 */
test('spec edit → save persists to disk and re-queues (REQ-DESKTOP-032.A2)', async ({ page }) => {
  const specFile = path.join(FIXTURE, 'specs', 'orders.md');
  const original = fs.readFileSync(specFile, 'utf8');
  const MARK = 'E2E-EDIT-MARKER';
  const guard = captureConsoleErrors(page);

  try {
    // ---- select the fixture spec from the tree → its detail (read view) ----
    // Reached by selecting the row (the flow REQ-DESKTOP-032 describes), which
    // keeps the app on `/specs`; the SPA's relative asset base makes a fresh
    // load of a deeper `/specs/:id` URL a separate concern (REQ-DESKTOP-018).
    await page.goto('/specs');
    await expect(page.locator('[data-screen="specs"]')).toBeVisible();
    await page.getByRole('treeitem').filter({ hasText: FIXTURE_SPEC_ID }).click();
    const editBtn = page.getByRole('button', { name: /edit spec/i });
    await expect(editBtn).toBeVisible();
    await expect(editBtn, 'the fixture requirement must be editable in place').toBeEnabled();

    // ---- enter the editor: the re-queued (→ Drafted) status is shown ----
    await editBtn.click();
    await expect(page.getByLabel('Normative statement')).toBeVisible();
    // REQ-DESKTOP-008: the status is system-managed — saving re-queues as Drafted.
    await expect(page.locator('.sp-status-auto').getByText('Drafted').first()).toBeVisible();
    await expect(page.getByText(/re-queues this spec as Drafted/i)).toBeVisible();

    // ---- edit the normative statement ----
    const statement = page.getByLabel('Normative statement');
    await statement.fill(`Order totals MUST be normalized to non-negative cents. ${MARK}`);

    // ---- save: a PUT /api/spec/:id must fire and succeed ----
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT'
        && /\/api\/spec\/REQ-ORDERS-001(\?|$)/.test(r.url())
        && r.ok(),
    );
    // The editor renders Save in both the sticky bar and the footer; either works.
    await page.getByRole('button', { name: /save changes/i }).first().click();
    await saved;

    // ---- persistence: the edit is on disk (011.A1) ----
    const onDisk = fs.readFileSync(specFile, 'utf8');
    expect(onDisk, 'the edited statement must be persisted to the spec .md').toContain(MARK);

    // ---- after save: the read view reloads and renders the edited statement ----
    await expect(editBtn).toBeVisible(); // back in the read view
    await expect(page.locator('.sp-statement').getByText(MARK, { exact: false })).toBeVisible();

    // The whole edit → save round-trip stayed clean (no console/page errors).
    await page.waitForTimeout(300);
    expect(guard.errors(), `edit-save console errors:\n${guard.errors().join('\n')}`).toEqual([]);
  } finally {
    // Restore baseline: PUT the original content back (re-syncs the graph);
    // the fs write is belt-and-braces in case the page died mid-test.
    try {
      await page.request.put(`/api/spec/${FIXTURE_SPEC_ID}`, { data: { content: original } });
    } catch { /* page/context may be gone on a hard failure */ }
    fs.writeFileSync(specFile, original);
  }
});
