const { chromium } = require(require('path').join(__dirname, '../../e2e/node_modules/playwright'));
const fs = require('fs');
const [a, c] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const r = await p.evaluate(async ({ a, c }) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ic] = await Promise.all([load(a), load(c)]); const w = ia.width, h = ia.height;
    const px = (img) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const A = px(ia), C = px(ic); let n = 0, max = 0; const rows = new Set(); let minx = w, maxx = 0, miny = h, maxy = 0;
    const samples = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const d = Math.max(Math.abs(A[i]-C[i]), Math.abs(A[i+1]-C[i+1]), Math.abs(A[i+2]-C[i+2])); if (d) { n++; max = Math.max(max, d); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); if (samples.length < 5 && x % 97 === 0) samples.push([x, y, [A[i],A[i+1],A[i+2]], [C[i],C[i+1],C[i+2]]]); } }
    return { n, max, box: [minx, miny, maxx, maxy], samples };
  }, { a: fs.readFileSync(a).toString('base64'), c: fs.readFileSync(c).toString('base64') });
  console.log(JSON.stringify(r)); await b.close();
})();
