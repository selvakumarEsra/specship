/**
 * History-API routing (`/dashboard`, `/specs/REQ-…`) instead of the design
 * bundle's hash routing — the dashboard server's SPA fallback serves
 * index.html for any non-API, non-asset GET, so deep links load directly
 * (REQ-DESKTOP-018.A2).
 */
import { useEffect, useState } from 'react';

export interface Route {
  route: string;
  param?: string;
  query: Record<string, string>;
}

const NAV_EVENT = 'ss-navigate';

/**
 * Retired routes and where their deep links land (REQ-DASHSIMPLE-001.A2).
 * `keepParam` carries the sub-path across — `/specs/<id>` → `/review/<id>`;
 * the removed analytics screens drop theirs, since Overview takes none.
 */
const REDIRECTS: Record<string, { to: string; keepParam: boolean }> = {
  sessions: { to: 'dashboard', keepParam: false },
  heatmap: { to: 'dashboard', keepParam: false },
  costs: { to: 'dashboard', keepParam: false },
  compare: { to: 'dashboard', keepParam: false },
  memory: { to: 'dashboard', keepParam: false },
  mcp: { to: 'dashboard', keepParam: false },
  tips: { to: 'dashboard', keepParam: false },
  specs: { to: 'review', keepParam: true },
  drift: { to: 'review', keepParam: true },
};

/** Map a (possibly retired) route + param onto the live screen it now lives on. */
export function resolveRedirect(route: string, param?: string): { route: string; param?: string } {
  const r = REDIRECTS[route];
  if (!r) return { route, param };
  return { route: r.to, param: r.keepParam ? param : undefined };
}

function buildPath(route: string, param?: string, search = ''): string {
  return '/' + route + (param ? '/' + param : '') + search;
}

// @implements REQ-DASHSIMPLE-001
export function parse(): Route {
  const seg = location.pathname.split('/').filter(Boolean);
  const raw = seg[0] || 'dashboard';
  const rawParam = seg.slice(1).join('/') || undefined;
  const { route, param } = resolveRedirect(raw, rawParam);
  if (route !== raw) {
    // Rewrite the address bar so the retired URL never sticks around.
    history.replaceState(history.state, '', buildPath(route, param, location.search));
  }
  return {
    route,
    param,
    query: Object.fromEntries(new URLSearchParams(location.search)),
  };
}

export function go(target: string, opts: { param?: string; query?: Record<string, string> } = {}): void {
  const { route, param } = resolveRedirect(target, opts.param);
  let path = '/' + route;
  if (param) path += '/' + param;
  if (opts.query && Object.keys(opts.query).length) {
    path += '?' + new URLSearchParams(opts.query).toString();
  }
  if (path !== location.pathname + location.search) {
    history.pushState(null, '', path);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function usePathRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener('popstate', f);
    window.addEventListener(NAV_EVENT, f);
    return () => {
      window.removeEventListener('popstate', f);
      window.removeEventListener(NAV_EVENT, f);
    };
  }, []);
  return r;
}
