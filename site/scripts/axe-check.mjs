/**
 * Automated accessibility check (REQ-LANDING-005.A2).
 *
 * Loads each page in a CDP-attached Chrome, injects axe-core, runs the WCAG 2
 * A/AA rule set, and FAILS (exit 1) on any critical/serious violation. Lower-
 * impact findings are reported but don't fail the run.
 *
 * Usage:
 *   node scripts/axe-check.mjs [url ...]
 * Defaults to the landing + a representative docs page on the local preview.
 * Requires a Chrome with remote debugging:
 *   chrome --headless=new --remote-debugging-port=9222   (or `designer setup`)
 * Override the endpoint with CDP_URL / the base with BASE_URL.
 */
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const BASE = process.env.BASE_URL || 'http://localhost:4321';
const urls = process.argv.slice(2);
if (urls.length === 0) urls.push(`${BASE}/`, `${BASE}/getting-started/quickstart/`);

const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const axeSrc = await (await fetch(AXE)).text();

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map(); const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) waiters.filter(w => w.method === m.method).forEach(w => w.res(m.params));
  });
  const ready = new Promise(r => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const once = (method) => new Promise(res => waiters.push({ method, res }));
  return { ready, send, once, close: () => ws.close() };
}

let failed = false;
for (const url of urls) {
  const target = await (await fetch(`${CDP}/json/new?${url}`, { method: 'PUT' })).json();
  const c = cdp(target.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  const loaded = c.once('Page.loadEventFired');
  await c.send('Page.navigate', { url });
  await Promise.race([loaded, new Promise(r => setTimeout(r, 8000))]);
  await new Promise(r => setTimeout(r, 1500)); // fonts + reveal
  await c.send('Runtime.evaluate', { expression: axeSrc });
  console.log(`\n${url}`);
  for (const theme of ['dark', 'light']) {
    await c.send('Runtime.evaluate', { expression: `document.documentElement.dataset.theme='${theme}'` });
    await new Promise(r => setTimeout(r, 250));
    const expr = `axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(r=>JSON.stringify(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,n:v.nodes.length,t:v.nodes.slice(0,3).map(x=>x.target.join(' '))}))))`;
    const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const violations = JSON.parse(r.result.value || '[]');
    const blocking = violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (violations.length === 0) { console.log(`  [${theme}] ✓ no WCAG 2 A/AA violations`); continue; }
    console.log(`  [${theme}]`);
    for (const v of violations) {
      const mark = (v.impact === 'critical' || v.impact === 'serious') ? '✗' : '·';
      console.log(`    ${mark} [${v.impact}] ${v.id} — ${v.help} (${v.n} node${v.n > 1 ? 's' : ''})`);
      for (const t of v.t) console.log(`          ${t}`);
    }
    if (blocking.length) failed = true;
  }
  c.close();
}
console.log(failed ? '\nFAIL — critical/serious violations present.' : '\nPASS — no critical/serious violations.');
process.exit(failed ? 1 : 0);
