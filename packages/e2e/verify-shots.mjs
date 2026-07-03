import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:4880';
const ROUTES = ['dashboard', 'specship-impact', 'specs', 'graph', 'improvements', 'mcp', 'tips'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
for (const r of ROUTES) {
  await page.goto(`${BASE}/${r}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `/tmp/wt-${r}.png` });
  console.log(`${r}: url=${page.url().replace(BASE, '')}`);
}
console.log('JS ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
