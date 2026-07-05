/**
 * REQ-DESKTOP-017.A1 — the dashboard server serves the built ui/ SPA with no
 * second process or port: index at /, hashed assets with correct types,
 * missing assets 404 (never the shell — REQ-OFFLINE-005), deep links fall
 * back to index.html, and /api/* stays JSON-404.
 *
 * Runs against the real `ui/dist` via Fastify `.inject()` (no network, no
 * project). Skips gracefully when the SPA hasn't been built in this checkout
 * (`cd ui && npm ci && npm run build`) — mirroring the dist-dependent suites'
 * behavior on fresh worktrees.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, resolveDefaultWebDir, type ServerHandle } from '../packages/server/src/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDist = path.join(root, 'ui', 'dist');
const built = fs.existsSync(path.join(uiDist, 'index.html'));

describe.skipIf(!built)('serving the built ui/ SPA (REQ-DESKTOP-017.A1)', () => {
  let handle: ServerHandle;
  let jsAsset: string;

  beforeAll(async () => {
    const assets = fs.readdirSync(path.join(uiDist, 'assets'));
    jsAsset = assets.find((f) => f.endsWith('.js'))!;
    expect(jsAsset, 'built dist should contain a hashed JS bundle').toBeTruthy();
    handle = await createServer({
      webDir: uiDist,
      host: '127.0.0.1',
      port: 0,
      ingest: false,
      cors: false,
    });
  });

  afterAll(async () => {
    await handle?.stop();
  });

  it('serves index.html at /', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
  });

  it('serves a hashed asset with the right content type', async () => {
    const res = await handle.app.inject({ method: 'GET', url: `/assets/${jsAsset}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
  });

  it('serves the self-hosted fonts from the app origin (A4)', async () => {
    const assets = fs.readdirSync(path.join(uiDist, 'assets'));
    const font = assets.find((f) => f.endsWith('.woff2'));
    expect(font, 'built dist should self-host the Geist woff2 files').toBeTruthy();
    const res = await handle.app.inject({ method: 'GET', url: `/assets/${font}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('font/woff2');
  });

  it('404s a missing hashed asset instead of serving the shell', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/assets/index-STALEHASH.js' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toContain('text/html');
  });

  it('falls back to index.html for deep links', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/specs/REQ-DESKTOP-017' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
  });

  it('keeps /api/* out of the SPA fallback', async () => {
    const res = await handle.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

describe.skipIf(!built)('resolveDefaultWebDir', () => {
  it('finds the workspace ui/dist when no webDir is passed', () => {
    expect(resolveDefaultWebDir()).toBe(uiDist);
  });

  it('auto-mounts the SPA when webDir is omitted entirely', async () => {
    const handle = await createServer({ host: '127.0.0.1', port: 0, ingest: false, cors: false });
    try {
      const res = await handle.app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<div id="root">');
    } finally {
      await handle.stop();
    }
  });

  it('serves no SPA when webDir is explicitly null', async () => {
    const handle = await createServer({ webDir: null, host: '127.0.0.1', port: 0, ingest: false, cors: false });
    try {
      const res = await handle.app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(404);
    } finally {
      await handle.stop();
    }
  });
});
