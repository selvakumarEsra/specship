/**
 * Requirement-section parse + re-serialize over a raw spec markdown file
 * (REQ-DESKTOP-011). The save path is a whole-file overwrite, so the editor
 * regenerates ONLY the edited requirement's slice — from its `<!-- id -->`
 * marker to the next non-child marker — and reuses every other line verbatim.
 * Frontmatter, sibling requirements, and their embedded markers are
 * byte-preserved by construction (split('\n') / join('\n') is lossless).
 *
 * The grammar mirrors src/extraction/specs/markdown-spec-extractor.ts:
 * id markers sit alone on a line above their heading/bullet, `## Acceptance`
 * is the id-less container heading, criteria are id-marked bullets whose
 * continuation lines run to the next blank/marker/heading/bullet, and
 * `implementations:` blocks are structural content the editor never touches.
 */

/** `<!-- id: REQ-X -->` alone on its line (whitespace + CR tolerant). */
const MARKER = /^\s*<!--\s*id\s*:\s*([^\s-][^\s]*)\s*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;

/** Strip a trailing CR so matching works on CRLF files without re-splitting. */
const t = (line: string) => line.replace(/\r$/, '');

const markerId = (line: string): string | null => t(line).match(MARKER)?.[1] ?? null;

export interface ParsedCriterion {
  /** The id embedded in the source (e.g. `REQ-X.A2`); '' for an un-id'd bullet. */
  id: string;
  text: string;
}

export interface ParsedSection {
  title: string;
  headingLevel: number;
  /** Statement prose between the heading and the first structural token. */
  statement: string;
  criteria: ParsedCriterion[];
}

/** What the editor persists — everything else the format doesn't carry. */
export interface SectionDraft {
  title: string;
  statement: string;
  criteria: Array<{ text: string }>;
}

interface SectionSpan extends ParsedSection {
  /** Line index of the requirement's own marker. */
  start: number;
  /** Exclusive line index — the next non-child marker, or EOF. */
  end: number;
  headingIdx: number;
  /** Verbatim lines between statement and acceptance (implementations: …). */
  middle: string[];
  /** The original `## Acceptance` heading line, when the section had one. */
  acceptanceHeading: string | null;
}

function locate(lines: string[], reqId: string): SectionSpan | null {
  const start = lines.findIndex((l) => markerId(l) === reqId);
  if (start === -1) return null;

  // The marked heading. A bullet first means this id is an acceptance
  // criterion, not a requirement section — not editable as one.
  let headingIdx = -1;
  let headingLevel = 2;
  let title = '';
  for (let i = start + 1; i < lines.length; i++) {
    const line = t(lines[i]!);
    if (line.trim() === '') continue;
    const h = line.match(HEADING);
    if (h && h[1] && h[2]) { headingIdx = i; headingLevel = h[1].length; title = h[2]; }
    break;
  }
  if (headingIdx === -1) return null;

  // Section end: the next marker that isn't one of this requirement's
  // children (`REQ-X.A1` …). EOF otherwise.
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const id = markerId(lines[i]!);
    if (id && id !== reqId && !id.startsWith(reqId + '.')) { end = i; break; }
  }

  // Structural boundaries inside the body.
  let acceptanceIdx = -1; // `## Acceptance` heading OR the first child marker
  let implIdx = -1;       // `implementations:` line before the acceptance region
  for (let i = headingIdx + 1; i < end; i++) {
    const line = t(lines[i]!);
    const h = line.match(HEADING);
    if ((h && h[2] && h[2].trim().toLowerCase() === 'acceptance') || markerId(lines[i]!)) {
      acceptanceIdx = i;
      break;
    }
    if (implIdx === -1 && line.trim().startsWith('implementations:')) implIdx = i;
  }

  const statementEnd = implIdx !== -1 ? implIdx : acceptanceIdx !== -1 ? acceptanceIdx : end;
  const statement = lines.slice(headingIdx + 1, statementEnd).map(t).join('\n').trim();

  const middleEnd = acceptanceIdx !== -1 ? acceptanceIdx : end;
  const middle = implIdx !== -1 ? lines.slice(implIdx, middleEnd) : [];
  while (middle.length && t(middle[middle.length - 1]!).trim() === '') middle.pop();

  // Criteria: id-marked bullets; continuation lines join with a space,
  // exactly as the extractor stores them.
  const criteria: ParsedCriterion[] = [];
  let acceptanceHeading: string | null = null;
  if (acceptanceIdx !== -1) {
    let pendingId: string | null = null;
    for (let i = acceptanceIdx; i < end; i++) {
      const line = t(lines[i]!);
      const id = markerId(lines[i]!);
      if (id) { pendingId = id; continue; }
      const h = line.match(HEADING);
      if (h && h[2] && h[2].trim().toLowerCase() === 'acceptance') {
        if (acceptanceHeading === null) acceptanceHeading = line;
        continue;
      }
      const b = line.match(BULLET);
      if (b && b[1]) {
        const parts = [b[1].trim()];
        while (i + 1 < end) {
          const cont = t(lines[i + 1]!);
          if (cont.trim() === '' || MARKER.test(cont) || HEADING.test(cont) || BULLET.test(cont)) break;
          parts.push(cont.trim());
          i++;
        }
        criteria.push({ id: pendingId ?? '', text: parts.join(' ').trim() });
        pendingId = null;
      }
    }
  }

  return { start, end, headingIdx, headingLevel, title, statement, middle, acceptanceHeading, criteria };
}

