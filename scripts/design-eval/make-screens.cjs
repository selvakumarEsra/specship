const { chromium } = require(require('path').join(__dirname, '../../e2e/node_modules/playwright'));
const fs = require('fs');
const S = process.argv[2];
const FONT = '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600;650;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />';
const page = (title, w, h, body) => `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<title>${title}</title>\n${FONT}\n<link rel="stylesheet" href="styles.css" />\n</head>\n<body style="margin:0">\n<div id="frame" style="width:${w}px;height:${h}px;overflow:hidden;display:flex;flex-direction:column">\n${body}\n</div>\n</body>\n</html>\n`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { sessionStorage.setItem('specship-booted','1'); } catch {} });
  await p.goto('http://localhost:8765/snapshot.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: S + '/live-sidebar.png', clip: { x: 0, y: 0, width: 232, height: 900 } });
  await p.screenshot({ path: S + '/live-header.png', clip: { x: 232, y: 0, width: 1208, height: 261 } });
  const html = await p.evaluate(() => {
    const app = document.getElementById('root').firstElementChild;
    const nav = app.children[0].outerHTML;
    const main = app.children[1].cloneNode(true);
    const scroll = main.children[2].querySelector('.scroll-y');
    [...scroll.children].slice(2).forEach((c) => c.remove());
    return { nav, main: main.outerHTML };
  });
  for (const [name, w, h, body] of [['sidebar', 232, 900, html.nav], ['header', 1208, 261, html.main]]) {
    const dir = `${S}/design-${name}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(require('path').join(__dirname, '../../specs/specship-desktop/styles.css'), dir + '/styles.css');
    fs.writeFileSync(dir + '/snapshot.html', page(`SpecShip ${name}`, w, h, body));
  }
  await b.close();
})();
