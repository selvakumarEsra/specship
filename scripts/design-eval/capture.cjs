// usage: node capture.cjs <url> <w> <h> <out-dir>  — rendered DOM + every stylesheet rule, scripts removed
const { chromium } = require(require('path').join(__dirname, '../../e2e/node_modules/playwright'));
const fs = require('fs');
const [url, w, h, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  // ACTION=loading|error: drive the login form into that state before capturing.
  if (process.env.ACTION) {
    await p.fill('input[type=email]', 'nobody@example.com');
    await p.fill('input[type=password]', 'wrong');
    await p.click('button[type=submit]');
    await p.waitForTimeout(process.env.ACTION === 'loading' ? 250 : 1600);
  }
  const snap = await p.evaluate(() => {
    const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const links = [...document.querySelectorAll('link[rel=stylesheet][href^="http"], link[rel=preconnect]')].map((l) => l.outerHTML).join('\n');
    const body = document.body.cloneNode(true);
    body.querySelectorAll('script').forEach((s) => s.remove());
    // Typed values live in the .value property, not the attribute: persist them.
    const live = document.body.querySelectorAll('input');
    body.querySelectorAll('input').forEach((el, i) => { const v = live[i].value; if (v) el.setAttribute('value', v); });
    return { css, links, body: body.outerHTML, htmlClass: document.documentElement.className };
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(out + '/styles.css', snap.css);
  fs.writeFileSync(out + '/snapshot.html', `<!DOCTYPE html>\n<html lang="en" class="${snap.htmlClass}">\n<head>\n<meta charset="UTF-8" />\n<title>capture</title>\n${snap.links}\n<link rel="stylesheet" href="styles.css" />\n</head>\n${snap.body}\n</html>\n`);
  await b.close();
})();
