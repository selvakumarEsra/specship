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
  SpecLinkKind,
  STICKY_SPEC_LINK_STATES,
} from '../types';
import { QueryBuilder } from '../db/queries';
import { SpecQueries } from '../db/spec-queries';
import { SpecLinkCandidate } from '../extraction/specs/types';
import {
  isRecognizedTestFile,
  scanTestTitleRefs,
} from './test-title-links';
import * as fs from 'fs';
import * as path from 'path';

/** Pattern: `// @implements REQ-X` or `# @implements REQ-X` etc. */
const CODE_COMMENT_IMPL = /@implements\s+([A-Za-z][A-Za-z0-9_.-]*)/g;

/**
 * Pattern: `// @verifies REQ-X` on a TEST symbol — declares the test as
 * evidence for the spec (kind='tests'). Passing evidence is what gates
 * promotion to `verified` (VERIFY-EVID-DOC, REQ-VEVID-001.A2).
 */
const CODE_COMMENT_VERIFIES = /@verifies\s+([A-Za-z][A-Za-z0-9_.-]*)/g;

/**
 * Terminal-ish states that the resolver does NOT downgrade automatically.
 * `verified` is the success terminal; `broken` requires explicit re-verify.
 * `orphaned` is NOT sticky: when the logical target reappears (e.g. the
 * symbol was restored or a rename was reverted), the resolver auto-reattaches
 * the link to `implemented` (REQ-LINKFIX-001) — no agent re-assert needed.
 *
 * Defined in `types.ts` as {@link STICKY_SPEC_LINK_STATES} so the DB upsert
 * layer can reuse the exact same set (REQ-STICKYLINK-001).
 */
const STICKY_STATES = STICKY_SPEC_LINK_STATES;

/**
 * Normalize a qualified name to its canonical dotted form: every `::`
 * separator becomes `.` (REQ-LINKFIX-002). Used as the upsert key so
 * spec-declared `Class.method` and extractor-emitted `Class::method`
 * collapse to one logical link row.
 */
export function canonicalQualifiedName(name: string): string {
  return name.replace(/::/g, '.');
}

/**
 * Separator-form variants of a qualified name for lookup (REQ-LINKFIX-002):
 * `[name]` when it has no `.`/`::` separators; otherwise the name plus its
 * all-dotted and all-`::` forms (every separator swapped), deduped.
 */
export function qualifiedNameVariants(name: string): string[] {
  if (!name.includes('.') && !name.includes('::')) return [name];
  const dotted = canonicalQualifiedName(name);
  const coloned = dotted.replace(/\./g, '::');
  return [...new Set([name, dotted, coloned])];
}

export interface SpecLinkResolverOptions {
  /**
   * If true, log a one-line summary per resolved link.
   */
  verbose?: boolean;
  /**
   * Absolute project root. Required by {@link SpecLinkResolver.applyTestTitleLinks},
   * which reads test files from disk to scan their `it()` titles
   * (REQ-VSTATE-002); without it that pass is a no-op.
   */
  projectRoot?: string;
}

export interface SpecLinkResolverStats {
  scanned: number;
  reresolved: number;
  orphaned: number;
  driftedCode: number;
  candidatesApplied: number;
  commentLinksApplied: number;
  /**
   * `tests` links created from a spec id inside an `it()` / `test()` title in a
   * test file (REQ-VSTATE-002). Optional so existing stats literals keep
   * compiling — every producer sets it.
   */
  testTitleLinksApplied?: number;
  /**
   * `spec-declaration` links removed this pass because the bullet that declared
   * them is no longer in the spec file (REQ-VSTATE-001). Deleting a declaration
   * deletes its link, and the count is how that stays visible rather than
   * silent. Optional so existing stats literals keep compiling.
   */
  declarationsReconciled?: number;
  /**
   * Orphaned links whose logical target reappeared this pass and were
   * auto-reattached to `implemented` (REQ-LINKFIX-001).
   */
  reattached: number;
  /**
   * Links that TRANSITIONED into `drifted` during this pass (REQ-DRIFT-PUSH-001).
   * A link already in `drifted` that re-drifts is not recorded — consumers
   * (the sync CLI's push notice) must see each drift once, not on every sync.
   */
  transitions: DriftTransition[];
}

