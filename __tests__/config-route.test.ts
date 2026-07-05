import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import { readServerConfig, writeServerConfig, serverConfigPath } from '../server/src/server-config';
import { registerConfigRoutes } from '../server/src/routes/config';

/**
 * REQ-DESKTOP-028.A2/.A3 — GET/PUT /api/config: the transcript-ingest toggle
 * persists to ~/.specship/server-config.json (survives a restart, written
 * atomically), and the payload carries the real product version for About.
 */

let tmp: string;
let cfgPath: string;

/** A minimal in-memory ingestControl matching server.ts's decoration. */
function fakeIngest(initial: boolean) {
  let on = initial;
  const calls: string[] = [];
  return {
    control: {
      enabled: () => on,
      start: async () => { on = true; calls.push('start'); },
      stop: () => { on = false; calls.push('stop'); },
    },
    calls,
  };
}

async function buildApp(initial: boolean): Promise<{ app: FastifyInstance; calls: string[] }> {
  const app = Fastify();
  const { control, calls } = fakeIngest(initial);
  app.decorate('ingestControl', control);
  await registerConfigRoutes(app);
  await app.ready();
  return { app, calls };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgroute-'));
  cfgPath = path.join(tmp, 'sub', 'server-config.json');
  process.env.SPECSHIP_SERVER_CONFIG = cfgPath;
});

afterEach(() => {
  delete process.env.SPECSHIP_SERVER_CONFIG;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('server-config persistence (REQ-DESKTOP-028.A2)', () => {
  it('serverConfigPath honors the SPECSHIP_SERVER_CONFIG override', () => {
    expect(serverConfigPath()).toBe(cfgPath);
  });

  it('writeServerConfig persists and readServerConfig reads it back across a fresh read (survives restart)', () => {
    expect(readServerConfig()).toEqual({}); // nothing yet → defaults
    writeServerConfig({ ingestEnabled: false });
    // A brand-new read (simulating a restarted process) sees the value.
    expect(readServerConfig()).toEqual({ ingestEnabled: false });
    expect(fs.existsSync(cfgPath)).toBe(true);
  });

  it('writeServerConfig merges without dropping unrelated keys and leaves no temp file', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({ ingestEnabled: true, other: 'keep' }));
    writeServerConfig({ ingestEnabled: false });
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(raw).toEqual({ ingestEnabled: false, other: 'keep' });
    // Atomic write cleans up its sibling temp file.
    expect(fs.readdirSync(path.dirname(cfgPath)).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('/api/config route (REQ-DESKTOP-028.A2/.A3)', () => {
  it('GET returns the current ingest flag and a real version string', async () => {
    const { app } = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ingestEnabled).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.version).toMatch(/\d+\.\d+\.\d+/);
    await app.close();
  });

  it('PUT persists the flag, flips the live watcher, and survives a restart', async () => {
    const { app, calls } = await buildApp(true);
    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { ingestEnabled: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ingestEnabled).toBe(false);
    expect(calls).toContain('stop');
    // Persisted to disk — a fresh boot reads the disabled state.
    expect(readServerConfig()).toEqual({ ingestEnabled: false });
    await app.close();
  });

  it('PUT with a non-boolean body is rejected 400 and persists nothing', async () => {
    const { app } = await buildApp(true);
    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { ingestEnabled: 'yes' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('bad_request');
    expect(fs.existsSync(cfgPath)).toBe(false);
    await app.close();
  });
});
