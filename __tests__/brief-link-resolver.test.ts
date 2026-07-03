/**
 * Brief ↔ spec link reconciliation (REQ-FUNNEL-002).
 *
 * Pure-logic tests against a stub SpecLookup — no DB / FTS5 needed.
 */

import { describe, it, expect } from 'vitest';
import { Spec } from '../src/types';
import {
  resolveBriefLink,
  findBriefsForSpec,
  cleanSpecPointer,
  resolveToDocumentId,
  summarizeBriefFunnel,
  ideaCaptureFields,
  computeSpecFunnel,
  SpecLookup,
  FunnelLookup,
} from '../src/resolution/brief-link-resolver';
import { SpecLink, SpecLinkState } from '../src/types';

function spec(p: Partial<Spec> & { id: string; kind: Spec['kind'] }): Spec {
  return {
    title: '',
    body: '',
    format: 'markdown',
    sourcePath: 'specs/x.md',
    contentHash: 'h',
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

function lookup(specs: Spec[]): SpecLookup {
  const byId = new Map(specs.map((s) => [s.id, s]));
  return {
    getSpecById: (id: string) => byId.get(id) ?? null,
    getAllSpecs: () => specs,
  };
}

describe('cleanSpecPointer', () => {
  it('strips a trailing comment, quotes, and blanks', () => {
    expect(cleanSpecPointer('REQ-1   # specs/foo.md (notes)')).toBe('REQ-1');
    expect(cleanSpecPointer('"DOC-X"')).toBe('DOC-X');
    expect(cleanSpecPointer("'DOC-Y'")).toBe('DOC-Y');
    expect(cleanSpecPointer('  SPEC-FUNNEL-DOC  ')).toBe('SPEC-FUNNEL-DOC');
    expect(cleanSpecPointer('')).toBeNull();
    expect(cleanSpecPointer(undefined)).toBeNull();
  });
});

describe('resolveToDocumentId', () => {
  it('walks a requirement up to its enclosing document', () => {
    const sq = lookup([
      spec({ id: 'DOC', kind: 'document' }),
      spec({ id: 'REQ-1', kind: 'requirement', parentId: 'DOC' }),
      spec({ id: 'ACC', kind: 'acceptance', parentId: 'REQ-1' }),
    ]);
    expect(resolveToDocumentId(sq, 'REQ-1')).toBe('DOC');
    expect(resolveToDocumentId(sq, 'ACC')).toBe('DOC');
    expect(resolveToDocumentId(sq, 'DOC')).toBe('DOC');
    expect(resolveToDocumentId(sq, 'MISSING')).toBeNull();
  });
});

describe('resolveBriefLink (REQ-FUNNEL-002)', () => {
  const doc = spec({ id: 'DOC', kind: 'document', sourcePath: 'specs/doc.md', metadata: { brief: 'doc/brief.md' } });
  const req1 = spec({ id: 'REQ-1', kind: 'requirement', parentId: 'DOC', sourcePath: 'specs/doc.md' });
  const req2 = spec({ id: 'REQ-2', kind: 'requirement', parentId: 'DOC', sourcePath: 'specs/doc.md' });

  it('A1: brief.spec pointing at a requirement resolves to its document, linked both ways', () => {
    const brief = spec({
      id: 'brief:doc',
      kind: 'brief',
      sourcePath: 'specs/doc/brief.md',
      metadata: { spec: 'REQ-1   # appended to specs/doc.md' },
    });
    const sq = lookup([doc, req1, req2, brief]);
    const link = resolveBriefLink(sq, brief);
    expect(link.state).toBe('specified');
    expect(link.linkedSpecId).toBe('DOC');
    expect(link.briefSide).toBe('DOC');
    // queryable from the spec side too
    expect(findBriefsForSpec(sq, 'DOC').map((l) => l.briefId)).toContain('brief:doc');
  });

  it('A2: spec.brief points back even when the brief.spec is unset', () => {
    const brief = spec({ id: 'brief:doc', kind: 'brief', sourcePath: 'specs/doc/brief.md', metadata: {} });
    const sq = lookup([doc, req1, brief]);
    const link = resolveBriefLink(sq, brief);
    expect(link.state).toBe('specified');
    expect(link.linkedSpecId).toBe('DOC');
    expect(link.specSide).toBe('DOC');
    expect(link.briefSide).toBeNull();
  });

  it('A3: a brief with no resolvable spec is an unlinked idea', () => {
    const brief = spec({ id: 'brief:lonely', kind: 'brief', sourcePath: 'specs/lonely/brief.md', metadata: {} });
    const sq = lookup([doc, req1, brief]);
    const link = resolveBriefLink(sq, brief);
    expect(link.state).toBe('idea');
    expect(link.linkedSpecId).toBeNull();
  });

  it('A4: brief.spec and spec.brief resolving to different docs is a conflict, not a silent pick', () => {
    const docX = spec({ id: 'DOCX', kind: 'document', sourcePath: 'specs/docx.md', metadata: {} });
    const docY = spec({ id: 'DOCY', kind: 'document', sourcePath: 'specs/docy.md', metadata: { brief: 'bd/brief.md' } });
    const brief = spec({ id: 'brief:c', kind: 'brief', sourcePath: 'specs/bd/brief.md', metadata: { spec: 'DOCX' } });
    const sq = lookup([docX, docY, brief]);
    const link = resolveBriefLink(sq, brief);
    expect(link.state).toBe('conflict');
    expect(link.linkedSpecId).toBeNull();
    expect(link.briefSide).toBe('DOCX');
    expect(link.specSide).toBe('DOCY');
  });

  it('REQ-IDEAS-001.A1: the brief the `idea` verb writes (slug + created + label, no spec) is an idea', () => {
    // Exactly the frontmatter the capture verb emits — a slug, a creation
    // date, and a capture-time label, but no `spec:` pointer and no document
    // pointing back at it. The funnel must report this as an unlinked `idea`.
    const brief = spec({
      id: 'brief:cache-the-snapshots',
      kind: 'brief',
      sourcePath: 'specs/cache-the-snapshots/brief.md',
      metadata: { slug: 'cache-the-snapshots', created: '2026-07-03', label: 'perf' },
    });
    const sq = lookup([doc, req1, req2, brief]);
    const link = resolveBriefLink(sq, brief);
    expect(link.state).toBe('idea');
    expect(link.linkedSpecId).toBeNull();
  });

  it('A5: a brief linked to a requirement is attributed to its document, not the sibling requirements', () => {
    const brief = spec({
      id: 'brief:doc',
      kind: 'brief',
      sourcePath: 'specs/doc/brief.md',
      metadata: { spec: 'REQ-1' },
    });
    const sq = lookup([doc, req1, req2, brief]);
    const link = resolveBriefLink(sq, brief);
    expect(link.linkedSpecId).toBe('DOC');
    // It does not claim the sibling requirement.
    expect(link.linkedSpecId).not.toBe('REQ-2');
  });
});

describe('ideaCaptureFields (REQ-IDEAS-002.A2)', () => {
  const brief = (metadata: Record<string, unknown>): Spec =>
    spec({ id: 'brief:x', kind: 'brief', sourcePath: 'specs/x/brief.md', metadata });

  it('returns null age + no labels for a brief with no capture fields', () => {
    expect(ideaCaptureFields(brief({ slug: 'x' }))).toEqual({ capturedAt: null, labels: [] });
    // A brief with no metadata at all is handled too (older briefs).
    expect(ideaCaptureFields(spec({ id: 'brief:y', kind: 'brief' }))).toEqual({
      capturedAt: null,
      labels: [],
    });
  });

  it('parses `created` as an ISO date string into epoch ms', () => {
    const { capturedAt } = ideaCaptureFields(brief({ created: '2026-06-30' }));
    expect(capturedAt).toBe(Date.parse('2026-06-30'));
  });

  it('accepts `created` as a raw epoch-ms number', () => {
    const ms = 1_781_000_000_000;
    expect(ideaCaptureFields(brief({ created: ms })).capturedAt).toBe(ms);
  });

  it('returns null age for an unparseable `created`', () => {
    expect(ideaCaptureFields(brief({ created: 'not-a-date' })).capturedAt).toBeNull();
    expect(ideaCaptureFields(brief({ created: '' })).capturedAt).toBeNull();
  });

  it('splits a comma-delimited `labels` string', () => {
    expect(ideaCaptureFields(brief({ labels: 'perf, cache , infra' })).labels).toEqual([
      'perf',
      'cache',
      'infra',
    ]);
  });

  it('accepts `labels` as a string array (map to String, drop blanks)', () => {
    expect(ideaCaptureFields(brief({ labels: ['perf', 'cache', ''] })).labels).toEqual([
      'perf',
      'cache',
    ]);
  });

  it('accepts the singular `label` key as a one-element list (the capture verb writes it)', () => {
    expect(ideaCaptureFields(brief({ label: 'infra' })).labels).toEqual(['infra']);
  });

  it('combines a plural `labels` and a singular `label`', () => {
    expect(ideaCaptureFields(brief({ labels: 'perf', label: 'infra' })).labels).toEqual([
      'perf',
      'infra',
    ]);
  });
});

describe('summarizeBriefFunnel (REQ-FUNNEL-003)', () => {
  const doc = spec({ id: 'DOC', kind: 'document', sourcePath: 'specs/doc.md', metadata: { brief: 'doc/brief.md' } });
  const req1 = spec({ id: 'REQ-1', kind: 'requirement', parentId: 'DOC', sourcePath: 'specs/doc.md' });
  const req2 = spec({ id: 'REQ-2', kind: 'requirement', parentId: 'DOC', sourcePath: 'specs/doc.md' });
  const brief = spec({ id: 'brief:doc', kind: 'brief', sourcePath: 'specs/doc/brief.md', metadata: { spec: 'DOC' } });

  function link(specId: string, state: SpecLinkState): SpecLink {
    return { specId, state } as unknown as SpecLink;
  }

  function funnelLookup(specs: Spec[], links: Record<string, SpecLink[]>): FunnelLookup {
    const byId = new Map(specs.map((s) => [s.id, s]));
    return {
      getSpecById: (id) => byId.get(id) ?? null,
      getAllSpecs: () => specs,
      getSpecsByParent: (pid) => specs.filter((s) => s.parentId === pid),
      getLinksBySpec: (sid) => links[sid] ?? [],
    };
  }

  it('A1: an unlinked brief has state idea and no rollup', () => {
    const lonely = spec({ id: 'brief:l', kind: 'brief', sourcePath: 'specs/l/brief.md', metadata: {} });
    const sq = funnelLookup([doc, req1, lonely], {});
    const e = summarizeBriefFunnel(sq, lonely);
    expect(e.state).toBe('idea');
    expect(e.rollup).toBeNull();
  });

  it('A2: a linked doc with zero implemented links is specified with an all-zero rollup', () => {
    const sq = funnelLookup([doc, req1, req2, brief], {});
    const e = summarizeBriefFunnel(sq, brief);
    expect(e.state).toBe('specified');
    expect(e.rollup).toEqual({ requirements: 2, implemented: 0, verified: 0, drifted: 0, broken: 0, orphaned: 0 });
  });

  it('A3/A4: rolls up requirement link-states, keeping implemented distinct from verified', () => {
    const sq = funnelLookup([doc, req1, req2, brief], {
      'REQ-1': [link('REQ-1', 'implemented')],
      'REQ-2': [link('REQ-2', 'verified'), link('REQ-2', 'drifted')],
    });
    const e = summarizeBriefFunnel(sq, brief);
    expect(e.rollup).toEqual({ requirements: 2, implemented: 1, verified: 1, drifted: 1, broken: 0, orphaned: 0 });
  });

  it('A5: a doc whose links are all degraded reports implemented=0, surfacing the degraded states', () => {
    const sq = funnelLookup([doc, req1, req2, brief], {
      'REQ-1': [link('REQ-1', 'drifted')],
      'REQ-2': [link('REQ-2', 'orphaned')],
    });
    const e = summarizeBriefFunnel(sq, brief);
    expect(e.rollup!.implemented).toBe(0);
    expect(e.rollup!.verified).toBe(0);
    expect(e.rollup!.drifted).toBe(1);
    expect(e.rollup!.orphaned).toBe(1);
  });

  it('a conflicting brief has state conflict and no rollup', () => {
    // DOC does NOT point back; DOCY does — so brief.spec (DOC) and the
    // spec-side pointer (DOCY) disagree.
    const docNoBrief = spec({ id: 'DOC', kind: 'document', sourcePath: 'specs/doc.md', metadata: {} });
    const docY = spec({ id: 'DOCY', kind: 'document', sourcePath: 'specs/docy.md', metadata: { brief: 'doc/brief.md' } });
    const conflicting = spec({ id: 'brief:doc', kind: 'brief', sourcePath: 'specs/doc/brief.md', metadata: { spec: 'DOC' } });
    const sq = funnelLookup([docNoBrief, docY, req1, conflicting], {});
    const e = summarizeBriefFunnel(sq, conflicting);
    expect(e.state).toBe('conflict');
    expect(e.rollup).toBeNull();
  });
});

describe('computeSpecFunnel — seeded-promotion drops the brief from ideas (REQ-IDEAS-003.A2)', () => {
  function funnelLookup(specs: Spec[], links: Record<string, SpecLink[]> = {}): FunnelLookup {
    const byId = new Map(specs.map((s) => [s.id, s]));
    return {
      getSpecById: (id) => byId.get(id) ?? null,
      getAllSpecs: () => specs,
      getSpecsByParent: (pid) => specs.filter((s) => s.parentId === pid),
      getLinksBySpec: (sid) => links[sid] ?? [],
    };
  }

  it('a spec whose `brief:` frontmatter resolves to a brief flips it to specified and out of the ideas view; an unlinked brief stays', () => {
    // The spec a seeded promotion writes: `specs/doc.md` carrying
    // `brief: doc/brief.md` — a value relative to the spec file's own dir, so it
    // resolves to the brief at `specs/doc/brief.md` (documentPointingAtBrief).
    const doc = spec({
      id: 'DOC',
      kind: 'document',
      sourcePath: 'specs/doc.md',
      metadata: { brief: 'doc/brief.md' },
    });
    const req1 = spec({ id: 'REQ-1', kind: 'requirement', parentId: 'DOC', sourcePath: 'specs/doc.md' });
    const promoted = spec({ id: 'brief:doc', kind: 'brief', sourcePath: 'specs/doc/brief.md', metadata: {} });
    const lonely = spec({ id: 'brief:lonely', kind: 'brief', sourcePath: 'specs/lonely/brief.md', metadata: {} });

    const funnel = computeSpecFunnel(funnelLookup([doc, req1, promoted, lonely]));

    const ideaIds = funnel.ideas.map((i) => i.briefId);
    expect(ideaIds).toContain('brief:lonely'); // still an unpromoted idea
    expect(ideaIds).not.toContain('brief:doc'); // promoted → specified
    expect(funnel.summary.ideas).toBe(1);
    expect(funnel.summary.specified).toBe(1);
  });
});
