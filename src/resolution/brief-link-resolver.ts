/**
 * Brief ↔ spec link reconciliation (REQ-FUNNEL-002).
 *
 * A brainstorm brief (`specs/<slug>/brief.md`, indexed as a `brief`-kind spec by
 * REQ-FUNNEL-001) is linked to the spec it produced by reconciling BOTH pointer
 * directions:
 *
 *   - the brief's own `spec:` frontmatter (carried in `brief.metadata.spec`),
 *     which MAY name a requirement — in which case it resolves UP to that
 *     requirement's enclosing document; and
 *   - a document spec whose `brief:` frontmatter points back at the brief's file.
 *
 * A link is established when EITHER direction resolves. With neither, the brief
 * is an unlinked `idea`. When the two directions resolve to DIFFERENT documents,
 * the link is `conflict` — surfaced rather than silently resolved to one side.
 *
 * The link is COMPUTED from current DB state (not materialized), so it is always
 * fresh and needs no re-index bookkeeping.
 */

import * as path from 'path';
import { Spec, SpecLink } from '../types';

export type BriefLinkState = 'idea' | 'specified' | 'conflict';

export interface BriefLink {
  briefId: string;
  /** Document the brief links to, or null when `idea` / `conflict`. */
  linkedSpecId: string | null;
  state: BriefLinkState;
  /** Document the brief's own `spec:` resolves to (requirement → document), or null. */
  briefSide: string | null;
  /** Document whose `brief:` points back at this brief, or null. */
  specSide: string | null;
}

/** Minimal slice of SpecQueries this resolver needs (eases testing). */
export interface SpecLookup {
  getSpecById(id: string): Spec | null;
  getAllSpecs(): Spec[];
}

/** Strip a trailing ` # comment` and surrounding quotes from a frontmatter value. */
export function cleanSpecPointer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (!v) return null;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  } else {
    // Strip an unquoted trailing comment (whitespace + '#'), mirroring the
    // server's parseBriefField — a '#fragment' with no leading space is kept.
    const h = v.search(/\s#/);
    if (h !== -1) v = v.slice(0, h).trim();
  }
  return v || null;
}

const fwd = (p: string): string => p.replace(/\\/g, '/');

