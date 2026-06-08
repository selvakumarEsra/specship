/**
 * SpecLinkResolver
 *
 * Mirrors the role of `ReferenceResolver` for spec → code links. Each sync
 * cycle, this resolver:
 *
 *   1. For every changed file, walks spec_links whose `target_file_path`
 *      matches and re-resolves `resolved_node_id` against the current
 *      `nodes` table by (file_path, qualified_name, kind).
 *   2. Compares the resolved node's signature to `node_sig_at_link`. If
 *      changed → state transitions to `drifted (drift_axis='code')`.
 *   3. If no matching node exists → `resolved_node_id = NULL` and the link
 *      transitions to `orphaned` (unless already terminal-ish: `verified`,
 *      `broken` stay; orphaned is the new resting state).
 *   4. Spec hash drift is handled separately by the spec extraction stage
 *      (it calls `markSpecDrifted` directly).
 *
 * Why this is much simpler than ReferenceResolver:
 *   - No cross-file import / framework resolution. Links carry their own
 *     logical target (file + qualified_name) — no name-matching required.
 *   - No LRU caches needed: the SQLite index on
 *     (target_file_path, target_qualified_name) makes lookups O(log N).
 *
 * It also handles the inbound side: applying `SpecLinkCandidate[]` produced
 * by spec extractors (provenance='spec-declaration', confidence 0.7) and
 * by code-comment scanning (provenance='code-comment', confidence 0.9).
 * Highest-confidence signal wins per logical key — `upsertSpecLink` enforces
 * this.
 */

import {
  Node,
  NodeKind,
  Spec,
  SpecLink,
  SpecLinkState,
  SpecLinkProvenance,
} from '../types';
import { QueryBuilder } from '../db/queries';
import { SpecQueries } from '../db/spec-queries';
import { SpecLinkCandidate } from '../extraction/specs/types';

/** Pattern: `// @implements REQ-X` or `# @implements REQ-X` etc. */
const CODE_COMMENT_IMPL = /@implements\s+([A-Za-z][A-Za-z0-9_.-]*)/g;

/**
 * Terminal-ish states that the resolver does NOT downgrade automatically.
 * `verified` is the success terminal; `broken` requires explicit re-verify.
 * `orphaned` won't become `implemented` again until the agent re-asserts.
 */
const STICKY_STATES: Set<SpecLinkState> = new Set(['verified', 'broken']);

export interface SpecLinkResolverOptions {
  /**
   * If true, log a one-line summary per resolved link.
   */
  verbose?: boolean;
}

export interface SpecLinkResolverStats {
  scanned: number;
  reresolved: number;
  orphaned: number;
  driftedCode: number;
  candidatesApplied: number;
  commentLinksApplied: number;
}

export class SpecLinkResolver {
  private queries: QueryBuilder;
  private specQueries: SpecQueries;
  private opts: SpecLinkResolverOptions;

  constructor(
    queries: QueryBuilder,
    specQueries: SpecQueries,
    opts: SpecLinkResolverOptions = {}
  ) {
    this.queries = queries;
    this.specQueries = specQueries;
    this.opts = opts;
  }

  /**
   * Re-resolve spec_links for a set of changed files. Call this from the
   * sync pipeline after code extraction completes for those files.
   */
  resolveLinksForFiles(changedFiles: string[]): SpecLinkResolverStats {
    const stats = this.makeStats();
    for (const file of changedFiles) {
      this.resolveLinksForFile(file, stats);
    }
    return stats;
  }

  /**
   * Re-resolve every spec_link in the database. Used by `indexAll` on a
   * fresh build, and as a paranoia pass after large refactors.
   */
  resolveAll(): SpecLinkResolverStats {
    const stats = this.makeStats();
    for (const link of this.specQueries.getAllLinks()) {
      this.resolveOneLink(link, stats);
    }
    return stats;
  }

  /**
   * Re-resolve all links whose logical target lives in `filePath`.
   */
  private resolveLinksForFile(filePath: string, stats: SpecLinkResolverStats): void {
    const links = this.specQueries.getLinksByTargetFile(filePath);
    for (const link of links) {
      this.resolveOneLink(link, stats);
    }
  }

  private resolveOneLink(link: SpecLink, stats: SpecLinkResolverStats): void {
    stats.scanned++;

    const node = this.findLogicalTarget(
      link.targetFilePath,
      link.targetQualifiedName,
      link.targetNodeKind
    );

    const now = Date.now();

    if (node === null) {
      // Logical target vanished. Mark orphaned unless link is sticky.
      this.specQueries.updateSpecLinkResolution(link.id, null, now);
      if (!STICKY_STATES.has(link.state) && link.state !== 'orphaned') {
        this.specQueries.updateSpecLinkState(link.id, 'orphaned', null, now);
        stats.orphaned++;
      }
      return;
    }

    // Target found — update resolved_node_id cache.
    this.specQueries.updateSpecLinkResolution(link.id, node.id, now);
    stats.reresolved++;

    // Code-side drift detection. We compare the node's current signature
    // to the snapshot taken at link creation. If the link has no baseline
    // (older link), don't trip drift — just adopt the current signature
    // on the next link_verify.
    if (
      link.nodeSigAtLink !== undefined &&
      link.nodeSigAtLink !== '' &&
      node.signature !== undefined &&
      node.signature !== link.nodeSigAtLink &&
      !STICKY_STATES.has(link.state)
    ) {
      this.specQueries.updateSpecLinkState(link.id, 'drifted', 'code', now);
      stats.driftedCode++;
      if (this.opts.verbose) {
        // eslint-disable-next-line no-console
        console.error(
          `[SpecLinkResolver] drift(code) ${link.targetQualifiedName} for spec ${link.specId}`
        );
      }
    }
  }

