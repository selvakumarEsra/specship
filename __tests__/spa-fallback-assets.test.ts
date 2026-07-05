/**
 * REQ-OFFLINE-005 — a missing static asset must NOT be answered with the app
 * shell.
 *
 * Regression (2026-07-03): a tab holding a stale build requested its old
 * content-hashed bundle (`main-GYKPJBCT.js`) during a server restart window;
 * the SPA fallback answered 200 `text/html` (index.html), the offline service
 * worker cached HTML under the bundle URL, and the tab was stuck on a module
 * MIME error until the user cleared site data. A missing asset path must 404;
 * only extension-less client routes fall back to the shell.
 *
 * Covers:
 *   1. `isAssetPath` — pure helper (unit).
 *   2. The real `createServer` fallback handler via Fastify `.inject()`
 *      against a temp webDir (integration; no network, no project).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isAssetPath } from '../server/src/static-handler';
import { createServer, type ServerHandle } from '../server/src/server';

describe('isAssetPath', () => {
  it('recognizes asset extensions', () => {
    expect(isAssetPath('/main-GYKPJBCT.js')).toBe(true);
    expect(isAssetPath('/styles-ABC123.css')).toBe(true);
    expect(isAssetPath('/media/logo.svg')).toBe(true);
    expect(isAssetPath('/fonts/geist.woff2')).toBe(true);
    expect(isAssetPath('/chunk-XYZ.js?v=2')).toBe(true); // query stripped
  });

  it('keeps client routes on the shell fallback', () => {
    expect(isAssetPath('/')).toBe(false);
    expect(isAssetPath('/memory')).toBe(false);
    expect(isAssetPath('/sessions/0b7a2c9e-1f4d-4e5a-9c3b-2d6f8a1e5b4c')).toBe(false);
    // Dotted route params that are NOT asset extensions (REQ-OFFLINE-005.A3).
    expect(isAssetPath('/specs/REQ-OFFLINE-001.A1')).toBe(false);
  });
});

describe('SPA fallback for missing assets (REQ-OFFLINE-005)', () => {
  let webDir: string;
  let handle: ServerHandle;

  beforeAll(async () => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-fallback-'));
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>shell</title>');
    fs.writeFileSync(path.join(webDir, 'app.js'), 'export const ok = true;');
    handle = await createServer({
      webDir,
      host: '127.0.0.1',
      port: 0,
      ingest: false,
      cors: false,
    });
  });

  afterAll(async () => {
    await handle?.stop();
    fs.rmSync(webDir, { recursive: true, force: true });
  });

  it('404s a missing content-hashed bundle instead of serving the shell (A1)', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/main-STALEHASH.js' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toContain('text/html');
    expect(res.body).not.toContain('<title>shell</title>');
  });

  it('serves the shell for extension-less client routes (A2)', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/memory' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>shell</title>');
  });

  it('serves the shell for dotted non-asset route params (A3)', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/specs/REQ-OFFLINE-001.A1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('still serves an existing asset with its content type (A4)', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.body).toContain('export const ok');
  });

  it('keeps /api/* misses and non-GET methods on the JSON 404 path (A4)', async () => {
    const apiMiss = await handle.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(apiMiss.statusCode).toBe(404);
    expect(apiMiss.headers['content-type']).toContain('application/json');

    const post = await handle.app.inject({ method: 'POST', url: '/memory' });
    expect(post.statusCode).toBe(404);
  });
});
