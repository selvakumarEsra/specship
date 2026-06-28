/**
 * Markdown Spec Extractor
 *
 * Parses Markdown spec files where each addressable section carries an
 * embedded ID via `<!-- id: REQ-X -->` immediately above its heading.
 * Per locked v1 design: **embedded IDs are mandatory**. A heading without
 * an embedded ID produces an `error`-severity ExtractionError so the spec
 * author fixes the file; no path-derived fallback.
 *
 * Spec format:
 *   ---
 *   format: markdown
 *   owner: security
 *   ---
 *   <!-- id: REQ-AUTH-005 -->
 *   # Failed login attempts must be rate-limited
 *
 *   The login endpoint rejects more than 5 failed attempts per IP per minute.
 *
 *   implementations:
 *     - src/auth/login.ts:authenticate
 *     - src/auth/rate-limit.ts:enforce
 *
 *   ## Acceptance
 *   <!-- id: REQ-AUTH-005.A1 -->
 *   - A 6th failed attempt within 60s from the same IP returns 429.
 *
 * Hierarchy is heading depth: a deeper heading becomes a child of the most
 * recent enclosing heading. The document spec (kind='document') has no
 * parent and gets ID from the first H1 with an embedded ID — OR a
 * document-level `id:` field in the frontmatter.
 */

import { createHash } from 'crypto';
import { ExtractionError, Spec, NodeKind, SpecLinkKind } from '../../types';
import { SpecExtractionResult, SpecLinkCandidate } from './types';

/**
 * Pattern: <!-- id: SOMETHING --> (whitespace tolerant). Anchored to its own
 * line so a literal `<!-- id: … -->` written *inside* a bullet's prose (e.g. a
 * spec that documents the marker syntax) is not mistaken for a real marker —
 * real markers always sit alone on a line above their heading/bullet.
 */
const ID_COMMENT = /^\s*<!--\s*id\s*:\s*([^\s-][^\s]*)\s*-->\s*$/;

/** Pattern: heading line (# .. ###### ..) */
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/** Pattern: implementation reference inside an `implementations:` block */
const IMPL_REF = /^[-*]\s+([^\s:]+)\s*:\s*([A-Za-z0-9_$.]+)\s*$/;

/** Pattern: a Markdown list bullet (`- foo` / `* foo`, indentation tolerant). */
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;

/** The four recognized domain-fact `type` values (REQ-DOMAIN-001). */
const DOMAIN_TYPES = new Set(['term', 'rule', 'decision', 'constraint']);

/**
 * Derive an acceptance criterion's parent requirement from its id suffix
 * (REQ-ACCEPTANCE-001.A2). The convention is `<REQ-ID>.A<N>` — `REQ-AUTH-001.A2`
 * is owned by `REQ-AUTH-001`. Returns the parent id, or null when the id carries
 * no `.A<N>` suffix (the caller then falls back to the enclosing requirement —
 * REQ-ACCEPTANCE-001.A4).
 */
export function parseAcceptanceParentId(id: string): string | null {
  const m = id.match(/^(.+)\.A\d+$/i);
  return m && m[1] ? m[1] : null;
}

/**
 * True when a heading is the canonical acceptance container — `## Acceptance`
 * (case-insensitive), title-only, no id (REQ-ACCEPTANCE-002.A1). A container
 * yields no spec node and, crucially, is exempt from the `spec_missing_id` error
 * that every other id-less heading still raises (REQ-ACCEPTANCE-002.A2).
 */
export function isAcceptanceContainerHeading(title: string): boolean {
  return title.trim().toLowerCase() === 'acceptance';
}

/**
 * Heuristic: guess the target node kind from a qualified name. Used only
 * for the `target_node_kind` hint on SpecLinkCandidate — the resolver
 * matches loosely on (file_path, qualified_name).
 */
function guessNodeKind(qualifiedName: string): NodeKind {
  if (/[A-Z]/.test(qualifiedName[0] ?? '')) return 'class';
  if (qualifiedName.includes('.')) return 'method';
  return 'function';
}

