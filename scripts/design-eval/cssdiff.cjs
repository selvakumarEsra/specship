const { chromium } = require(require('path').join(__dirname, '../../e2e/node_modules/playwright'));
const [ref, cand, w, h] = process.argv.slice(2);
const PROPS = process.env.ALL ? null : ['display','width','height','padding','margin','background-color','background-image','color','font-family','font-size','font-weight','line-height','letter-spacing','border','border-radius','box-shadow','gap','opacity'];
(async () => {
  const b = await chromium.launch();
  const grab = async (f) => { const p = await b.newPage({ viewport: { width: +w, height: +h } }); await p.goto('file://' + f, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
    return p.evaluate((PROPS) => [document.documentElement, ...document.body.querySelectorAll('*')].filter(e => !e.closest('svg') || e.tagName === 'svg').map(e => { const cs = getComputedStyle(e); const o = { tag: e.tagName.toLowerCase(), ph: e.getAttribute('placeholder') }; for (const k of (PROPS || [...cs])) o[k] = cs.getPropertyValue(k); return o; }), PROPS); };
  const A = await grab(ref), B = await grab(cand);
  console.log('elements', A.length, B.length);
  let shown = 0;
  for (let i = 0; i < Math.min(A.length, B.length) && shown < 25; i++) {
    if (A[i].tag !== B[i].tag) { console.log(i, 'TAG', A[i].tag, B[i].tag); shown++; break; }
    for (const k of Object.keys(A[i])) if (A[i][k] !== B[i][k]) { console.log(i, A[i].tag, k, '|', A[i][k], '=>', B[i][k]); shown++; }
  }
  await b.close();
})();