/** One link's transition into `drifted`, for push notification (DRIFT-PUSH-DOC). */
export interface DriftTransition {
  specId: string;
  fromState: SpecLinkState;
  axis: 'code' | 'spec';
  /** The linked symbol (`targetQualifiedName`). */
  symbol: string;
}

/** One code link inherited by a spec through a spec→spec dependency edge. */
export interface InheritedLink {
  /** The dependency spec id whose `implements` link this is. */
  viaSpecId: string;
  /** The inherited link itself (carries live `state` / `driftAxis`). */
  link: SpecLink;
}

/** Result of {@link SpecLinkResolver.getInheritedLinks}. */
export interface InheritedLinksResult {
  /** Code links reached transitively through the spec's parent / depends_on chain. */
  links: InheritedLink[];
  /** Declared dependency spec ids that don't resolve to an indexed spec (gaps). */
  gaps: string[];
  /**
   * Every *indexed* spec id reached through the spec-tier chain (excludes the
   * originating spec and the unresolved `gaps`). A spec a fact reaches but that
   * contributes no code link still appears here, so consumers like the domain
   * gap-seed (REQ-DOMAIN-003) can treat "reached by a domain fact" as documented
   * even when the reached spec carries no `spec_links` of its own.
   */
  visitedSpecIds: string[];
}

/** Default cap on how deep the parent / depends_on chain is followed. */
export const INHERITED_LINK_MAX_DEPTH = 5;

/**
 * The spec ids a spec links to at the spec tier: its `parentId` plus every
 * entry of `metadata.depends_on` (REQ-DOMAIN-002). `depends_on` may be a
 * single string or a string[]; both normalize to a deduped list of non-empty
 * ids.
 */
export function sourceSpecIds(spec: Spec): string[] {
  const out: string[] = [];
  if (typeof spec.parentId === 'string' && spec.parentId.length > 0) {
    out.push(spec.parentId);
  }
  const dep = spec.metadata?.depends_on;
  if (Array.isArray(dep)) {
    for (const d of dep) if (typeof d === 'string' && d.length > 0) out.push(d);
  } else if (typeof dep === 'string' && dep.length > 0) {
    out.push(dep);
  }
  // Dedup while preserving order.
  return [...new Set(out)];
}

/**
 * Metadata carrying the non-test-target flag for a `tests` link
 * (REQ-VSTATE-002.A4). Returns `undefined` for every other link kind so
 * non-evidence links keep clean metadata. The flag is written on EVERY pass
 * (true and false) so a target that moves into — or out of — a test file
 * self-corrects instead of keeping a stale verdict.
 */
