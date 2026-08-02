/**
 * REQ-JIRAREG-005 correction #2 — SpecLinkResolver must skip re-resolution
 * for links whose `targetFilePath` starts with `jira://`. Those are external
 * evidence pointers owned by the pack-run recorder; a code-graph sync must
 * NOT flip them to orphaned / drifted / anything else.
 */
import { describe, it, expect } from 'vitest';
import type { SpecLink } from '../../src/types';
import { SpecLinkResolver } from '../../src/resolution/spec-link-resolver';

function link(overrides: Partial<SpecLink> = {}): SpecLink {
  return {
    id: 1,
    specId: 'REQ-X.A1',
    targetFilePath: 'jira://PROJ-42',
    targetQualifiedName: 'PROJ-42',
    targetNodeKind: 'file',
    kind: 'validates',
    state: 'verified',
    specHashAtLink: 'h',
    provenance: 'agent-asserted',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('SpecLinkResolver — jira:// external target guard', () => {
  it('resolveAll does NOT update state / resolution for a jira:// link', () => {
    const stateWrites: number[] = [];
    const resolutionWrites: number[] = [];
    const queries = {
      getNodesByQualifiedNameExact: () => [],
      getNodesByFile: () => [],
    } as unknown as ConstructorParameters<typeof SpecLinkResolver>[0];
    const specQueries = {
      getAllLinks: () => [link()],
      getLinksByTargetFile: () => [],
      updateSpecLinkResolution: (id: number) => resolutionWrites.push(id),
      updateSpecLinkState: (id: number) => stateWrites.push(id),
    } as unknown as ConstructorParameters<typeof SpecLinkResolver>[1];

    const resolver = new SpecLinkResolver(queries, specQueries);
    const stats = resolver.resolveAll();
    expect(stats.scanned).toBe(1);
    expect(stats.orphaned).toBe(0);
    expect(stateWrites).toEqual([]);
    expect(resolutionWrites).toEqual([]);
  });

  it('a regular code-path link on the same sync still flows through normal resolution', () => {
    const stateWrites: number[] = [];
    const resolutionWrites: number[] = [];
    const queries = {
      // No matching node → normal path would orphan a code-target link.
      getNodesByQualifiedNameExact: () => [],
      getNodesByFile: () => [],
    } as unknown as ConstructorParameters<typeof SpecLinkResolver>[0];
    const specQueries = {
      getAllLinks: () => [
        link({ id: 1 }),
        link({
          id: 2,
          targetFilePath: 'src/foo.ts',
          targetQualifiedName: 'foo',
          targetNodeKind: 'function',
          kind: 'implements',
          state: 'implemented',
        }),
      ],
      getLinksByTargetFile: () => [],
      updateSpecLinkResolution: (id: number) => resolutionWrites.push(id),
      updateSpecLinkState: (id: number) => stateWrites.push(id),
    } as unknown as ConstructorParameters<typeof SpecLinkResolver>[1];

    const resolver = new SpecLinkResolver(queries, specQueries);
    resolver.resolveAll();
    // The jira:// row (id=1) was never touched; the code row (id=2) was.
    expect(stateWrites).toEqual([2]);
    expect(resolutionWrites).toEqual([2]);
  });
});