/** Resolve a spec id up to its enclosing document id (walk parent_id to the root). */
export function resolveToDocumentId(sq: SpecLookup, id: string): string | null {
  let cur = sq.getSpecById(id);
  if (!cur) return null;
  const seen = new Set<string>();
  while (cur.kind !== 'document' && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = sq.getSpecById(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

/** The document (if any) whose `brief:` frontmatter resolves to this brief's file. */
function documentPointingAtBrief(sq: SpecLookup, brief: Spec): string | null {
  const target = fwd(brief.sourcePath);
  for (const s of sq.getAllSpecs()) {
    if (s.kind !== 'document' || !s.metadata || typeof s.metadata !== 'object') continue;
    const ref = cleanSpecPointer((s.metadata as Record<string, unknown>).brief);
    if (!ref) continue;
    // `brief:` is relative to the spec file's own directory.
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(fwd(s.sourcePath)), fwd(ref))
    );
    if (resolved === target) return s.id;
  }
  return null;
}

/** Reconcile a brief's link to its spec from both pointer directions. */
export function resolveBriefLink(sq: SpecLookup, brief: Spec): BriefLink {
  const meta =
    brief.metadata && typeof brief.metadata === 'object'
      ? (brief.metadata as Record<string, unknown>)
      : {};

  const ptr = cleanSpecPointer(meta.spec);
  const briefSide = ptr ? resolveToDocumentId(sq, ptr) : null;
  const specSide = documentPointingAtBrief(sq, brief);

  if (briefSide && specSide && briefSide !== specSide) {
    return { briefId: brief.id, linkedSpecId: null, state: 'conflict', briefSide, specSide };
  }
  const linkedSpecId = briefSide ?? specSide ?? null;
  return {
    briefId: brief.id,
    linkedSpecId,
    state: linkedSpecId ? 'specified' : 'idea',
    briefSide,
    specSide,
  };
}

// ---------------------------------------------------------------------------
// Idea capture fields (REQ-IDEAS-002.A2) — the single source of truth for a
// brief's capture date + labels, shared by the `ideas` review view and the
// list-mode inventory so both surfaces render the same values.
// ---------------------------------------------------------------------------

/**
 * Read a brief's idea-capture fields from the frontmatter REQ-IDEAS-001 writes.
 *
 *  - `capturedAt` — `metadata.created` (the capture moment) parsed to epoch ms.
 *    `spec.createdAt` is index-time, not capture-time, so age MUST come from
 *    here. Accepts an epoch-ms number or an ISO/date string; `null` when the
 *    key is absent or unparseable.
 *  - `labels` — the plural `metadata.labels` (a comma-delimited string OR a
 *    `string[]`) PLUS the singular `metadata.label` the capture verb writes
 *    (treated as a one-element list). `[]` when neither is present.
 *
 * Defensive throughout: older briefs (captured before REQ-IDEAS-001) carry
 * neither field, and both surfaces must still render cleanly.
 */
export function ideaCaptureFields(brief: Spec): { capturedAt: number | null; labels: string[] } {
  const meta =
    brief.metadata && typeof brief.metadata === 'object'
      ? (brief.metadata as Record<string, unknown>)
      : {};

  let capturedAt: number | null = null;
  const created = meta.created;
  if (typeof created === 'number' && Number.isFinite(created)) {
    capturedAt = created;
  } else if (typeof created === 'string' && created.trim().length > 0) {
    const parsed = Date.parse(created.trim());
    if (!Number.isNaN(parsed)) capturedAt = parsed;
  }

  const labels: string[] = [];
  // Plural `labels`: comma-delimited string or an array.
  const many = meta.labels;
  if (typeof many === 'string') {
    for (const part of many.split(',')) {
      const v = part.trim();
      if (v) labels.push(v);
    }
  } else if (Array.isArray(many)) {
    for (const part of many) {
      const v = String(part).trim();
      if (v) labels.push(v);
    }
  }
  // Singular `label`: the key the capture verb writes — a one-element list.
  const one = meta.label;
  if (typeof one === 'string') {
    const v = one.trim();
    if (v) labels.push(v);
  }

  return { capturedAt, labels };
}

// ---------------------------------------------------------------------------
// Project-wide funnel (REQ-FUNNEL-004/005/006 share this one computation)
// ---------------------------------------------------------------------------

export interface SpecFunnelSummary {
  ideas: number;
  specified: number;
  conflicts: number;
  documents: number;
  requirements: number;
  links: { implemented: number; verified: number; drifted: number; broken: number; orphaned: number };
}

export interface SpecFunnelDoc {
  id: string;
  title: string;
  rollup: BriefRollup;
}

export interface SpecFunnel {
  summary: SpecFunnelSummary;
  documents: SpecFunnelDoc[];
  ideas: Array<{ briefId: string; title: string; capturedAt: number | null; labels: string[] }>;
  conflicts: Array<{ briefId: string; briefSide: string | null; specSide: string | null }>;
}

/** Implementation rollup for a single document's requirements. */
function documentRollup(sq: FunnelLookup, docId: string): BriefRollup {
  const reqs = sq.getSpecsByParent(docId).filter((s) => s.kind === 'requirement');
  const r: BriefRollup = {
    requirements: reqs.length,
    implemented: 0,
    verified: 0,
    drifted: 0,
    broken: 0,
    orphaned: 0,
  };
  for (const req of reqs) {
    for (const lk of sq.getLinksBySpec(req.id)) {
      if (lk.state === 'implemented') r.implemented++;
      else if (lk.state === 'verified') r.verified++;
      else if (lk.state === 'drifted') r.drifted++;
      else if (lk.state === 'broken') r.broken++;
      else if (lk.state === 'orphaned') r.orphaned++;
    }
  }
  return r;
}

/** Compute the project-wide spec lifecycle funnel (idea → spec → implemented). */
export function computeSpecFunnel(sq: FunnelLookup): SpecFunnel {
  const all = sq.getAllSpecs();
  const documents = all.filter((s) => s.kind === 'document');
  const requirements = all.filter((s) => s.kind === 'requirement');
  const briefLinks = all.filter((s) => s.kind === 'brief').map((b) => resolveBriefLink(sq, b));

  const links = { implemented: 0, verified: 0, drifted: 0, broken: 0, orphaned: 0 };
  for (const req of requirements) {
    for (const lk of sq.getLinksBySpec(req.id)) {
      if (lk.state === 'implemented') links.implemented++;
      else if (lk.state === 'verified') links.verified++;
      else if (lk.state === 'drifted') links.drifted++;
      else if (lk.state === 'broken') links.broken++;
      else if (lk.state === 'orphaned') links.orphaned++;
    }
  }

  const ideas = briefLinks
    .filter((l) => l.state === 'idea')
    .map((l) => {
      const brief = sq.getSpecById(l.briefId);
      const cap = brief ? ideaCaptureFields(brief) : { capturedAt: null, labels: [] };
      return { briefId: l.briefId, title: brief?.title ?? '', capturedAt: cap.capturedAt, labels: cap.labels };
    });
  const conflicts = briefLinks
    .filter((l) => l.state === 'conflict')
    .map((l) => ({ briefId: l.briefId, briefSide: l.briefSide, specSide: l.specSide }));

  return {
    summary: {
      ideas: ideas.length,
      specified: briefLinks.filter((l) => l.state === 'specified').length,
      conflicts: conflicts.length,
      documents: documents.length,
      requirements: requirements.length,
      links,
    },
    documents: documents.map((d) => ({ id: d.id, title: d.title, rollup: documentRollup(sq, d.id) })),
    ideas,
    conflicts,
  };
}

/** All briefs that resolve (non-conflicting) to a given document. */
export function findBriefsForSpec(sq: SpecLookup, docId: string): BriefLink[] {
  const out: BriefLink[] = [];
  for (const s of sq.getAllSpecs()) {
    if (s.kind !== 'brief') continue;
    const link = resolveBriefLink(sq, s);
    if (link.linkedSpecId === docId) out.push(link);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lifecycle rollup (REQ-FUNNEL-003)
// ---------------------------------------------------------------------------

/** SpecLookup plus the queries needed to roll up a document's implementation. */
export interface FunnelLookup extends SpecLookup {
  getSpecsByParent(parentId: string): Spec[];
  getLinksBySpec(specId: string): SpecLink[];
}

/**
 * Implementation rollup for a linked brief's document — counts of the
 * document's requirement→code links by state. `implemented` (declared) and
 * `verified` (test-confirmed) are kept distinct so a declared-but-unverified
 * link is never reported as proven. `drafted` / `implementing` are in-progress
 * and counted as neither (they are not "implemented").
 */
export interface BriefRollup {
  requirements: number;
  implemented: number;
  verified: number;
  drifted: number;
  broken: number;
  orphaned: number;
}

export interface BriefFunnelEntry {
  briefId: string;
  state: BriefLinkState;
  linkedSpecId: string | null;
  /** Implementation rollup of the linked document; null for `idea` / `conflict`. */
  rollup: BriefRollup | null;
}

/**
 * Roll a brief up to its lifecycle state (REQ-FUNNEL-003): `idea` (unlinked),
 * `conflict` (ambiguous link), or `specified` with an implementation rollup of
 * the linked document's requirements. A document whose links are all
 * drifted/broken/orphaned yields implemented=0 — degraded states are surfaced
 * rather than mistaken for a working implementation.
 */
export function summarizeBriefFunnel(sq: FunnelLookup, brief: Spec): BriefFunnelEntry {
  const link = resolveBriefLink(sq, brief);
  if (link.state !== 'specified' || !link.linkedSpecId) {
    return { briefId: brief.id, state: link.state, linkedSpecId: link.linkedSpecId, rollup: null };
  }

  const requirements = sq
    .getSpecsByParent(link.linkedSpecId)
    .filter((s) => s.kind === 'requirement');

  const rollup: BriefRollup = {
    requirements: requirements.length,
    implemented: 0,
    verified: 0,
    drifted: 0,
    broken: 0,
    orphaned: 0,
  };
  for (const req of requirements) {
    for (const lk of sq.getLinksBySpec(req.id)) {
      switch (lk.state) {
        case 'implemented': rollup.implemented++; break;
        case 'verified': rollup.verified++; break;
        case 'drifted': rollup.drifted++; break;
        case 'broken': rollup.broken++; break;
        case 'orphaned': rollup.orphaned++; break;
        default: break; // drafted / implementing — in-progress, not "implemented"
      }
    }
  }

  return { briefId: brief.id, state: 'specified', linkedSpecId: link.linkedSpecId, rollup };
}
