/**
 * Knowledge proposals store (KNOWLEDGE-DOC, REQ-KNOW-004 A2–A4).
 *
 * Domain knowledge is human-confirmed, never auto-extracted (DOM-SPECSHIP-003):
 * a pipeline may only PROPOSE a fact. Proposals live outside the spec tree, in
 * `.specship/knowledge/proposals/<slug>.md`, and nothing reaches `specs/domain/`
 * until a human runs `apply` on one.
 *
 * ## Proposal file format
 *
 * A proposal is a complete domain-fact file (frontmatter + markdown body),
 * identical to what will land in `specs/domain/`, with two relaxations:
 *
 * ```markdown
 * ---
 * id: DOM-<AREA>-NEW        # optional placeholder; absent is fine too
 * area: SPECSHIP            # optional; which DOM-<AREA>- prefix to number in
 * title: Gemini policy uses [[rule]] tables
 * type: external            # term | rule | decision | constraint | external
 * dependency: @google/gemini-cli
 * version: 0.28.0
 * source: packages/core/src/policy/toml-loader.ts:loadPolicyFromToml
 * depends_on: REQ-GEMINI-009
 * ---
 *
 * # Gemini policy uses [[rule]] tables
 *
 * Prose…
 * ```
 *
 * - The proposal id is its file slug (`<slug>.md` → `<slug>`).
 * - `id` is reassigned on apply to the next free `DOM-<AREA>-NNN` (3-digit),
 *   so it may be absent, a placeholder (`DOM-<AREA>-NEW`, `DOM-FOO-NEW`) or
 *   anything else — it is never trusted as final.
 * - `<AREA>` resolution, first hit wins: the `area:` key; the area of a
 *   `DOM-<AREA>-…` id that names a concrete area; the most common
 *   `DOM-<AREA>-` prefix among existing `specs/domain/**` facts; `DOMAIN`.
 * - `area:` is a proposal-only key and is stripped on apply.
 *
 * Pure over the file system: no database, no host/agent coupling.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSpecShipDir } from '../directory';
import { lintSpecSource, type LintFinding } from '../spec-lint/lint';

/** One pending proposal, as listed. */
export interface KnowledgeProposal {
  /** The proposal id: its file slug (`<slug>.md` → `<slug>`). */
  id: string;
  title: string;
  /** The fact's `type:` frontmatter value, or `''` when absent. */
  type: string;
  /** Absolute path of the proposal file. */
  path: string;
}

/** The result of a successful apply. */
export interface AppliedProposal {
  /** The assigned domain id, e.g. `DOM-SPECSHIP-005`. */
  id: string;
  /** Project-relative path of the written fact, e.g. `specs/domain/foo.md`. */
  path: string;
}

/**
 * Thrown by `applyProposal` when the resulting fact would not pass lint
 * (REQ-KNOW-004.A3). The proposal is left in place; `findings` carries every
 * error finding so the caller can show them.
 */
export class ProposalRefusedError extends Error {
  readonly proposalId: string;
  readonly findings: LintFinding[];
  constructor(proposalId: string, findings: LintFinding[]) {
    super(
      `Proposal "${proposalId}" refused — it would fail lint:\n` +
        findings.map((f) => `  ${f.code}: ${f.message}`).join('\n'),
    );
    this.name = 'ProposalRefusedError';
    this.proposalId = proposalId;
    this.findings = findings;
  }
}

const DEFAULT_AREA = 'DOMAIN';
const PLACEHOLDER_AREA = '<AREA>';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DOMAIN_ID_RE = /^DOM-([A-Z0-9_]+)-(\d+)$/;

/** Absolute path of the proposals directory for a project. */
export function proposalsDir(projectRoot: string): string {
  return path.join(getSpecShipDir(projectRoot), 'knowledge', 'proposals');
}

function domainDir(projectRoot: string): string {
  return path.join(projectRoot, 'specs', 'domain');
}

function assertSlug(proposalId: string): void {
  if (!SLUG_RE.test(proposalId) || proposalId.includes('..')) {
    throw new Error(`Invalid proposal id "${proposalId}"`);
  }
}

