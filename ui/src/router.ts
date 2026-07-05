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

function parse(): Route {
  const seg = location.pathname.split('/').filter(Boolean);
  return {
    route: seg[0] || 'dashboard',
    param: seg.slice(1).join('/') || undefined,
    query: Object.fromEntries(new URLSearchParams(location.search)),
  };
}

export function go(route: string, opts: { param?: string; query?: Record<string, string> } = {}): void {
  let path = '/' + route;
  if (opts.param) path += '/' + opts.param;
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
