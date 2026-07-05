import { test, expect } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4319);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * REQ-DASHLEAN-003 — the dashboard presents specs READ-ONLY.
 *
 * The server-rendered specs list and spec-detail page must expose no code
 * editor, no "Edit spec" control, and issue no spec-mutation (POST/PUT) request.
 * The hermetic fixture seeds `specs/orders.md`, so the tree has a real spec.
 */
test.describe('Specs are read-only (REQ-DASHLEAN-003)', () => {
  test('specs render server-side, read-only, with no editor and no spec-write', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      const m = r.method();
      if (/\/api\/spec/i.test(r.url()) && (m === 'PUT' || m === 'POST')) writes.push(`${m} ${r.url()}`);
    });

    // The specs screen is server-rendered (design markup) with no editor.
    const listHtml = await (await page.request.get(`${ORIGIN}/specs`)).text();
    expect(listHtml, 'specs screen rendered server-side').toMatch(/var\(--sidebar-w\)/);
    expect(listHtml, 'no editor in the list').not.toMatch(/monaco|app-spec-editor|<textarea/i);

    // The read-only spec-detail route renders the fixture spec's body.
    await page.goto('/specs/REQ-ORDERS-001');
    await expect(page.locator('.spec-body')).toBeVisible({ timeout: 30_000 });
    // ...with no editor, no "Edit spec" control, and nothing editable.
    await expect(page.getByRole('button', { name: /edit spec/i })).toHaveCount(0);
    await expect(page.locator('textarea, .monaco-editor, app-spec-editor')).toHaveCount(0);

    // REQ-DASHLEAN-003.A2 — no spec-mutation request left the dashboard.
    expect(writes, `unexpected spec-write requests:\n${writes.join('\n')}`).toEqual([]);
  });
});