function proposalPath(projectRoot: string, proposalId: string): string {
  assertSlug(proposalId);
  const p = path.join(proposalsDir(projectRoot), `${proposalId}.md`);
  if (!fs.existsSync(p)) throw new Error(`No pending proposal "${proposalId}"`);
  return p;
}

// ---------------------------------------------------------------------------
// Frontmatter (line-based, matching the extractor's flat `key: value` reading)
// ---------------------------------------------------------------------------

interface SplitFile {
  /** Raw frontmatter lines between the `---` fences (empty when none). */
  fm: string[];
  /** Everything after the closing fence (or the whole file with no frontmatter). */
  body: string;
  hasFrontmatter: boolean;
}

function splitFrontmatter(source: string): SplitFile {
  const lines = source.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return { fm: [], body: source, hasFrontmatter: false };
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') {
      return { fm: lines.slice(1, i), body: lines.slice(i + 1).join('\n'), hasFrontmatter: true };
    }
  }
  return { fm: [], body: source, hasFrontmatter: false };
}

function fmValue(fm: string[], key: string): string | undefined {
  for (const raw of fm) {
    const line = raw.trim();
    const idx = line.indexOf(':');
    if (idx <= 0 || line.slice(0, idx).trim() !== key) continue;
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
}

function isKey(raw: string, key: string): boolean {
  const line = raw.trim();
  const idx = line.indexOf(':');
  return idx > 0 && line.slice(0, idx).trim() === key;
}

function firstHeading(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (m && m[1]) return m[1];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Existing domain ids
// ---------------------------------------------------------------------------

function walkMarkdown(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

/** Every `id:` declared by a fact under `specs/domain/**`. */
function existingDomainIds(projectRoot: string): string[] {
  const files: string[] = [];
  walkMarkdown(domainDir(projectRoot), files);
  const ids: string[] = [];
  for (const f of files) {
    const id = fmValue(splitFrontmatter(fs.readFileSync(f, 'utf-8')).fm, 'id');
    if (id) ids.push(id);
  }
  return ids;
}

/** The most common `DOM-<AREA>-` prefix among existing facts, if any. */
function dominantArea(ids: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const m = id.match(DOMAIN_ID_RE);
    if (m && m[1]) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [area, n] of counts) {
    if (n > bestN || (n === bestN && best !== undefined && area < best)) {
      best = area;
      bestN = n;
    }
  }
  return best;
}

function resolveArea(fm: string[], ids: string[]): string {
  const explicit = fmValue(fm, 'area');
  if (explicit && /^[A-Za-z0-9_]+$/.test(explicit)) return explicit.toUpperCase();
  const id = fmValue(fm, 'id');
  const m = id?.match(/^DOM-([^-]+)-/);
  if (m && m[1] && m[1] !== PLACEHOLDER_AREA && /^[A-Za-z0-9_]+$/.test(m[1])) {
    return m[1].toUpperCase();
  }
  return dominantArea(ids) ?? DEFAULT_AREA;
}

/** The next free `DOM-<AREA>-NNN` (3-digit, max+1 within the area). */
export function nextDomainId(area: string, existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = id.match(DOMAIN_ID_RE);
    if (m && m[1] === area && m[2]) max = Math.max(max, parseInt(m[2], 10));
  }
  return `DOM-${area}-${String(max + 1).padStart(3, '0')}`;
}

/** Rewrite the proposal's frontmatter: set the real id, strip `area:`. */
function materialize(source: string, id: string): string {
  const split = splitFrontmatter(source);
  const fm = split.fm.filter((l) => !isKey(l, 'id') && !isKey(l, 'area'));
  const body = split.hasFrontmatter ? split.body : source;
  return ['---', `id: ${id}`, ...fm, '---', body].join('\n');
}

/**
 * Provenance check for `type: external` facts (REQ-KNOW-001.A2). The spec
 * linter carries this rule; it is mirrored here so `apply` refuses an
 * external fact without provenance even against a linter that predates it.
 * Returns the missing field alongside each finding so `applyProposal` can
 * skip fields the linter already reported.
 */
function externalProvenanceFindings(
  filePath: string,
  source: string,
): Array<{ field: string; finding: LintFinding }> {
  const fm = splitFrontmatter(source).fm;
  if (fmValue(fm, 'type') !== 'external') return [];
  const out: Array<{ field: string; finding: LintFinding }> = [];
  for (const field of ['dependency', 'version', 'source']) {
    if (!fmValue(fm, field)) {
      out.push({
        field,
        finding: {
          code: 'knowledge_external_missing_provenance',
          severity: 'error',
          filePath,
          line: 1,
          message: `External fact is missing required field "${field}"`,
        },
      });
    }
  }
  return out;
}

function uniqueTarget(projectRoot: string, slug: string): string {
  const dir = domainDir(projectRoot);
  let candidate = `${slug}.md`;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${slug}-${n}.md`;
  return candidate;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List every pending proposal, sorted by id. */
export function listProposals(projectRoot: string): KnowledgeProposal[] {
  const dir = proposalsDir(projectRoot);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  const out: KnowledgeProposal[] = [];
  for (const name of names.sort()) {
    const id = name.slice(0, -3);
    if (!SLUG_RE.test(id)) continue;
    const p = path.join(dir, name);
    const split = splitFrontmatter(fs.readFileSync(p, 'utf-8'));
    out.push({
      id,
      title: fmValue(split.fm, 'title') || firstHeading(split.body) || id,
      type: fmValue(split.fm, 'type') ?? '',
      path: p,
    });
  }
  return out;
}

/**
 * Apply a confirmed proposal (REQ-KNOW-004.A2/A3): assign the next free
 * `DOM-<AREA>-NNN`, lint the result under its target path, write it to
 * `specs/domain/<slug>.md` (never overwriting — `<slug>-2.md`, …) and delete
 * the proposal. Throws `ProposalRefusedError` — leaving the proposal in place
 * and writing nothing — when lint reports any error.
 */
export function applyProposal(projectRoot: string, proposalId: string): AppliedProposal {
  const src = proposalPath(projectRoot, proposalId);
  const source = fs.readFileSync(src, 'utf-8');
  const ids = existingDomainIds(projectRoot);
  const area = resolveArea(splitFrontmatter(source).fm, ids);
  const id = nextDomainId(area, ids);
  const content = materialize(source, id);

  const fileName = uniqueTarget(projectRoot, proposalId);
  const relPath = `specs/domain/${fileName}`;

  const lintErrors = lintSpecSource(relPath, content).filter((f) => f.severity === 'error');
  // Keep a mirrored provenance finding only when the linter did not already
  // report that field, so a linter carrying the rule yields no duplicates.
  const errors = [
    ...lintErrors,
    ...externalProvenanceFindings(relPath, content)
      .filter(({ field }) => !lintErrors.some((e) => e.message.includes(field)))
      .map(({ finding }) => finding),
  ];
  if (errors.length > 0) throw new ProposalRefusedError(proposalId, errors);

  fs.mkdirSync(domainDir(projectRoot), { recursive: true });
  // `wx` — fail rather than overwrite should a file appear in the meantime.
  fs.writeFileSync(path.join(projectRoot, relPath), content, { encoding: 'utf-8', flag: 'wx' });
  fs.unlinkSync(src);
  return { id, path: relPath };
}

/** Reject a proposal (REQ-KNOW-004.A4): delete it; nothing touches `specs/domain/`. */
export function rejectProposal(projectRoot: string, proposalId: string): void {
  fs.unlinkSync(proposalPath(projectRoot, proposalId));
}

/** Human-readable proposal listing for the CLI. */
export function formatProposalList(proposals: KnowledgeProposal[]): string {
  if (proposals.length === 0) return 'No pending knowledge proposals.';
  const idW = Math.max(2, ...proposals.map((p) => p.id.length));
  const typeW = Math.max(4, ...proposals.map((p) => p.type.length));
  const lines = [
    `${proposals.length} pending knowledge proposal${proposals.length === 1 ? '' : 's'}:`,
    '',
    `  ${'ID'.padEnd(idW)}  ${'TYPE'.padEnd(typeW)}  TITLE`,
    ...proposals.map((p) => `  ${p.id.padEnd(idW)}  ${(p.type || '-').padEnd(typeW)}  ${p.title}`),
    '',
    'Apply with `specship knowledge apply <id>`, or reject with `specship knowledge reject <id>`.',
  ];
  return lines.join('\n');
}
