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

/** Pattern: <!-- id: SOMETHING --> (whitespace tolerant) */
const ID_COMMENT = /<!--\s*id\s*:\s*([^\s-][^\s]*)\s*-->/;

/** Pattern: heading line (# .. ###### ..) */
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/** Pattern: implementation reference inside an `implementations:` block */
const IMPL_REF = /^[-*]\s+([^\s:]+)\s*:\s*([A-Za-z0-9_$.]+)\s*$/;

/** The four recognized domain-fact `type` values (REQ-DOMAIN-001). */
const DOMAIN_TYPES = new Set(['term', 'rule', 'decision', 'constraint']);

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

    const pendingSections: PendingSection[] = [];
    let pendingId: string | null = null;
    let pendingIdLine = -1;

    for (let i = firstContentLine; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      const idMatch = line.match(ID_COMMENT);
      if (idMatch) {
        if (pendingId !== null) {
          // Two consecutive ID comments with no heading between them — the
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
          // A heading without an embedded ID — load-bearing error per v1.
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
        pendingId = null;
        pendingIdLine = -1;
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

    const spec: Spec = {
      id,
      kind: 'domain',
      title,
      body,
      format: 'markdown',
      sourcePath: this.filePath,
      startLine: firstContentLine + 1,
      endLine: lines.length,
      parentId: undefined,
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
