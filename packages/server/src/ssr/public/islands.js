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

/**
 * Islands — the ONLY client-side JavaScript in the SSR dashboard
 * (REQ-DASHLEAN-004.A2). No framework, no router, no hydration: the page is
 * already fully rendered by the server. This layer only progressively enhances.
 *
 * Today it marks the active nav link and gives instant visual feedback on
 * navigation; page-specific islands (graph pan/zoom, heatmap hover) are
 * registered here as those pages are ported.
 */
(() => {
  // Reflect the current path onto the sidebar even after client navigations.
  const markActive = () => {
    const path = location.pathname;
    for (const a of document.querySelectorAll('a.nav-link')) {
      a.classList.toggle('active', a.getAttribute('href') === path);
    }
  };
  markActive();

  // Instant feedback: dim the page while the next server-rendered doc loads.
  for (const a of document.querySelectorAll('a[data-nav]')) {
    a.addEventListener('click', () => {
      const page = document.getElementById('page');
      if (page) page.style.opacity = '0.6';
    });
  }
})();

// Connection island (OFFLINE-DOC): live online/offline status in the strip.
// SSR pages are rendered server-side, so reachability must be probed client-
// side: ping /api/status every 10s (+ browser online/offline events) and
// show a live chip next to "indexed … ago".
(() => {
  const strip = document.querySelector('div[style*="var(--status-h)"]');
  if (!strip) return;
  const chip = document.createElement('span');
  chip.className = 'mono';
  chip.style.cssText = 'font-size:10.5px;padding:1px 8px;border-radius:999px;margin-left:10px;flex-shrink:0;';
  strip.appendChild(chip);
  let timer = null;
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
  timer = setInterval(ping, 10_000);
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
