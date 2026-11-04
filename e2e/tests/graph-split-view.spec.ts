import { test, expect, type Page } from '@playwright/test';

/**
 * REQ-DASHSIMPLE-005 — the Graph split spec/code view against the real,
 * indexed fixture (e2e/lib/fixture.mjs): REQ-ORDERS-001 → createOrder, which
 * calls normalizeTotal (no linked requirement). Extra coverage only — the
 * criterion evidence lives in ui/src/__tests__/graph-split.test.tsx, which
 * `specship verify --report` ingests.
 */

const left = (page: Page) => page.getByTestId('split-left');
const right = (page: Page) => page.getByTestId('split-right');

async function pick(page: Page, text: string, optionPrefix: string): Promise<void> {
  const box = page.getByRole('combobox', { name: 'Search specs and code' });
  await box.fill(text);
  await page.locator(`[data-testid^="split-option-${optionPrefix}"]`).filter({ hasText: text }).first().click();
}

test.describe('Graph split view (REQ-DASHSIMPLE-005)', () => {
  test('REQ-DASHSIMPLE-005.A1: a requirement shows its text and linked code', async function reqDashsimple005A1({ page }) {
    await page.goto('/graph');
    await pick(page, 'REQ-ORDERS-001', 'spec:');
    await expect(left(page)).toContainText('normalizes the total');
    await expect(right(page).getByTestId('split-source').first()).toContainText('export function createOrder');
  });

  test('REQ-DASHSIMPLE-005.A2: a symbol shows its code and linked requirements', async function reqDashsimple005A2({ page }) {
    await page.goto('/graph');
    await pick(page, 'createOrder', 'sym:');
    await expect(right(page).getByTestId('split-source').first()).toContainText('export function createOrder');
    await expect(left(page)).toContainText('REQ-ORDERS-001');
  });

  test('REQ-DASHSIMPLE-005.A3: stepping to a callee and back', async function reqDashsimple005A3({ page }) {
    await page.goto('/graph');
    await pick(page, 'createOrder', 'sym:');
    await expect(left(page)).toContainText('REQ-ORDERS-001');
    await right(page).getByTestId('split-callee-normalizeTotal').click();
    await expect(right(page).getByTestId('split-source').first()).toContainText('export function normalizeTotal');
    await expect(left(page)).toContainText('no linked requirement');
    await page.goBack();
    await expect(right(page).getByTestId('split-source').first()).toContainText('export function createOrder');
    await expect(left(page)).toContainText('REQ-ORDERS-001');
  });

  test('REQ-DASHSIMPLE-005.A4: reload restores the pair', async function reqDashsimple005A4({ page }) {
    await page.goto('/graph');
    await pick(page, 'createOrder', 'sym:');
    await expect(left(page)).toContainText('REQ-ORDERS-001');
    const url = page.url();
    await page.reload();
    expect(page.url()).toBe(url);
    await expect(right(page).getByTestId('split-source').first()).toContainText('export function createOrder');
    await expect(left(page)).toContainText('REQ-ORDERS-001');
  });

  test('REQ-DASHSIMPLE-005.A5: an unlinked symbol is not an error', async function reqDashsimple005A5({ page }) {
    await page.goto('/graph');
    await pick(page, 'normalizeTotal', 'sym:');
    await expect(right(page).getByTestId('split-source').first()).toContainText('export function normalizeTotal');
    await expect(left(page)).toContainText('no linked requirement');
    await expect(page.locator('[data-screen] [role="alert"]')).toHaveCount(0);
  });
});
