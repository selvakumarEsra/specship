/**
 * Domain gap-seed (REQ-DOMAIN-003).
 *
 * A read-only pass that surfaces what the domain knowledge layer does NOT yet
 * cover, so an author (or the `/specship:spec domain` command, REQ-DOMAIN-004) can decide
 * what to document next. It answers two questions against current DB state:
 *
 *   - which structural code entities (classes, structs, interfaces, routes,
 *     components) are reached by NO domain fact; and
 *   - which non-domain specs (documents, requirements, …) have NO domain fact
 *     hanging off them.
 *
 * A domain fact carries no direct domain→code rows. It reaches code transitively
 * through its spec-tier chain (`parentId` + `metadata.depends_on`), resolved by
 * {@link SpecLinkResolver.getInheritedLinks} (REQ-DOMAIN-002). An entity is
 * "documented" when some domain fact's inherited links resolve to that entity's
 * node; a spec is "documented" when some domain fact's spec-tier chain reaches
 * it. Everything else is a gap.
 *
 * COMPUTED from live state — writes nothing. Like the spec funnel
 * (`computeSpecFunnel`), the result is always fresh and needs no bookkeeping.
 */

import { Node, NodeKind, Spec, SpecKind } from '../types';
import { QueryBuilder } from '../db/queries';
import { SpecQueries } from '../db/spec-queries';
import { SpecLinkResolver } from './spec-link-resolver';

/** The structural node kinds the gap-seed considers "domain-worthy" entities. */
const IN_SCOPE_ENTITY_KINDS: NodeKind[] = [
  'class',
  'struct',
  'interface',
  'route',
  'component',
];

/** A code entity not yet reached by any domain fact. */
export interface GapSeedEntity {
  nodeId: string;
  name: string;
  qualifiedName: string;
  kind: NodeKind;
  filePath: string;
}

/** A non-domain spec with no domain fact hanging off it. */
export interface GapSeedSpec {
  id: string;
  title: string;
  kind: SpecKind;
}

/**
 * Coverage tally over the entity ∪ spec universe. `documented + gaps` always
 * equals the total count of in-scope entities plus non-domain specs.
 */
export interface DomainCoverage {
  documented: number;
  gaps: number;
}

export interface DomainGapSeed {
  entities: GapSeedEntity[];
  specs: GapSeedSpec[];
  coverage: DomainCoverage;
}

/**
 * Compute the domain gap-seed: the in-scope entities and non-domain specs that
 * no domain fact yet covers. Read-only — issues only `SELECT`s through the
 * passed query objects and the resolver's read-time `getInheritedLinks`.
 */
export function computeDomainGapSeed(
  queries: QueryBuilder,
  specQueries: SpecQueries,
  resolver: SpecLinkResolver
): DomainGapSeed {
  // In-scope entities: every structural code symbol a domain fact could document.
  const entities: Node[] = IN_SCOPE_ENTITY_KINDS.flatMap((k) =>
    queries.getNodesByKind(k)
  );

  // Build the documented sets by walking each domain fact's spec-tier chain.
  const allSpecs = specQueries.getAllSpecs();
  const documentedNodeIds = new Set<string>();
  const documentedSpecIds = new Set<string>();

  for (const spec of allSpecs) {
    if (spec.kind !== 'domain') continue;
    const inherited = resolver.getInheritedLinks(spec);
    for (const { link } of inherited.links) {
      if (link.resolvedNodeId) documentedNodeIds.add(link.resolvedNodeId);
    }
    // Every indexed spec the fact reaches counts as documented — even one that
    // contributes no code link of its own (REQ-DOMAIN-003.A2).
    for (const reached of inherited.visitedSpecIds) {
      documentedSpecIds.add(reached);
    }
  }

  // Gap entities: in-scope entities no domain fact resolves to (A1, A2).
  const gapEntities: GapSeedEntity[] = entities
    .filter((n) => !documentedNodeIds.has(n.id))
    .map((n) => ({
      nodeId: n.id,
      name: n.name,
      qualifiedName: n.qualifiedName,
      kind: n.kind,
      filePath: n.filePath,
    }));

  // Non-domain specs are the spec-side universe; a domain fact is never its own
  // documentation target.
  const nonDomainSpecs: Spec[] = allSpecs.filter((s) => s.kind !== 'domain');
  const gapSpecs: GapSeedSpec[] = nonDomainSpecs
    .filter((s) => !documentedSpecIds.has(s.id))
    .map((s) => ({ id: s.id, title: s.title, kind: s.kind }));

  // Coverage over the entity ∪ spec universe (A3): the denominator is the total
  // count of in-scope entities plus non-domain specs, so documented + gaps
  // always reconstitutes it exactly.
  const gaps = gapEntities.length + gapSpecs.length;
  const documented = entities.length + nonDomainSpecs.length - gaps;

  return {
    entities: gapEntities,
    specs: gapSpecs,
    coverage: { documented, gaps },
  };
}