/**
 * Parse one requirement's editable fields out of the raw source file.
 * Returns null when the id has no marker-plus-heading section in the file
 * (missing marker, or the id belongs to an acceptance bullet) — the caller
 * keeps the Edit affordance disabled in that case.
 */
export function parseRequirementSection(source: string, reqId: string): ParsedSection | null {
  const span = locate(source.split('\n'), reqId);
  if (!span) return null;
  const { title, headingLevel, statement, criteria } = span;
  return { title, headingLevel, statement, criteria };
}

/**
 * Save-time normalization (REQ-DESKTOP-011.A4): trim the persisted text
 * fields and drop criteria whose text is empty. Renumbering is positional
 * and happens in the serializer.
 */
export function normalizeSectionDraft(d: SectionDraft): SectionDraft {
  return {
    title: d.title.trim(),
    statement: d.statement.trim(),
    criteria: d.criteria
      .map((c) => ({ text: c.text.trim() }))
      .filter((c) => c.text.length > 0),
  };
}

/**
 * Regenerate the requirement's slice from the (already normalized) draft and
 * splice it into the file. Everything outside [marker, next non-child marker)
 * is reused verbatim; the `implementations:` block inside the section is
 * carried over untouched. Criterion markers renumber contiguously from A1 by
 * position. Returns null when the section can't be located.
 */
// @implements REQ-DESKTOP-011
export function serializeRequirementSection(
  source: string,
  reqId: string,
  draft: SectionDraft,
): string | null {
  const lines = source.split('\n');
  const span = locate(lines, reqId);
  if (!span) return null;

  const section: string[] = [
    lines[span.start]!, // the requirement's own marker line, byte-preserved
    '#'.repeat(span.headingLevel) + ' ' + draft.title,
    '',
  ];
  if (draft.statement) section.push(...draft.statement.split('\n'), '');
  if (span.middle.length) section.push(...span.middle, '');
  if (draft.criteria.length) {
    section.push(span.acceptanceHeading ?? '## Acceptance');
    draft.criteria.forEach((c, i) => {
      section.push(`<!-- id: ${reqId}.A${i + 1} -->`, `- ${c.text}`);
    });
    section.push('');
  }

  return [...lines.slice(0, span.start), ...section, ...lines.slice(span.end)].join('\n');
}
