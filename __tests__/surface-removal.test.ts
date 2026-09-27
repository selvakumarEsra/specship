import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Fastify from 'fastify';
import { registerClaudeRoutes } from '../server/src/routes/claude';

/**
 * REQ-SURF-001 / REQ-SURF-004 / REQ-SURF-005 (specs/surface-cleanup.md) —
 * removed dashboard surfaces stay removed. These are source scans rather than
 * behavioural tests because the contract is an ABSENCE: the route, the boot
 * backfill, the prefs and the client methods must not come back, and a
 * regression would otherwise only show up as dead weight nobody notices.
 */

const root = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string): boolean => fs.existsSync(path.join(root, rel));

describe('REQ-SURF-001 — the dead GET /api/events SSE route is gone', () => {
  it('A1: the route module and its registration no longer exist', () => {
    expect(exists('server/src/routes/events.ts')).toBe(false);
    const server = read('server/src/server.ts');
    expect(server).not.toContain('registerEventsRoutes');
    expect(server).not.toContain('routes/events.js');
  });

  it('A1: no source file declares or fetches /api/events', () => {
    const hits = walk(['server/src', 'ui/src'])
      .filter((f) => /\/api\/events\b/.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it("A1: the run-log stream the Runs page uses is a DIFFERENT endpoint and survives", () => {
    // /api/workflows/runs/:id/events is the live run log — it was never the
    // cross-project alert poller and must keep working.
    expect(read('ui/src/api.ts')).toContain('/api/workflows/runs/');
    expect(read('ui/src/components/run-detail.tsx')).toContain('runEventsUrl');
  });

  it('A2: the registry maxOpen inflation is justified by a surface that still exists', () => {
    const server = read('server/src/server.ts');
    const comment = server.slice(0, server.indexOf('new ProjectRegistry'));
    expect(comment).toContain('DRIFT_SWEEP_LIMIT');
    expect(read('server/src/routes/projects.ts')).toContain('DRIFT_SWEEP_LIMIT');
  });
});

describe('REQ-SURF-005 — the unused specship-impact engine is gone', () => {
  it('A1: the route, the ingest module and the client method are all removed', () => {
    expect(exists('server/src/ingest/impact-query.ts')).toBe(false);
    expect(read('server/src/routes/claude.ts')).not.toContain('specship-impact');
    expect(read('ui/src/api.ts')).not.toContain('specshipImpact');
    expect(read('ui/src/api.ts')).not.toContain('SpecshipImpactResponse');
  });

  it('A1: the session summary no longer carries an unrendered specship field', () => {
    expect(read('server/src/routes/claude.ts')).not.toContain('computeSpecshipImpact');
  });

  it('A2: nothing imports the removed module (no dangling imports)', () => {
    const hits = walk(['server/src', 'ui/src'])
      .filter((f) => /impact-query/.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('A1: the boot-time backfill call is gone from server startup', () => {
    expect(read('server/src/server.ts')).not.toContain('backfillDisplaced');
  });

  it('A2: the /api/claude routes still register, and specship-impact 404s', async () => {
    const app = Fastify({ logger: false });
    app.decorate('primaryCg', null);
    app.decorate('watcher', null);
    await registerClaudeRoutes(app);
    await app.ready();

    // The route is gone, so the 404 handler answers — not the route's own 409.
    expect((await app.inject({ url: '/api/claude/specship-impact' })).statusCode).toBe(404);
    // A neighbouring analytics route still exists (409 = registered, no primary).
    expect((await app.inject({ url: '/api/claude/stats' })).statusCode).toBe(409);
    await app.close();
  });
});

describe('REQ-SURF-004 — dead settings knobs are gone', () => {
  it('A1: the boot-animation and editor prefs helpers are removed, Density stays', () => {
    const prefs = read('ui/src/prefs.ts');
    expect(prefs).toContain('getDensity');
    for (const dead of ['getBootAnim', 'setBootAnim', 'BOOTED_SESSION_KEY', 'getEditor', 'setEditor', 'EDITORS']) {
      expect(prefs).not.toContain(dead);
    }
  });

  it('A2: no Settings copy references a nonexistent open-in-editor feature', () => {
    const settings = read('ui/src/pages/settings.tsx');
    expect(settings).not.toContain('Open files with');
    expect(settings).not.toContain('Open in editor');
    expect(settings).not.toContain('Boot animation');
  });
});

/** Every .ts/.tsx file under the given repo-relative dirs. */
function walk(dirs: string[]): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const d of dirs) visit(path.join(root, d));
  return out;
}