  /**
   * Look up a node by logical identity: (file_path, qualified_name).
   * `kind` is a hint, not a hard filter — we prefer an exact-kind match
   * but fall back to any kind on the same path/qname (a function turned
   * method is still "the same logical symbol" from the spec's POV).
   */
  private findLogicalTarget(
    filePath: string,
    qualifiedName: string,
    kind: NodeKind
  ): Node | null {
    const candidates = this.queries.getNodesByQualifiedNameExact(qualifiedName);
    if (candidates.length === 0) return null;

    // Prefer same-file matches.
    const sameFile = candidates.filter((n) => n.filePath === filePath);
    if (sameFile.length === 0) return null;

    // Prefer same-kind matches within the same file.
    const sameKind = sameFile.find((n) => n.kind === kind);
    if (sameKind) return sameKind;

    // Fall back to first same-file candidate.
    return sameFile[0] ?? null;
  }

  // ===========================================================================
  // Inbound: apply link candidates discovered during extraction
  // ===========================================================================

  /**
   * Apply spec-declared `implementations:` links. Provenance = 'spec-declaration',
   * confidence 0.7. Idempotent — upsert by logical key.
   */
  applyDeclarationCandidates(
    candidates: SpecLinkCandidate[],
    specsByIdForHash: Map<string, Spec>,
    stats?: SpecLinkResolverStats
  ): void {
    const now = Date.now();
    for (const c of candidates) {
      const spec = specsByIdForHash.get(c.specId);
      if (!spec) continue; // spec hasn't been inserted yet — skip; resolver will retry on next sync.

      const resolvedNode = this.findLogicalTarget(
        c.targetFilePath,
        c.targetQualifiedName,
        c.targetNodeKind
      );

      this.specQueries.upsertSpecLink({
        specId: c.specId,
        targetFilePath: c.targetFilePath,
        targetQualifiedName: c.targetQualifiedName,
        targetNodeKind: c.targetNodeKind,
        resolvedNodeId: resolvedNode?.id,
        kind: c.kind,
        state: resolvedNode ? 'implemented' : 'orphaned',
        driftAxis: null,
        specHashAtLink: spec.contentHash,
        nodeSigAtLink: resolvedNode?.signature,
        provenance: 'spec-declaration' as SpecLinkProvenance,
        confidence: 0.7,
        createdAt: now,
        updatedAt: now,
      });
      if (stats) stats.candidatesApplied++;
    }
  }

  /**
   * Scan node docstrings for `@implements REQ-X` markers and emit spec links.
   *
   * This is the load-bearing backstop when the agent forgets to call
   * specship_link_assert: the spec link still gets created from the
   * `// @implements REQ-X` comment in code. Provenance = 'code-comment',
   * confidence 0.9.
   *
   * Called from the sync pipeline after code extraction for changed files.
   * Bounded by the changed-files set — full-graph scans only on indexAll.
   */
  applyCodeCommentLinks(
    changedFiles: string[],
    stats?: SpecLinkResolverStats
  ): void {
    const now = Date.now();
    for (const file of changedFiles) {
      const nodes = this.queries.getNodesByFile(file);
      for (const node of nodes) {
        const sources = [node.docstring, node.signature].filter(
          (s): s is string => typeof s === 'string'
        );
        for (const source of sources) {
          // Reset regex state for global pattern.
          CODE_COMMENT_IMPL.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = CODE_COMMENT_IMPL.exec(source)) !== null) {
            const specId = match[1];
            if (!specId) continue;
            const spec = this.specQueries.getSpecById(specId);
            if (!spec) continue;
            this.specQueries.upsertSpecLink({
              specId,
              targetFilePath: node.filePath,
              targetQualifiedName: node.qualifiedName,
              targetNodeKind: node.kind,
              resolvedNodeId: node.id,
              kind: 'implements',
              state: 'implemented',
              driftAxis: null,
              specHashAtLink: spec.contentHash,
              nodeSigAtLink: node.signature,
              provenance: 'code-comment' as SpecLinkProvenance,
              confidence: 0.9,
              createdAt: now,
              updatedAt: now,
            });
            if (stats) stats.commentLinksApplied++;
          }
        }
      }
    }
  }

  // ===========================================================================
  // Spec-side drift (called from spec extraction stage)
  // ===========================================================================

  /**
   * Mark every link of `specId` as `drifted(spec)` because the spec's
   * `contentHash` changed since the link was established. Sticky states
   * (`verified`, `broken`) are left alone.
   *
   * The agent's job after seeing drift: re-read the spec, update code if
   * needed, call specship_link_verify to take state back to `verified`.
   */
  markSpecDrifted(specId: string, newSpecHash: string): number {
    const now = Date.now();
    let count = 0;
    for (const link of this.specQueries.getLinksBySpec(specId)) {
      if (STICKY_STATES.has(link.state)) continue;
      if (link.specHashAtLink === newSpecHash) continue;
      this.specQueries.updateSpecLinkState(link.id, 'drifted', 'spec', now);
      count++;
    }
    return count;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private makeStats(): SpecLinkResolverStats {
    return {
      scanned: 0,
      reresolved: 0,
      orphaned: 0,
      driftedCode: 0,
      candidatesApplied: 0,
      commentLinksApplied: 0,
    };
  }
}
