// usage: [STATE=hover|<locator>] node compare.cjs <ref.png> <candidate.html> <w> <h> <out-prefix>
const { chromium } = require(require('path').join(__dirname, '../../e2e/node_modules/playwright'));
const fs = require('fs');
const [ref, cand, w, h, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.goto('file://' + cand, { waitUntil: 'networkidle' });
  // Wait for web fonts: a screenshot taken mid-load renders fallback glyphs.
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  // STATE="hover|focus|active|disabled" + "|<playwright locator>": put one element in
  // that state (e.g. hover|text=Sign In), then wait out its transition.
  if (process.env.STATE) {
    const [action, locator] = process.env.STATE.split('|');
    const el = p.locator(locator).first();
    if (action === 'hover') await el.hover();
    else if (action === 'active') { await el.hover(); await p.mouse.down(); }
    else if (action === 'disabled') await el.evaluate((n) => n.setAttribute('disabled', ''));
    else await el.focus();
    await p.waitForTimeout(700);
  }
  // animations: 'disabled' jumps CSS animations to their end state, so an
  // entrance animation's timing can't change compositing between runs.
  await p.screenshot({ path: out + '.png', clip: { x: 0, y: 0, width: +w, height: +h }, animations: 'disabled' });
  const cmp = await b.newPage();
  const a = fs.readFileSync(ref).toString('base64');
  const c = fs.readFileSync(out + '.png').toString('base64');
  const res = await cmp.evaluate(async ({ a, c, w, h }) => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + src; });
    const [ia, ic] = await Promise.all([load(a), load(c)]);
    const px = (img) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), dc = px(ic);
    const diff = document.createElement('canvas'); diff.width = w; diff.height = h; const dx = diff.getContext('2d'); const dd = dx.createImageData(w, h);
    let exact = 0, close = 0; const n = w * h;
    for (let i = 0; i < n * 4; i += 4) {
      const m = Math.max(Math.abs(da[i] - dc[i]), Math.abs(da[i + 1] - dc[i + 1]), Math.abs(da[i + 2] - dc[i + 2]));
      if (m === 0) exact++;
      if (m <= 16) close++;
      const g = (da[i] + da[i + 1] + da[i + 2]) / 9;
      dd.data[i] = m > 16 ? 255 : g; dd.data[i + 1] = m > 16 ? 0 : g; dd.data[i + 2] = m > 16 ? 0 : g; dd.data[i + 3] = 255;
    }
    dx.putImageData(dd, 0, 0);
    return { exactPct: +(100 * exact / n).toFixed(2), within16Pct: +(100 * close / n).toFixed(2), diff: diff.toDataURL('image/png').split(',')[1] };
  }, { a, c, w: +w, h: +h });
  fs.writeFileSync(out + '-diff.png', Buffer.from(res.diff, 'base64'));
  console.log(JSON.stringify({ candidate: cand.split('/').slice(-2).join('/'), exactPct: res.exactPct, within16Pct: res.within16Pct }));
  await b.close();
})();
