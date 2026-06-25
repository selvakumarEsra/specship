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
import { Spec } from '../types';

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
