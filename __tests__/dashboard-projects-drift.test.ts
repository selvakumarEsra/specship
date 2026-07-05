import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encodeProjectSlug } from '../packages/server/src/ingest/project-paths';
import { enumerate, attachDriftCounts, type DriftSource } from '../packages/server/src/routes/projects';

/**
 * REQ-DESKTOP-018 — per-project drift in /api/projects. The switcher shows a
 * warn pill next to projects with drifted/broken/orphaned spec links, so the
 * route decorates each initialized entry with `driftCount` (null = unknown:
 * uninitialized, open failure, or outside the recency-bounded sweep).
 */

let tmp: string;
let claudeJsonPath: string;
let claudeRoot: string;

/**
 * Create a project dir + its slug dir under claudeRoot, and register the real
 * path in claude.json so the slug resolver recovers it (slug decode is lossy).
 */
function seedProject(name: string, initialized: boolean): { slug: string; real: string } {
  const real = path.join(tmp, 'dev', name);
  fs.mkdirSync(initialized ? path.join(real, '.specship') : real, { recursive: true });
  const slug = encodeProjectSlug(real);
  fs.mkdirSync(path.join(claudeRoot, slug), { recursive: true });
  const cj = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')) as { projects: Record<string, unknown> };
  cj.projects[real] = {};
  fs.writeFileSync(claudeJsonPath, JSON.stringify(cj));
  return { slug, real };
}

/** DriftSource whose graphs report a fixed link count per slug. */
function sourceWithCounts(counts: Record<string, number>, calls?: string[]): DriftSource {
  return async (slug) => {
    calls?.push(slug);
    if (!(slug in counts)) return null;
    return { getSpecQueries: () => ({ getLinksByState: () => new Array(counts[slug]).fill({}) }) };
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projdrift-'));
  claudeJsonPath = path.join(tmp, '.claude.json');
  claudeRoot = path.join(tmp, 'projects');
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('/api/projects driftCount (REQ-DESKTOP-018)', () => {
  it('reports the drifted/broken/orphaned link count for an initialized project', async () => {
    const { slug } = seedProject('with-drift', true);
    const list = await enumerate(claudeRoot, { claudeJsonPath, claudeRoot });
    expect(list.find((p) => p.slug === slug)!.driftCount).toBeNull(); // pre-attach baseline

    await attachDriftCounts(list, sourceWithCounts({ [slug]: 3 }));
    expect(list.find((p) => p.slug === slug)!.driftCount).toBe(3);
  });

  it('leaves driftCount null for uninitialized projects and never opens them', async () => {
    const { slug } = seedProject('no-specship', false);
    const calls: string[] = [];
    const list = await attachDriftCounts(
      await enumerate(claudeRoot, { claudeJsonPath, claudeRoot }),
      sourceWithCounts({ [slug]: 5 }, calls),
    );
    expect(list.find((p) => p.slug === slug)!.driftCount).toBeNull();
    expect(calls).not.toContain(slug);
  });

  it('leaves driftCount null when the graph fails to open or the query throws', async () => {
    const a = seedProject('open-fails', true);
    const b = seedProject('query-throws', true);
    const source: DriftSource = async (slug) => {
      if (slug === a.slug) return null; // registry open failure
      return { getSpecQueries: () => { throw new Error('db locked'); } };
    };
    const list = await attachDriftCounts(await enumerate(claudeRoot, { claudeJsonPath, claudeRoot }), source);
    expect(list.find((p) => p.slug === a.slug)!.driftCount).toBeNull();
    expect(list.find((p) => p.slug === b.slug)!.driftCount).toBeNull();
  });

  it('bounds the sweep to the most recent initialized projects', async () => {
    const first = seedProject('recent', true);
    const second = seedProject('older', true);
    // enumerate() sorts by transcript recency — give `first` a newer transcript.
    fs.writeFileSync(path.join(claudeRoot, second.slug, 's.jsonl'), '{}\n');
    fs.writeFileSync(path.join(claudeRoot, first.slug, 's.jsonl'), '{}\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(claudeRoot, first.slug, 's.jsonl'), future, future);

    const calls: string[] = [];
    const list = await attachDriftCounts(
      await enumerate(claudeRoot, { claudeJsonPath, claudeRoot }),
      sourceWithCounts({ [first.slug]: 1, [second.slug]: 2 }, calls),
      1,
    );
    expect(calls).toEqual([first.slug]);
    expect(list.find((p) => p.slug === first.slug)!.driftCount).toBe(1);
    expect(list.find((p) => p.slug === second.slug)!.driftCount).toBeNull();
  });

  it('a zero count is reported as 0, not null (UI hides the pill at zero)', async () => {
    const { slug } = seedProject('clean', true);
    const list = await attachDriftCounts(
      await enumerate(claudeRoot, { claudeJsonPath, claudeRoot }),
      sourceWithCounts({ [slug]: 0 }),
    );
    expect(list.find((p) => p.slug === slug)!.driftCount).toBe(0);
  });
});