export class MarkdownSpecExtractor {
  private filePath: string;
  private source: string;

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): SpecExtractionResult {
    const start = Date.now();

    // Brainstorm briefs (`specs/<slug>/brief.md`) take a wholly separate path:
    // they have no `<!-- id: -->`-marked headings, so the requirement parser
    // would only emit `spec_missing_id` errors. Handling them here keeps the
    // document/requirement/acceptance extraction below completely unchanged
    // (REQ-FUNNEL-001.A5).
    if (this.isBriefFile()) {
      return this.extractBrief(start);
    }

    // Domain facts (`specs/domain/*.md`) likewise take a separate path: they are
    // frontmatter-keyed (`id: DOM-<AREA>-NNN`, `type: …`) with freeform prose and
    // no `<!-- id: -->`-marked headings, so the requirement walker below would only
    // emit `spec_missing_id`. Routing them here keeps that walker untouched, which
    // REQ-DOMAIN-001.A1 requires (parse without `spec_missing_id`).
    if (this.isDomainFile()) {
      return this.extractDomain(start);
    }

    const specs: Spec[] = [];
    const linkCandidates: SpecLinkCandidate[] = [];
    const errors: ExtractionError[] = [];

    const lines = this.source.split(/\r?\n/);
    const now = Date.now();

    // 1. Frontmatter (optional)
    const { frontmatter, firstContentLine } = this.parseFrontmatter(lines, errors);

    // 2. Walk lines: collect headings with their embedded IDs.
    //    Each section's body is everything between its heading and the next
    //    heading at the same-or-shallower level.
    interface PendingSection {
      id: string;
      level: number;          // 1..6 for h1..h6, 0 for document
      title: string;
      startLine: number;      // 1-indexed
      headingLineIdx: number; // 0-indexed into `lines`
    }

    // An acceptance criterion authored as an id-marked bullet (the documented
    // convention) rather than a heading (REQ-ACCEPTANCE-001).
    interface AcceptanceBullet {
      id: string;
      text: string;               // bullet text incl. continuation lines
      startLine: number;          // 1-indexed
      endLine: number;            // 1-indexed (last continuation line)
      enclosingRequirementId: string | null; // nearest preceding heading section
    }

    const pendingSections: PendingSection[] = [];
    const acceptanceBullets: AcceptanceBullet[] = [];
    let pendingId: string | null = null;
    let pendingIdLine = -1;
    // The most recent heading section pushed — an acceptance bullet's enclosing
    // requirement, used for the no-suffix fallback + the mismatch check.
    let lastSectionId: string | null = null;

    for (let i = firstContentLine; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      const idMatch = line.match(ID_COMMENT);
      if (idMatch) {
        if (pendingId !== null) {
          // Two consecutive ID comments with no heading/bullet between them — the
          // earlier one is stranded. Surface it but don't fail extraction.
          errors.push({
            message: `Stranded <!-- id: ${pendingId} --> on line ${pendingIdLine + 1} (no heading followed)`,
            filePath: this.filePath,
            line: pendingIdLine + 1,
            severity: 'warning',
            code: 'spec_stranded_id',
          });
        }
        pendingId = idMatch[1] ?? null;
        pendingIdLine = i;
        continue;
      }

      const headingMatch = line.match(HEADING);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        const level = headingMatch[1].length;
        const title = headingMatch[2];

        if (pendingId === null) {
          // `## Acceptance` with no id is the canonical container — exempt from
          // the missing-id error, and emits no node (REQ-ACCEPTANCE-002.A1).
          if (isAcceptanceContainerHeading(title)) continue;
          // Any other heading without an embedded ID — load-bearing error per v1
          // (REQ-ACCEPTANCE-002.A2).
          errors.push({
            message: `Heading "${title}" lacks an embedded ID. Add <!-- id: REQ-X --> immediately above it.`,
            filePath: this.filePath,
            line: i + 1,
            severity: 'error',
            code: 'spec_missing_id',
          });
          continue;
        }

        pendingSections.push({
          id: pendingId,
          level,
          title,
          startLine: i + 1, // 1-indexed
          headingLineIdx: i,
        });
        lastSectionId = pendingId;
        pendingId = null;
        pendingIdLine = -1;
        continue;
      }

      // An id-marked BULLET is an acceptance criterion (REQ-ACCEPTANCE-001.A1):
      // it consumes the pending id (so it no longer strands — A3) and becomes an
      // `acceptance` node. Its body spans continuation lines up to the next id
      // marker, heading, bullet, or blank line.
      if (pendingId !== null) {
        const bulletMatch = line.match(BULLET);
        if (bulletMatch && bulletMatch[1]) {
          const parts = [bulletMatch[1].trim()];
          let endIdx = i;
          for (let j = i + 1; j < lines.length; j++) {
            const cont = lines[j];
            if (cont === undefined || cont.trim() === '') break;
            if (ID_COMMENT.test(cont) || HEADING.test(cont) || BULLET.test(cont)) break;
            parts.push(cont.trim());
            endIdx = j;
          }
          acceptanceBullets.push({
            id: pendingId,
            text: parts.join(' ').trim(),
            startLine: i + 1,
            endLine: endIdx + 1,
            enclosingRequirementId: lastSectionId,
          });
          pendingId = null;
          pendingIdLine = -1;
          i = endIdx; // skip consumed continuation lines
          continue;
        }
      }
    }

    // 3. Determine the document node (kind='document', no parent).
    //
    // The document's id comes from the frontmatter `id:`, or — when frontmatter
    // omits it — from the first top-level (H1) section carrying an embedded id.
    // When an H1 carries the document id (the canonical frontmatter-id + same-id
    // H1 pattern), that H1 IS the document: it MUST NOT also be emitted as a
    // requirement. A prior version did, with `parentId = docId` (self-parented),
    // and `INSERT OR REPLACE` then clobbered the real document row — leaving every
    // document mis-typed as a self-parented requirement (REQ-PROJECTION-001).
    const frontmatterId =
      typeof frontmatter.id === 'string' && frontmatter.id.length > 0
        ? frontmatter.id
        : undefined;

    // The H1 that represents the document, if any:
    //  - frontmatter id present → the first H1 whose id equals it (same-id pattern);
    //  - frontmatter id absent  → the first H1 with an id (it becomes the document,
    //    per REQ-PROJECTION-002).
    const docSectionIdx = pendingSections.findIndex(
      (s) => s.level === 1 && (frontmatterId === undefined || s.id === frontmatterId)
    );
    const documentSection =
      docSectionIdx >= 0 ? pendingSections[docSectionIdx] : undefined;

    const docId = frontmatterId ?? documentSection?.id;

    if (docId !== undefined) {
      // Body + line range of the document.
      let docStartLine: number;
      let docBodyStart: number;
      let docBodyEnd: number;
      if (documentSection !== undefined) {
        // The H1 IS the document: its body is the intro prose between the H1 and
        // the first following section (the first requirement) — NOT the H1's full
        // heading-nesting body, which would swallow every requirement beneath it.
        const nextAfterDoc = pendingSections[docSectionIdx + 1];
        docStartLine = documentSection.startLine;
        docBodyStart = documentSection.headingLineIdx + 1;
        docBodyEnd =
          nextAfterDoc !== undefined ? nextAfterDoc.headingLineIdx : lines.length;
      } else {
        // Frontmatter id but no matching H1 (requirements start at H2, or the only
        // H1 carries a different id): the document body is the content before the
        // first heading, as before.
        const firstSection = pendingSections[0];
        docStartLine = firstContentLine + 1;
        docBodyStart = firstContentLine;
        docBodyEnd =
          firstSection !== undefined ? firstSection.headingLineIdx : lines.length;
      }
      const docBody = lines.slice(docBodyStart, docBodyEnd).join('\n').trim();
      const docTitle =
        typeof frontmatter.title === 'string' && frontmatter.title.length > 0
          ? frontmatter.title
          : documentSection?.title ?? this.filePath;
      specs.push({
        id: docId,
        kind: 'document',
        title: docTitle,
        body: docBody,
        format: 'markdown',
        sourcePath: this.filePath,
        startLine: docStartLine,
        endLine: docBodyEnd,
        parentId: undefined,
        contentHash: hash(docBody),
        version: typeof frontmatter.version === 'number' ? frontmatter.version : 1,
        owner: typeof frontmatter.owner === 'string' ? frontmatter.owner : undefined,
        priority: typeof frontmatter.priority === 'string' ? frontmatter.priority : undefined,
        metadata:
          frontmatter.metadata && typeof frontmatter.metadata === 'object'
            ? (frontmatter.metadata as Record<string, unknown>)
            : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    // For each section: determine its body range + parent.
    // Body: from line after the heading to the line before the next heading
    //       at the same-or-shallower level.
    // Parent: the most recent earlier section with a SHALLOWER level (or
    //         the document if none).
    for (let s = 0; s < pendingSections.length; s++) {
      const section = pendingSections[s];
      if (section === undefined) continue;
      // The H1 that IS the document was already emitted above (kind='document').
      // Skip it here so it isn't also written as a self-parented requirement.
      if (section === documentSection) continue;

      // Find body end: next section at level <= section.level, else EOF.
      let bodyEndLine = lines.length;
      for (let t = s + 1; t < pendingSections.length; t++) {
        const next = pendingSections[t];
        if (next !== undefined && next.level <= section.level) {
          bodyEndLine = next.headingLineIdx;
          break;
        }
      }

      // The body excludes the heading line itself.
      const bodyLines = lines.slice(section.headingLineIdx + 1, bodyEndLine);
      const body = bodyLines.join('\n').trim();

      // Find parent: nearest earlier section with shallower level.
      let parentId: string | undefined = docId;
      for (let p = s - 1; p >= 0; p--) {
        const earlier = pendingSections[p];
        if (earlier !== undefined && earlier.level < section.level) {
          parentId = earlier.id;
          break;
        }
      }

      // Classify kind by content / title — `## Acceptance` is the canonical
      // acceptance container; bullet lists under it are individual criteria.
      // For v1 we keep it simple: H1/H2 = 'requirement', deeper = 'acceptance'.
      const kind = section.level >= 3 ? 'acceptance' : 'requirement';

      specs.push({
        id: section.id,
        kind,
        title: section.title,
        body,
        format: 'markdown',
        sourcePath: this.filePath,
        startLine: section.startLine,
        endLine: bodyEndLine,
        parentId,
        contentHash: hash(body),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      // Scan the body for `implementations:` blocks — bullet-list refs.
      const candidates = this.extractImplementationRefs(section.id, bodyLines);
      linkCandidates.push(...candidates);
    }

    // Acceptance criteria authored as id-marked bullets → `acceptance` nodes
    // (REQ-ACCEPTANCE-001). Parent from the id suffix, falling back to the
    // enclosing requirement when there's no `.A<N>` suffix (A2 / A4).
    for (const ab of acceptanceBullets) {
      const suffixParent = parseAcceptanceParentId(ab.id);
      const parentId = suffixParent ?? ab.enclosingRequirementId ?? docId;

      // The id names one requirement but the bullet sits under another — parent
      // per the id, but flag the misplacement (REQ-ACCEPTANCE-003.A4).
      if (
        suffixParent &&
        ab.enclosingRequirementId &&
        suffixParent !== ab.enclosingRequirementId
      ) {
        errors.push({
          message: `Acceptance criterion ${ab.id} is placed under ${ab.enclosingRequirementId} but its id names ${suffixParent} as its parent`,
          filePath: this.filePath,
          line: ab.startLine,
          severity: 'warning',
          code: 'spec_acceptance_parent_mismatch',
        });
      }

      const title = ab.text.length > 120 ? `${ab.text.slice(0, 117)}…` : ab.text;
      specs.push({
        id: ab.id,
        kind: 'acceptance',
        title,
        body: ab.text,
        format: 'markdown',
        sourcePath: this.filePath,
        startLine: ab.startLine,
        endLine: ab.endLine,
        parentId,
        contentHash: hash(ab.text),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      specs,
      linkCandidates,
      errors,
      format: 'markdown',
      durationMs: Date.now() - start,
    };
  }

  /** True when this file is a brainstorm brief (`.../brief.md`). */
  private isBriefFile(): boolean {
    const base = this.filePath.split(/[/\\]/).pop() ?? '';
    return base.toLowerCase() === 'brief.md';
  }

  /** True when this file lives under a `specs/domain/` directory. */
  private isDomainFile(): boolean {
    return this.filePath.replace(/\\/g, '/').includes('specs/domain/');
  }

  /**
   * Extract a domain fact (`specs/domain/*.md`) as a single `domain`-kind spec.
   *
   * A domain fact carries `id` / `title` / `type` frontmatter and freeform prose
   * (no `<!-- id: -->`-marked headings). It becomes one spec entity:
   *   - id      the frontmatter `id` (the `DOM-<AREA>-NNN` value)
   *   - kind    'domain'
   *   - title   the frontmatter `title`, else the first `# ` heading, else the id
   *   - body    the full post-frontmatter prose (so it is full-text searchable)
   *   - metadata the frontmatter metadata, which carries `type`
   *
   * The `type` (term / rule / decision / constraint) lives in `metadata` — no new
   * column. An unknown `type` value emits a `warning` (`spec_unknown_domain_type`)
   * but the fact is still indexed, never dropped (REQ-DOMAIN-001.A3).
   *
   * A domain file with no `id` in its frontmatter isn't addressable, so it is
   * skipped gracefully — no spec, no fatal error — matching the brief path.
   */
  private extractDomain(start: number): SpecExtractionResult {
    const errors: ExtractionError[] = [];
    const lines = this.source.split(/\r?\n/);
    const now = Date.now();

    const { frontmatter, firstContentLine } = this.parseFrontmatter(lines, errors);
    const id =
      typeof frontmatter.id === 'string' && frontmatter.id.trim().length > 0
        ? frontmatter.id.trim()
        : undefined;

    if (id === undefined) {
      // Not an addressable domain fact — skip without erroring.
      return {
        specs: [],
        linkCandidates: [],
        errors,
        format: 'markdown',
        durationMs: Date.now() - start,
      };
    }

    const meta =
      frontmatter.metadata && typeof frontmatter.metadata === 'object'
        ? (frontmatter.metadata as Record<string, unknown>)
        : {};

    // Type validation: present but unrecognized → warn, but still emit the fact.
    const type = meta.type;
    if (typeof type === 'string' && !DOMAIN_TYPES.has(type)) {
      errors.push({
        message: `Domain fact "${id}" has unknown type "${type}" (expected one of: term, rule, decision, constraint)`,
        filePath: this.filePath,
        line: 1,
        severity: 'warning',
        code: 'spec_unknown_domain_type',
      });
    }

    // Title: frontmatter `title`, else the first heading, else the id.
    let title =
      typeof frontmatter.title === 'string' && frontmatter.title.length > 0
        ? frontmatter.title
        : id;
    if (title === id) {
      for (let i = firstContentLine; i < lines.length; i++) {
        const h = (lines[i] ?? '').match(HEADING);
        if (h && h[2]) {
          title = h[2];
          break;
        }
      }
    }

    const body = lines.slice(firstContentLine).join('\n').trim();

    // Spec-tier linking (REQ-DOMAIN-002): a domain fact attaches to requirement
    // specs via `parent_id` (single) and/or `depends_on` (one or many). Code
    // association + drift are inherited transitively through those specs'
    // `implements` links — there is NO direct domain→code row. Missing/unknown
    // referenced specs stay silent here (no link candidate emitted); the fact
    // still indexes (A3) and the dangling id surfaces later as a gap.
    const parentId =
      typeof meta.parent_id === 'string' && meta.parent_id.trim().length > 0
        ? meta.parent_id.trim()
        : undefined;
    if (parentId !== undefined) delete meta.parent_id; // promoted to spec.parentId
    const dependsOn = normalizeSpecIdList(meta.depends_on);
    if (dependsOn.length > 0) meta.depends_on = dependsOn;
    else delete meta.depends_on;

    const spec: Spec = {
      id,
      kind: 'domain',
      title,
      body,
      format: 'markdown',
      sourcePath: this.filePath,
      startLine: firstContentLine + 1,
      endLine: lines.length,
      parentId,
      contentHash: hash(body),
      version: typeof frontmatter.version === 'number' ? frontmatter.version : 1,
      owner: typeof frontmatter.owner === 'string' ? frontmatter.owner : undefined,
      priority: typeof frontmatter.priority === 'string' ? frontmatter.priority : undefined,
      metadata: meta,
      createdAt: now,
      updatedAt: now,
    };

    return {
      specs: [spec],
      linkCandidates: [],
      errors,
      format: 'markdown',
      durationMs: Date.now() - start,
    };
  }

  /**
   * Extract a brainstorm brief as a single `brief`-kind spec.
   *
   * A brief carries `slug` / `spec` / `created` frontmatter and freeform prose
   * (no `<!-- id: -->`-marked headings). It becomes one spec entity:
   *   - id      `brief:<slug>` (stable, derived from the brief's slug)
   *   - kind    'brief'
   *   - title   the first heading (`# Brainstorm: <feature>`), else the slug
   *   - body    the full brief prose (so it is full-text searchable, A2)
   *   - metadata the frontmatter (slug / spec / created) — `spec` is what
   *             REQ-FUNNEL-002 reconciles the brief → spec link against.
   *
   * A brief with no `slug` in its frontmatter isn't addressable, so it is
   * skipped gracefully — no spec, no fatal error — and the rest of the index
   * proceeds (REQ-FUNNEL-001.A4).
   */
  private extractBrief(start: number): SpecExtractionResult {
    const errors: ExtractionError[] = [];
    const lines = this.source.split(/\r?\n/);
    const now = Date.now();

    const { frontmatter, firstContentLine } = this.parseFrontmatter(lines, errors);
    const meta =
      frontmatter.metadata && typeof frontmatter.metadata === 'object'
        ? (frontmatter.metadata as Record<string, unknown>)
        : {};
    const slug =
      typeof meta.slug === 'string' && meta.slug.trim().length > 0
        ? meta.slug.trim()
        : undefined;

    if (slug === undefined) {
      // Not an addressable brief — skip without erroring.
      return {
        specs: [],
        linkCandidates: [],
        errors,
        format: 'markdown',
        durationMs: Date.now() - start,
      };
    }

    // Title: the first heading line (the `# Brainstorm: …` H1), else the slug.
    let title = slug;
    for (let i = firstContentLine; i < lines.length; i++) {
      const h = (lines[i] ?? '').match(HEADING);
      if (h && h[2]) {
        title = h[2];
        break;
      }
    }

    const body = lines.slice(firstContentLine).join('\n').trim();

    const spec: Spec = {
      id: `brief:${slug}`,
      kind: 'brief',
      title,
      body,
      format: 'markdown',
      sourcePath: this.filePath,
      startLine: firstContentLine + 1,
      endLine: lines.length,
      parentId: undefined,
      contentHash: hash(body),
      version: 1,
      metadata: meta,
      createdAt: now,
      updatedAt: now,
    };

    return {
      specs: [spec],
      linkCandidates: [],
      errors,
      format: 'markdown',
      durationMs: Date.now() - start,
    };
  }

  /**
   * Parse YAML-ish frontmatter. We only extract a handful of known keys
   * (`id`, `title`, `owner`, `priority`, `version`); arbitrary structure
   * goes into `metadata`. Keeps the v1 extractor dependency-free — full
   * YAML can come later when YAML/Gherkin extractors land.
   */
  private parseFrontmatter(
    lines: string[],
    errors: ExtractionError[]
  ): { frontmatter: Record<string, unknown>; firstContentLine: number } {
    const frontmatter: Record<string, unknown> = {};

    if (lines.length === 0 || (lines[0] ?? '').trim() !== '---') {
      return { frontmatter, firstContentLine: 0 };
    }

    let closingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if ((lines[i] ?? '').trim() === '---') {
        closingIdx = i;
        break;
      }
    }
    if (closingIdx === -1) {
      errors.push({
        message: 'Unterminated frontmatter block (missing closing ---)',
        filePath: this.filePath,
        line: 1,
        severity: 'warning',
        code: 'spec_unterminated_frontmatter',
      });
      return { frontmatter, firstContentLine: 0 };
    }

    // Simple `key: value` parser. Known keys are extracted; rest goes to
    // metadata.
    const knownKeys = new Set(['id', 'title', 'owner', 'priority', 'version']);
    const metadata: Record<string, unknown> = {};
    for (let i = 1; i < closingIdx; i++) {
      const line = (lines[i] ?? '').trim();
      if (!line || line.startsWith('#')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const key = line.slice(0, colonIdx).trim();
      let value: unknown = line.slice(colonIdx + 1).trim();
      // Strip surrounding quotes
      if (typeof value === 'string') {
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
      }
      if (knownKeys.has(key)) {
        frontmatter[key] = value;
      } else {
        metadata[key] = value;
      }
    }
    if (Object.keys(metadata).length > 0) {
      frontmatter.metadata = metadata;
    }
    return { frontmatter, firstContentLine: closingIdx + 1 };
  }

  /**
   * Scan a body block for a bullet-list `implementations:` declaration.
   * Format:
   *
   *   implementations:
   *     - src/auth/login.ts:authenticate
   *     - src/auth/rate-limit.ts:enforce
   *
   * Each match becomes a SpecLinkCandidate with kind='implements'.
   * Tolerant of indentation; stops at the first non-bullet, non-blank line.
   */
  private extractImplementationRefs(
    specId: string,
    bodyLines: string[]
  ): SpecLinkCandidate[] {
    const out: SpecLinkCandidate[] = [];

    for (let i = 0; i < bodyLines.length; i++) {
      const line = (bodyLines[i] ?? '').trim();
      if (line !== 'implementations:' && !line.startsWith('implementations:')) continue;

      // Walk subsequent lines collecting `- path:symbol` entries.
      for (let j = i + 1; j < bodyLines.length; j++) {
        const subline = (bodyLines[j] ?? '').trim();
        if (subline === '') continue;
        const m = subline.match(IMPL_REF);
        if (!m) break;
        const refPath = m[1];
        const refSymbol = m[2];
        if (!refPath || !refSymbol) continue;
        out.push({
          specId,
          targetFilePath: refPath,
          targetQualifiedName: refSymbol,
          targetNodeKind: guessNodeKind(refSymbol),
          kind: 'implements' as SpecLinkKind,
        });
      }
      // Stop after first `implementations:` block — no need to find more.
      break;
    }
    return out;
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').substring(0, 32);
}

/**
 * Normalize a `depends_on` frontmatter value into a list of spec ids.
 *
 * The dependency-free frontmatter parser yields strings, so we accept both a
 * single id and a comma-separated / inline-`[a, b]` list; an already-array
 * value (future YAML extractor) is taken as-is. Empty entries are dropped and
 * the result is deduped.
 */
function normalizeSpecIdList(value: unknown): string[] {
  let parts: string[];
  if (Array.isArray(value)) {
    parts = value.filter((v): v is string => typeof v === 'string');
  } else if (typeof value === 'string') {
    parts = value
      .replace(/^\[|\]$/g, '') // tolerate inline `[a, b]`
      .split(',');
  } else {
    return [];
  }
  const out = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return [...new Set(out)];
}
