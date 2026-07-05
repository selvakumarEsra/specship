/**
 * In-house static file serving for the desktop SPA. Replaces the
 * `@fastify/static` plugin so we don't pull in `glob` (deprecated maintainer-side
 * across every 10.x and 11.x release, which polluted every user's install
 * with a deprecation warning).
 *
 * Usage from server.ts:
 *
 *   const serveStatic = makeStaticHandler(options.webDir);
 *   app.setNotFoundHandler((req, reply) => {
 *     if (req.method !== 'GET' || req.url.startsWith('/api/')) {
 *       reply.code(404).send({ error: 'not found' });
 *       return;
 *     }
 *     const hit = serveStatic(req.url);
 *     if (hit) { reply.type(hit.contentType).send(hit.body); return; }
 *     if (isAssetPath(req.url)) { reply.code(404).send({ error: 'not found' }); return; }
 *     reply.code(200).type('text/html').send(cachedIndex);
 *   });
 *
 * Path traversal is blocked by resolving the requested path inside webDir and
 * rejecting anything that resolves outside.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const CT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.txt':  'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export interface StaticHit {
  body: Buffer;
  contentType: string;
}

/**
 * Whether a URL path names a static asset (its final segment ends in a
 * recognized asset extension). Used by the SPA fallback to answer a MISSING
 * asset with 404 instead of index.html (REQ-OFFLINE-005): serving HTML at an
 * asset URL poisons the browser's and the offline service worker's caches —
 * a tab holding a stale build requests its old content-hashed bundle, gets
 * the shell, and stores HTML under the bundle URL until site data is cleared.
 *
 * Only extensions from the content-type table count — client routes with
 * dotted params (`/specs/REQ-OFFLINE-001.A1`) must keep the shell fallback.
 */
export function isAssetPath(urlPath: string): boolean {
  const qIdx = urlPath.indexOf('?');
  const hIdx = urlPath.indexOf('#');
  let clean = urlPath;
  if (qIdx >= 0) clean = clean.slice(0, qIdx);
  if (hIdx >= 0) clean = clean.slice(0, hIdx);
  let decoded: string;
  try { decoded = decodeURIComponent(clean); }
  catch { decoded = clean; }
  const ext = path.extname(decoded).toLowerCase();
  return ext !== '' && ext in CT;
}

export function makeStaticHandler(rootDir: string): (urlPath: string) => StaticHit | null {
  const absRoot = path.resolve(rootDir);

  return function serveStatic(urlPath: string): StaticHit | null {
    // Strip query/hash — Fastify gives us the raw URL.
    const qIdx = urlPath.indexOf('?');
    const hIdx = urlPath.indexOf('#');
    let clean = urlPath;
    if (qIdx >= 0) clean = clean.slice(0, qIdx);
    if (hIdx >= 0) clean = clean.slice(0, hIdx);

    // Decode percent-encoding (but reject anything that throws).
    let decoded: string;
    try { decoded = decodeURIComponent(clean); }
    catch { return null; }

    // Strip leading slash so path.resolve doesn't escape the root.
    const rel = decoded.replace(/^\/+/, '');

    // Resolve under root and verify containment to block ../../ traversal.
    const candidate = path.resolve(absRoot, rel);
    if (candidate !== absRoot && !candidate.startsWith(absRoot + path.sep)) {
      return null;
    }

    let stat;
    try { stat = statSync(candidate); }
    catch { return null; }

    if (!stat.isFile()) return null;

    const body = readFileSync(candidate);
    const ext = path.extname(candidate).toLowerCase();
    const contentType = CT[ext] ?? 'application/octet-stream';
    return { body, contentType };
  };
}