function nonTestEvidenceFlag(
  kind: SpecLinkKind,
  targetFilePath: string
): Record<string, unknown> | undefined {
  if (kind !== 'tests') return undefined;
  return { nonTestTarget: !isRecognizedTestFile(targetFilePath) };
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

    // External evidence pointers (REQ-JIRAREG-005) carry a scheme-prefixed
    // `targetFilePath` that never resolves to a code node — a JIRA case key,
    // for example. Leave their state (verified / broken / …) untouched: the
    // recorder owns those transitions, and a code-graph re-resolve pass must
    // not flip them to orphaned.
    if (link.targetFilePath.startsWith('jira://')) {
      return;
    }

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

    // Auto-reattach (REQ-LINKFIX-001): an orphaned link whose logical target
    // reappeared goes back to `implemented`. Idempotent — a second pass sees
    // `implemented` and skips. The drift check below then runs against the
    // reattached state, so a signature-changed target immediately transitions
    // `implemented → drifted(code)`.
    let state = link.state;
    if (state === 'orphaned') {
      this.specQueries.updateSpecLinkState(link.id, 'implemented', null, now);
      state = 'implemented';
      stats.reattached++;
      if (this.opts.verbose) {
        // eslint-disable-next-line no-console
        console.error(
          `[SpecLinkResolver] reattached ${link.targetQualifiedName} for spec ${link.specId}`
        );
      }
    }

    // Code-side drift detection. We compare the node's current signature
    // to the snapshot taken at link creation. If the link has no baseline
    // (older link), don't trip drift — just adopt the current signature
    // on the next link_verify.
    if (
      link.nodeSigAtLink !== undefined &&
      link.nodeSigAtLink !== '' &&
      node.signature !== undefined &&
      node.signature !== link.nodeSigAtLink &&
      !STICKY_STATES.has(state)
    ) {
      this.specQueries.updateSpecLinkState(link.id, 'drifted', 'code', now);
      stats.driftedCode++;
      if (state !== 'drifted') {
        // A genuine transition, not a re-drift — record for push notification.
        stats.transitions.push({
          specId: link.specId,
          fromState: state,
          axis: 'code',
          symbol: link.targetQualifiedName,
        });
      }
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
   *
   * Public so the assert paths (MCP tool + dashboard route) can validate a
   * target BEFORE recording a link (REQ-REVINT-003) — the same lookup the
   * resolver uses, so validate-then-insert and the later resolve pass can
   * never disagree.
   */
  findLogicalTarget(
    filePath: string,
    qualifiedName: string,
    kind: NodeKind
  ): Node | null {
    // Look up every separator-form variant (Class.method ⇄ Class::method) so
    // a spec-declared dotted name still finds an extractor-emitted `::` node
    // and vice versa (REQ-LINKFIX-002).
    const candidates: Node[] = [];
    const seenIds = new Set<string>();
    for (const variant of qualifiedNameVariants(qualifiedName)) {
      for (const n of this.queries.getNodesByQualifiedNameExact(variant)) {
        if (seenIds.has(n.id)) continue;
        seenIds.add(n.id);
        candidates.push(n);
      }
    }
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
        // Canonical dotted form as the logical key (REQ-LINKFIX-002) so a
        // spec-declared `Class.method` and a code-comment `Class::method`
        // collapse to one row (highest confidence wins).
        targetQualifiedName: canonicalQualifiedName(c.targetQualifiedName),
        targetNodeKind: c.targetNodeKind,
        resolvedNodeId: resolvedNode?.id,
        kind: c.kind,
        state: resolvedNode ? 'implemented' : 'orphaned',
        driftAxis: null,
        specHashAtLink: spec.contentHash,
        nodeSigAtLink: resolvedNode?.signature,
        provenance: 'spec-declaration' as SpecLinkProvenance,
        confidence: 0.7,
        // A `verifies:` bullet pointing outside a recognized test file is
        // flagged, not trusted (REQ-VSTATE-002.A4) — fixtures and helpers may be
        // declared, but the flag keeps them out of the evidence gate.
        metadata: nonTestEvidenceFlag(c.kind, c.targetFilePath),
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
          // Both marker flavors share the link shape; only the kind differs.
          // `@verifies` marks TEST evidence (VERIFY-EVID-DOC, REQ-VEVID-001).
          const markers: Array<{ re: RegExp; kind: 'implements' | 'tests' }> = [
            { re: CODE_COMMENT_IMPL, kind: 'implements' },
            { re: CODE_COMMENT_VERIFIES, kind: 'tests' },
          ];
          for (const { re, kind } of markers) {
            // Reset regex state for global pattern.
            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(source)) !== null) {
              const specId = match[1];
              if (!specId) continue;
              const spec = this.specQueries.getSpecById(specId);
              if (!spec) continue;
              this.specQueries.upsertSpecLink({
                specId,
                targetFilePath: node.filePath,
                // Canonical dotted key (REQ-LINKFIX-002) — see
                // applyDeclarationCandidates.
                targetQualifiedName: canonicalQualifiedName(node.qualifiedName),
                targetNodeKind: node.kind,
                resolvedNodeId: node.id,
                kind,
                state: 'implemented',
                driftAxis: null,
                specHashAtLink: spec.contentHash,
                nodeSigAtLink: node.signature,
                provenance: 'code-comment' as SpecLinkProvenance,
                confidence: 0.9,
                // An `@verifies` marker on a symbol that isn't in a test file
                // is flagged the same way as a declared one (REQ-VSTATE-002.A4).
                metadata: nonTestEvidenceFlag(kind, node.filePath),
                createdAt: now,
                updatedAt: now,
              });
              if (stats) stats.commentLinksApplied++;
            }
          }
        }
      }
    }
  }

  /**
   * Scan TEST FILES for spec ids inside `it()` / `test()` titles and emit
   * `tests`-kind links (REQ-VSTATE-002).
   *
   * One link per (spec id, test file): the target is the test file's `file`
   * node — the only node the graph actually has for a test case's location —
   * and the matched titles ride along in `metadata.testTitles`, which is what
   * `specship verify --report` matches a reported case against (REQ-VSTATE-004).
   *
   * File-derived by construction: nothing is remembered between passes, so the
   * links are re-created on every extraction and survive re-index (A3). Only
   * recognized test files are scanned, so a spec id in a source file's message
   * string can never become evidence (A2).
   *
   * Requires `projectRoot` in the resolver options (it reads the files); a
   * resolver without one silently skips the pass.
   */
  applyTestTitleLinks(changedFiles: string[], stats?: SpecLinkResolverStats): void {
    const root = this.opts.projectRoot;
    if (!root) return;
    const now = Date.now();

    for (const file of changedFiles) {
      if (!isRecognizedTestFile(file)) continue;
      let source: string;
      try {
        source = fs.readFileSync(path.resolve(root, file), 'utf-8');
      } catch {
        continue; // deleted / unreadable — the resolve pass handles the fallout
      }

      // Group the file's titles by spec id so one link carries every title in
      // that file which names the same criterion.
      const titlesBySpec = new Map<string, string[]>();
      for (const ref of scanTestTitleRefs(source)) {
        const titles = titlesBySpec.get(ref.specId) ?? [];
        if (!titles.includes(ref.title)) titles.push(ref.title);
        titlesBySpec.set(ref.specId, titles);
      }
      if (titlesBySpec.size === 0) continue;

      const fileNode = this.findLogicalTarget(file, file, 'file');

      for (const [specId, titles] of titlesBySpec) {
        const spec = this.specQueries.getSpecById(specId);
        if (!spec) continue; // not a real spec id — just words in a title
        this.specQueries.upsertSpecLink({
          specId,
          targetFilePath: file,
          targetQualifiedName: canonicalQualifiedName(fileNode?.qualifiedName ?? file),
          targetNodeKind: 'file',
          resolvedNodeId: fileNode?.id,
          kind: 'tests',
          state: fileNode ? 'implemented' : 'orphaned',
          driftAxis: null,
          specHashAtLink: spec.contentHash,
          // A file node's "signature" is not a stable drift axis (any edit to
          // the file would trip it), so no baseline is taken here.
          nodeSigAtLink: undefined,
          provenance: 'code-comment' as SpecLinkProvenance,
          confidence: 0.9,
          metadata: { testTitles: titles, evidenceSource: 'test-title', nonTestTarget: false },
          createdAt: now,
          updatedAt: now,
        });
        if (stats) stats.testTitleLinksApplied = (stats.testTitleLinksApplied ?? 0) + 1;
      }
    }
  }

  // ===========================================================================
  // Spec-side drift (called from spec extraction stage)
  // ===========================================================================

  /**
   * Mark every link of `specId` as `drifted(spec)` because the spec's
   * `contentHash` changed since the link was established.
   *
   * This is the SOLE authority for the sticky+spec-drift transition
   * (REQ-STICKYLINK-002). `upsertSpecLink` deliberately preserves a sticky
   * (`verified`/`broken`) verdict on every re-upsert regardless of hash — so a
   * re-extraction never writes the intermediate `implemented` on a sticky link
   * — and hands the spec-axis downgrade to us. We take a sticky link whose
   * spec hash CHANGED straight to `drifted(spec)` in one step (never observed
   * as `implemented` in between) and record exactly one push-notice transition.
   * A sticky link whose hash is UNCHANGED is left verified (REQ-STICKYLINK-001);
   * the code-axis drift path lives in `resolveOneLink`/`resolveAll`, which is
   * unaffected by this method (REQ-STICKYLINK-002.A5).
   *
   * The agent's job after seeing drift: re-read the spec, update code if
   * needed, call specship_link_verify to take state back to `verified`.
   */
  markSpecDrifted(specId: string, newSpecHash: string, stats?: SpecLinkResolverStats): number {
    const now = Date.now();
    let count = 0;
    for (const link of this.specQueries.getLinksBySpec(specId)) {
      // Unchanged spec body → nothing drifts (keeps a sticky verdict sticky,
      // REQ-STICKYLINK-001). Checked FIRST so a sticky link only proceeds when
      // its hash genuinely moved.
      if (link.specHashAtLink === newSpecHash) continue;
      this.specQueries.updateSpecLinkState(link.id, 'drifted', 'spec', now);
      count++;
      if (stats && link.state !== 'drifted') {
        stats.transitions.push({
          specId: link.specId,
          fromState: link.state,
          axis: 'spec',
          symbol: link.targetQualifiedName,
        });
      }
    }
    return count;
  }

  // ===========================================================================
  // Transitive (spec-tier) inheritance — REQ-DOMAIN-002
  // ===========================================================================

  /**
   * Compute the code links a spec inherits transitively through its
   * spec→spec edges (`parentId` + `metadata.depends_on`). A `domain` fact
   * carries NO direct domain→code rows; its code association and drift state
   * are derived here by following those spec edges to requirement specs and
   * reusing *their* `spec_links` — whose `resolved_node_id`/`state` the normal
   * `resolveAll`/`resolveLinksForFiles` pass already refreshed this sync. So
   * "re-resolved after each sync" holds with no stored domain rows, and drift
   * surfaces automatically through each inherited link's live `state`.
   *
   * Read-time derivation only — writes nothing. Cycle-guarded via a visited
   * `Set`, depth-capped (default {@link INHERITED_LINK_MAX_DEPTH}). A declared
   * dependency that doesn't resolve to an indexed spec is returned in `gaps`
   * (an unlinked/proposed fact, never an error — REQ-DOMAIN-002.A3).
   */
  getInheritedLinks(
    spec: Spec,
    maxDepth: number = INHERITED_LINK_MAX_DEPTH
  ): InheritedLinksResult {
    const links: InheritedLink[] = [];
    const gaps: string[] = [];
    const visitedSpecIds: string[] = [];
    const visited = new Set<string>([spec.id]);
    const seenLinkIds = new Set<number>();

    // BFS over the parent / depends_on chain.
    const queue: Array<{ id: string; depth: number }> = sourceSpecIds(spec).map(
      (id) => ({ id, depth: 1 })
    );

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const src = this.specQueries.getSpecById(id);
      if (!src) {
        gaps.push(id);
        continue;
      }
      visitedSpecIds.push(id);

      for (const link of this.specQueries.getLinksBySpec(id)) {
        if (seenLinkIds.has(link.id)) continue;
        seenLinkIds.add(link.id);
        links.push({ viaSpecId: id, link });
      }

      if (depth < maxDepth) {
        for (const nextId of sourceSpecIds(src)) {
          if (!visited.has(nextId)) queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return { links, gaps, visitedSpecIds };
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
      reattached: 0,
      transitions: [],
    };
  }
}
