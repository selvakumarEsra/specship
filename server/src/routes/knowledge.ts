/**
 * GET /api/knowledge (REQ-KNOW-007).
 *
 * Read-only knowledge view: every domain fact with its id, title, type and the
 * requirement ids it links to at the spec tier (`parentId` + `depends_on`),
 * plus — for `type: external` facts — the dependency it is pinned to, the
 * version it was verified against, and its freshness against the version
 * installed in the project (`fresh` / `stale` / `unverifiable`).
 *
 * Like the domain route, it reaches the engine only through the dynamically
 * loaded instance (`cg.getSpecQueries()`, `cg.getProjectRoot()`) and never
 * runtime-imports the bare `@specship/specship` package (DOM-SPECSHIP-004).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Freshness of an external fact against its installed dependency. */
export type FactFreshness = 'fresh' | 'stale' | 'unverifiable';

export interface KnowledgeFact {
  id: string;
  title: string;
  /** The fact's `type:` (term / rule / decision / constraint / external), or `''`. */
  type: string;
  /** Requirement ids the fact links to (`parent_id` + `depends_on`). */
  linkedRequirementIds: string[];
  /** External facts only: the package / tool the fact is about. */
  dependency?: string;
  /** External facts only: the version the fact was verified against. */
  version?: string;
  /** External facts only: freshness against the installed version. */
  stale?: FactFreshness;
  /** External facts only: the installed version, when one was found. */
  installedVersion?: string;
}

function linkedIds(parentId: unknown, dependsOn: unknown): string[] {
  const out: string[] = [];
  if (typeof parentId === 'string' && parentId.length > 0) out.push(parentId);
  if (Array.isArray(dependsOn)) {
    for (const d of dependsOn) if (typeof d === 'string' && d.length > 0) out.push(d);
  } else if (typeof dependsOn === 'string' && dependsOn.length > 0) {
    for (const d of dependsOn.split(',')) if (d.trim()) out.push(d.trim());
  }
  return [...new Set(out)];
}

/** Read one flat `key: value` from a markdown file's frontmatter. */
function frontmatterValue(file: string, key: string): string | undefined {
  let source: string;
  try {
    source = readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
  const lines = source.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '---') break;
    const idx = line.indexOf(':');
    if (idx > 0 && line.slice(0, idx).trim() === key) {
      return line.slice(idx + 1).trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
    }
  }
  return undefined;
}

/** The version of `dependency` installed under `<projectRoot>/node_modules`. */
function installedVersion(projectRoot: string, dependency: string): string | undefined {
  if (dependency.includes('..')) return undefined;
  const pkg = path.join(projectRoot, 'node_modules', dependency, 'package.json');
  if (!existsSync(pkg)) return undefined;
  try {
    const v = (JSON.parse(readFileSync(pkg, 'utf-8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function registerKnowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/knowledge', async (req: FastifyRequest, reply: FastifyReply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      reply.code(409).send({ error: 'no project selected', code: 'no_project' });
      return;
    }

    const projectRoot = cg.getProjectRoot();
    const facts: KnowledgeFact[] = [];
    for (const f of cg.getSpecQueries().getSpecsByKind('domain')) {
      const meta = (f.metadata ?? {}) as Record<string, unknown>;
      const type = typeof meta.type === 'string' ? meta.type : '';
      const fact: KnowledgeFact = {
        id: f.id,
        title: f.title,
        type,
        linkedRequirementIds: linkedIds(f.parentId, meta.depends_on),
      };

      if (type === 'external') {
        const dependency = typeof meta.dependency === 'string' ? meta.dependency : undefined;
        // `version` is a known top-level frontmatter key the extractor keeps as
        // the numeric spec version, so a semver string may not survive into
        // metadata — fall back to the fact's own frontmatter on disk.
        const version =
          typeof meta.version === 'string'
            ? meta.version
            : frontmatterValue(path.join(projectRoot, f.sourcePath), 'version');
        // Freshness from the project's own node_modules only. The CLI's
        // `specship knowledge stale` (findStaleExternalFacts) also consults the
        // global npm root; the server stays local-only and never imports the
        // engine package directly (DOM-SPECSHIP-004), so a dependency installed
        // only globally reads `unverifiable` here — never `fresh`.
        const installed = dependency ? installedVersion(projectRoot, dependency) : undefined;
        fact.dependency = dependency;
        fact.version = version;
        fact.stale =
          installed === undefined || version === undefined
            ? 'unverifiable'
            : installed === version
              ? 'fresh'
              : 'stale';
        if (installed !== undefined) fact.installedVersion = installed;
      }
      facts.push(fact);
    }
    facts.sort((a, b) => a.id.localeCompare(b.id));
    return { facts };
  });
}
