import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerGraphRoutes } from '../server/src/routes/graph';
import { registerSpecRoutes } from '../server/src/routes/spec';
import { registerWorkflowRoutes } from '../server/src/routes/workflow';
import { registerClaudeRoutes } from '../server/src/routes/claude';
import { registerStatusRoutes } from '../server/src/routes/status';
import { registerMemoryRoutes } from '../server/src/routes/memory';
import { registerProjectsRoutes } from '../server/src/routes/projects';
import { registerReflectRoutes } from '../server/src/routes/reflect';
import { registerMaintainabilityRoutes } from '../server/src/routes/maintainability';
import { registerDomainRoutes } from '../server/src/routes/domain';
import { registerMcpRoutes } from '../server/src/routes/mcp';
import { registerConfigRoutes } from '../server/src/routes/config';

/**
 * REQ-TVIZ-004.A3 — the route-inventory guard.
 *
 * Registering an `/api` route is how the dashboard grows, and a new route that
 * nothing drives is how the dashboard grows *untested*. This test boots the
 * server's route groups onto a bare Fastify instance, enumerates what they
 * registered, and diffs that inventory against a checked-in manifest. Adding a
 * route therefore forces an explicit line in the manifest — the moment where
 * the author decides whether it gets an e2e/integration test or a recorded
 * waiver.
 *
 * It is NOT a coverage assertion: the manifest records intent, and the diff
 * makes silent additions and silent removals both impossible.
 */
const MANIFEST_PATH = path.join(__dirname, 'fixtures', 'route-manifest.json');

interface Manifest {
  routes: Record<string, { tested: string }>;
}

/** Register every route group the real `createServer` does, collecting routes. */
async function collectRoutes(): Promise<string[]> {
  const app = Fastify() as FastifyInstance;
  const seen = new Set<string>();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) {
      // Fastify auto-registers HEAD alongside GET; it isn't a distinct surface.
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      seen.add(`${m} ${route.url}`);
    }
  });

  // Handlers reach shared state through these decorations. Registration itself
  // only closes over them, so inert stubs are enough to enumerate the surface.
  app.decorate('projects', {} as never);
  app.decorate('primaryCg', null);
  app.decorate('watcher', null);
  app.decorate('ingestControl', {
    enabled: () => false,
    active: () => false,
    start: () => false,
    stop: () => undefined,
  } as never);
  app.decorate('activeCg', async () => null);

  await registerStatusRoutes(app);
  await registerGraphRoutes(app);
  await registerSpecRoutes(app);
  await registerWorkflowRoutes(app);
  await registerClaudeRoutes(app);
  await registerMemoryRoutes(app);
  await registerProjectsRoutes(app);
  await registerReflectRoutes(app);
  await registerMaintainabilityRoutes(app);
  await registerDomainRoutes(app);
  await registerMcpRoutes(app);
  await registerConfigRoutes(app);
  await app.ready();
  await app.close();

  return [...seen].sort();
}

const readManifest = (): Manifest => JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

describe('server route inventory (REQ-TVIZ-004.A3)', () => {
  it('every registered /api route is listed in the checked-in manifest', async () => {
    const actual = await collectRoutes();
    const manifest = readManifest();
    const listed = new Set(Object.keys(manifest.routes));

    const unlisted = actual.filter((r) => !listed.has(r));
    expect(
      unlisted,
      unlisted.length === 0 ? '' : [
        `${unlisted.length} route(s) are registered but absent from ${path.relative(process.cwd(), MANIFEST_PATH)}:`,
        ...unlisted.map((r) => `  ${r}`),
        '',
        'Add each one with a "tested" note saying what drives it — an e2e spec, a',
        'vitest file, or an explicit "waived: <reason>". A new route must be a',
        'conscious decision, not a silent addition (REQ-TVIZ-004.A3).',
      ].join('\n'),
    ).toEqual([]);
  });

  it('the manifest lists no route that has been removed', async () => {
    const actual = new Set(await collectRoutes());
    const stale = Object.keys(readManifest().routes).filter((r) => !actual.has(r));
    expect(
      stale,
      stale.length === 0 ? '' : [
        `${stale.length} manifest entr(ies) no longer exist on the server:`,
        ...stale.map((r) => `  ${r}`),
        '',
        'Delete them from the manifest — a stale entry hides the fact that a',
        'surface (and whatever tested it) went away.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('every manifest entry records what tests it', () => {
    const bad = Object.entries(readManifest().routes)
      .filter(([, v]) => typeof v?.tested !== 'string' || v.tested.trim() === '')
      .map(([k]) => k);
    expect(bad, `manifest entries missing a non-empty "tested" note:\n${bad.join('\n')}`).toEqual([]);
  });
});
