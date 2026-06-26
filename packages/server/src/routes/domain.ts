/**
 * GET /api/domain (REQ-DOMAIN-007).
 *
 * Returns the active project's domain knowledge layer — human-confirmed facts
 * grouped by their `metadata.type` (term / rule / decision / constraint, plus an
 * `other` catch-all so nothing is silently dropped) and the coverage rollup
 * (`{documented, gaps}`) from the domain gap-seed.
 *
 * Project-scoped, like the spec / maintainability routes: domain facts live in
 * the spec layer, so the handler resolves the active instance and 409s when no
 * project is selectable. Driven entirely through instance methods
 * (`getSpecQueries()`, `getDomainGapSeed()`) so the server never runtime-imports
 * the `@selvakumaresra/specship` package (which would silently serve a stale
 * build).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** The recognized domain fact types; anything else lands in `other`. */
const FACT_TYPES = ['term', 'rule', 'decision', 'constraint'] as const;
type FactType = (typeof FACT_TYPES)[number];
type FactBucket = FactType | 'other';

interface DomainFact {
  id: string;
  title: string;
  body: string;
}

export async function registerDomainRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/domain', async (req: FastifyRequest, reply: FastifyReply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      reply.code(409).send({ error: 'no project selected', code: 'no_project' });
      return;
    }

    const facts = cg.getSpecQueries().getSpecsByKind('domain');

    // Group by `metadata.type` (the same key surfaced in the MCP tools and CLI).
    // Unrecognized or missing types fall into `other` so nothing is dropped.
    const factsByType: Record<FactBucket, DomainFact[]> = {
      term: [],
      rule: [],
      decision: [],
      constraint: [],
      other: [],
    };
    for (const f of facts) {
      const rawType = (f.metadata as Record<string, unknown> | undefined)?.type;
      const bucket: FactBucket =
        typeof rawType === 'string' && (FACT_TYPES as readonly string[]).includes(rawType)
          ? (rawType as FactType)
          : 'other';
      factsByType[bucket].push({ id: f.id, title: f.title, body: f.body ?? '' });
    }

    const { coverage } = cg.getDomainGapSeed();

    return { factsByType, coverage };
  });
}
