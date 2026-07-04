/**
 * Islands — the ONLY client-side JavaScript in the SSR dashboard
 * (REQ-DASHLEAN-004.A2). No framework, no hydration: pages arrive fully
 * rendered; this layer only progressively enhances.
 *
 * Includes the INSTANT-NAVIGATION island: same-origin nav clicks are
 * intercepted, the next page is fetched (pre-warmed on hover) and its shell
 * swapped in place — SPA-feel transitions (no white flash, no CSS/font
 * re-parse) while every page stays a real server-rendered document.
 */

// Legacy-PWA eviction: the retired Angular dashboard registered a service
// worker (specship-shell-*) that keeps serving cached responses for this
// origin — including fake-OK /api replies from a dead server, which broke
// the online/offline status. Unregister it and drop its caches on load.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}
if (window.caches?.keys) {
  caches.keys().then((ks) => ks.filter((k) => k.startsWith('specship-')).forEach((k) => caches.delete(k))).catch(() => {});
}

// ---------------------------------------------------------------- initializers

/** Reflect the current path onto the sidebar (idempotent — rerun after swap). */
function initNav() {
  const path = location.pathname;
  for (const a of document.querySelectorAll('a.nav-link')) {
    a.classList.toggle('active', a.getAttribute('href') === path);
  }
}

/** Connection chip (OFFLINE-DOC): live online/offline probe in the strip. */
let connTimer = null;
function initConnection() {
  const strip = document.querySelector('div[style*="var(--status-h)"]');
  if (!strip || strip.querySelector('[data-conn]')) return;
  const chip = document.createElement('span');
  chip.dataset.conn = '1';
  chip.className = 'mono';
  chip.style.cssText = 'font-size:10.5px;padding:1px 8px;border-radius:999px;margin-left:10px;flex-shrink:0;';
  strip.appendChild(chip);
  const paint = (ok) => {
    chip.textContent = ok ? '● online' : '● offline';
    chip.style.color = ok ? 'var(--success)' : 'var(--error)';
    chip.style.background = ok ? 'var(--success-soft)' : 'var(--error-soft)';
    chip.title = ok ? 'Server reachable' : 'Server unreachable — data shown is from the last render';
  };
  const ping = async () => {
    if (!navigator.onLine) return paint(false);
    try {
      const res = await fetch('/api/status', { method: 'HEAD', cache: 'no-store' })
        .catch(() => fetch('/api/status', { cache: 'no-store' }));
      paint(res && res.ok);
    } catch { paint(false); }
  };
  window.addEventListener('online', ping);
  window.addEventListener('offline', () => paint(false));
  ping();
  if (connTimer) clearInterval(connTimer);
  connTimer = setInterval(ping, 10_000);
}

/** Re-run page-scoped module islands (e.g. the graph canvas) after a swap. */
function initPageModules(scope) {
  for (const s of (scope ?? document).querySelectorAll('script[type="module"][src^="/islands/"]')) {
    // ES modules execute once per URL; bust so re-entry re-runs on revisit.
    import(s.getAttribute('src') + '?t=' + Date.now()).catch(() => {});
  }
}

function initAll() { initNav(); initConnection(); }

// ---------------------------------------------------------------- instant nav

const prefetchCache = new Map(); // href -> { p: Promise<string>, at: number }
const PREFETCH_TTL = 5_000;

function prefetch(href) {
  const hit = prefetchCache.get(href);
  if (hit && Date.now() - hit.at < PREFETCH_TTL) return hit.p;
  const p = fetch(href).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  prefetchCache.set(href, { p, at: Date.now() });
  return p;
}

async function navigate(href, push = true) {
  const app = document.getElementById('app');
  if (app) app.style.opacity = '0.55';
  try {
    const html = await prefetch(href);
    prefetchCache.delete(href);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const next = doc.getElementById('app');
    if (!next || !app) { location.href = href; return; }
    document.title = doc.title;
    app.replaceWith(next);
    if (push) history.pushState({}, '', href);
    window.scrollTo(0, 0);
    initAll();
    initPageModules(next);
  } catch {
    location.href = href; // fall back to a full load on any failure
  }
}

function isLocalNav(a, e) {
  if (!a || a.target || a.hasAttribute('download')) return false;
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return false;
  const href = a.getAttribute('href') || '';
  return href.startsWith('/') && !href.startsWith('/api/');
}

document.addEventListener('mouseover', (e) => {
  const a = e.target.closest?.('a[href^="/"]');
  if (isLocalNav(a)) prefetch(a.getAttribute('href'));
});
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="/"]');
  if (!isLocalNav(a, e)) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => navigate(location.pathname + location.search, false));

initAll();
