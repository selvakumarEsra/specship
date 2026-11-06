/**
 * Deterministic spec linter (AUTHG-DOC, REQ-AUTHG-001).
 *
 * Every structural check in the spec-author review checklist used to be an LLM
 * eyeballing the draft. This module performs them mechanically: it reuses
 * `MarkdownSpecExtractor`'s own errors (so the lint and the indexer agree about
 * what a spec file means) and adds the checks the extractor has no reason to
 * make — duplicate ids, orphaned `.A<N>` parents, requirements with no
 * acceptance criteria, unresolved `[needs review]` markers, plus a set of
 * advisory quality warnings.
 *
 * Pure over the file system at the edges only: `lintSpecSource` is a pure
 * function of (path, source), which is what the tests drive. Nothing here
 * writes, and nothing here needs a database — a lint must be runnable on a
 * spec file that has never been indexed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MarkdownSpecExtractor, parseAcceptanceParentId } from '../extraction/specs/markdown-spec-extractor';
import { Spec } from '../types';
import { parseDeclaredEvidenceKind, EVIDENCE_KINDS } from '../spec-quality/evidence-kind';
import { parseEnforcedRules } from '../knowledge/enforce';
import { checkVersionClaims, findVersionClaimInSource, formatVersionClaim } from './version-claims';
import type { VersionInUseResolver } from './version-claims';
import { findRequirementCommits, linkSuggestionFindings } from './commit-suggestions';
import type { RequirementCommitResolver } from './commit-suggestions';

/**
 * `suggestion` is advisory (REQ-LINKACC-010): counted in neither errorCount
 * nor warningCount, so it never changes `hasErrors` or the exit code.
 */
export type LintSeverity = 'error' | 'warning' | 'suggestion';

/**
 * Stable finding codes. Extractor-produced findings keep the extractor's own
 * code (`spec_missing_id`, `spec_stranded_id`, `spec_bare_path_ref`,
 * `spec_acceptance_parent_mismatch`) so one vocabulary spans both layers.
 */
export type LintCode =
  // errors
  | 'spec_duplicate_id'
  | 'spec_duplicate_id_cross_file'
  | 'spec_orphan_acceptance_parent'
  | 'spec_requirement_without_acceptance'
  | 'spec_needs_review_marker'
  | 'spec_unknown_evidence_kind'
  | 'spec_external_fact_missing_provenance'
  | 'spec_malformed_enforced_rule'
  | 'spec_version_claim_malformed'
  // warnings
  | 'spec_no_negative_case'
  | 'spec_missing_non_goals'
  | 'spec_missing_test_plan'
  | 'spec_requirement_without_rfc2119'
  | 'spec_version_claim_stale'
  | 'spec_version_claim_unchecked'
  // suggestions
  | 'spec_link_suggestion'
  // pass-through from the extractor
  | string;

export interface LintFinding {
  code: LintCode;
  severity: LintSeverity;
  /** Project-relative path of the spec file. */
  filePath: string;
  /** 1-indexed line, when the finding has one. */
  line?: number;
  /** The spec id the finding is about, when it has one. */
  specId?: string;
  message: string;
}

export interface LintFileReport {
  filePath: string;
  findings: LintFinding[];
  errorCount: number;
  warningCount: number;
  /** Advisory link suggestions (REQ-LINKACC-010) — never part of the exit code. */
  suggestionCount: number;
}

export interface LintReport {
  /** One entry per linted file, sorted by path — the stable grouping (A4). */
  files: LintFileReport[];
  filesChecked: number;
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
  /** The exit-code predicate (A3): errors fail, warnings alone do not. */
  hasErrors: boolean;
}

/**
 * Mirrors the extractor's private `ID_COMMENT`. Duplicated rather than
 * imported because the extractor does not export it and its module is off
 * limits to this one; the two MUST stay in sync — a marker the extractor
 * recognizes and this does not would hide duplicate ids.
 */
const ID_COMMENT_LINE = /^\s*<!--\s*id\s*:\s*([^\s-][^\s]*)\s*-->\s*$/;

/** RFC 2119 requirement keywords (A2). Case-insensitive: authors write both. */
const RFC_2119 = /\b(MUST|MUST NOT|SHALL|SHALL NOT|SHOULD|SHOULD NOT|MAY|REQUIRED|RECOMMENDED|OPTIONAL)\b/i;

/**
 * Negative-case vocabulary (A2). A requirement whose criteria never mention a
 * refusal, a failure, or an absence is almost always specifying only the happy
 * path. Heuristic by construction — hence a warning, never an error.
 */
const NEGATIVE_CASE = new RegExp(
  [
    'reject', 'refus', 'invalid', 'malformed', 'error', 'fail', 'failure',
    'missing', 'absent', 'empty', 'never', 'without', 'unauthorized',
    'forbidden', 'non-zero', 'not found', 'no match', 'unmatched', 'denied',
    'conflict', 'timeout', 'exceed', 'cannot', "can't", 'must not',
    'does not', "doesn't", 'is not', "isn't", 'no ',
  ].join('|'),
  'i'
);

/** `## Non-goals` (or prose "non-goal") anywhere in the document. */
const NON_GOALS = /non[- ]goals?/i;

/**
 * A test-plan signal: a `verifies:` link block, an `@verifies` marker, or prose
 * naming a test plan. Any one of them means the author thought about evidence.
 */
const TEST_PLAN = /(^|\n)\s*verifies:|@verifies|test plan|test-plan/i;

/** An unresolved authoring marker that must not survive into a written spec. */
const NEEDS_REVIEW = /\[needs\s+review\]/i;

/**
 * Drop inline code spans and fenced blocks before scanning prose. A spec that
 * documents the marker syntax writes `` `[needs review]` `` in backticks and is
 * not itself unresolved — without this, the lint flags the requirement that
 * defines the lint.
 */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
}

/**
 * True for a file that lives under `specs/` without being a spec: a brainstorm
 * brief (`brief.md`) or a design handoff-bundle transcript (`source.md`, the
 * designer convention). Neither carries id-marked headings by design, so every
 * structural check below would fire on every heading.
 */
function isNonSpecArtifact(filePath: string): boolean {
  const base = (filePath.split(/[/\\]/).pop() ?? '').toLowerCase();
  return base === 'brief.md' || base === 'source.md';
}

/** True for a domain fact — frontmatter-keyed, no requirement structure. */
function isDomainFile(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').includes('specs/domain/');
}

/** The provenance an external fact must carry (REQ-KNOW-001). */
const EXTERNAL_PROVENANCE = ['dependency', 'version', 'source'] as const;

/**
 * Domain-fact checks (KNOWLEDGE-DOC):
 *  - an `external` fact missing `dependency` / `version` / `source` is an
 *    error naming the missing field(s) (REQ-KNOW-001.A2) — it still indexes;
 *  - an `## Enforced` bullet not of the form `` `<glob>` must not match
 *    `/<regex>/` `` is an error (REQ-KNOW-003.A3).
 */
function lintDomainFact(
  specs: Spec[],
  source: string,
  add: (f: Omit<LintFinding, 'filePath'>) => void
): void {
  const fact = specs.find((s) => s.kind === 'domain');
  if (fact) {
    const meta = (fact.metadata ?? {}) as Record<string, unknown>;
    if (meta.type === 'external') {
      const missing = EXTERNAL_PROVENANCE.filter((k) => {
        const v = meta[k];
        return !(typeof v === 'number' || (typeof v === 'string' && v.trim().length > 0));
      });
      if (missing.length > 0) {
        add({
          code: 'spec_external_fact_missing_provenance',
          severity: 'error',
          line: 1,
          specId: fact.id,
          message: `External fact ${fact.id} is missing ${missing.join(', ')} — an external fact must record the dependency, the version it was verified against, and its source.`,
        });
      }
    }
  }
  // Parsed over the whole source so the line numbers are file lines; the
  // frontmatter can't contain a `## Enforced` heading.
  for (const m of parseEnforcedRules(source).malformed) {
    add({
      code: 'spec_malformed_enforced_rule',
      severity: 'error',
      line: m.line,
      specId: fact?.id,
      message: `Malformed enforced rule "${m.text}": ${m.reason}.`,
    });
  }
}

/**
 * Every `<!-- id: X -->` declaration in a spec file, in line order (1-indexed).
 * A brief or design transcript declares nothing — it is not a spec, so its
 * markers (quoted from elsewhere) must not collide with real ones.
 */
export function collectIdDeclarations(filePath: string, source: string): Array<{ id: string; line: number }> {
  if (isNonSpecArtifact(filePath)) return [];
  const out: Array<{ id: string; line: number }> = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const id = (lines[i] ?? '').match(ID_COMMENT_LINE)?.[1];
    if (id) out.push({ id, line: i + 1 });
  }
  return out;
}

/** Where one id is declared: a project-relative file and a 1-indexed line. */
export interface IdDeclarationSite {
  filePath: string;
  line: number;
}

/**
 * Ids declared in more than one spec file (REQ-MULTIDEV-001). The persistence
 * layer upserts by id, so after a merge where two branches picked the same id
 * in different files, one section silently replaces the other. Repeats inside a
 * single file are `spec_duplicate_id`'s job and are not reported here.
 *
 * Emits one error per colliding id per declaring file, anchored at that file's
 * first declaration, with every `path:line` listed (sorted) in the message.
 * Callers decide which of the returned findings belong to a linted file.
 */
export function findCrossFileDuplicates(decls: Map<string, IdDeclarationSite[]>): LintFinding[] {
  const out: LintFinding[] = [];
  for (const [id, sites] of decls) {
    const byFile = new Map<string, number>();
    for (const s of sites) {
      const first = byFile.get(s.filePath);
      if (first === undefined || s.line < first) byFile.set(s.filePath, s.line);
    }
    if (byFile.size < 2) continue;
    const listed = [...sites]
      .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line)
      .map((s) => `${s.filePath}:${s.line}`);
    const message = `ID ${id} is declared in ${byFile.size} files: ${listed.join(', ')}. Ids are global — the index keeps only one of these sections, so rename all but one.`;
    for (const [filePath, line] of byFile) {
      out.push({ code: 'spec_duplicate_id_cross_file', severity: 'error', filePath, line, specId: id, message });
    }
  }
  return out;
}

/**
 * Lint one spec file's source. `filePath` is used verbatim in findings, so
 * callers should pass a project-relative path.
 */
export function lintSpecSource(filePath: string, source: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (f: Omit<LintFinding, 'filePath'>) => findings.push({ ...f, filePath });

  // A brief or a design-handoff transcript is not a spec and is not held to a
  // spec's shape — including the extractor's own `spec_missing_id`, which every
  // heading in a transcript would trip. Nothing to report, at all.
  if (isNonSpecArtifact(filePath)) return findings;

  const lines = source.split(/\r?\n/);
  const result = new MarkdownSpecExtractor(filePath, source).extract();

  // 1. The extractor's own verdict, carried through unchanged (A1). Its
  //    severities are already right: a missing id is an error, a bare-path link
  //    bullet is a warning (the no-edge pointer is legal, just invisible).
  for (const e of result.errors) {
    add({
      code: e.code ?? 'spec_extraction_error',
      severity: e.severity === 'error' ? 'error' : 'warning',
      line: e.line,
      message: e.message,
    });
  }

  // 2. Duplicate ids within the file (A1). The persistence layer upserts by id,
  //    so the LAST occurrence wins and the earlier section silently vanishes.
  const seen = new Map<string, number>();
  for (const { id, line } of collectIdDeclarations(filePath, source)) {
    const first = seen.get(id);
    if (first !== undefined) {
      add({
        code: 'spec_duplicate_id',
        severity: 'error',
        line,
        specId: id,
        message: `Duplicate id ${id} (first declared on line ${first}). The last occurrence overwrites earlier ones, so the earlier section is lost.`,
      });
    } else {
      seen.set(id, line);
    }
  }

  // A domain fact keeps the extractor's verdict (its frontmatter can genuinely
  // be malformed) but has no requirement/acceptance structure to check. It has
  // its own two checks instead (KNOWLEDGE-DOC).
  if (isDomainFile(filePath)) {
    lintDomainFact(result.specs, source, add);
    return sortFindings(findings);
  }

  // A malformed `checked_against` claim (REQ-LINKACC-008.A4) needs no project
  // root, so it is checked here; stale / unchecked claims need the version in
  // use and are checked by lintSpecs.
  const claimEntry = findVersionClaimInSource(source);
  if (claimEntry) {
    for (const r of checkVersionClaims(claimEntry.meta, '', () => null)) {
      if (r.status !== 'malformed') continue;
      add({ code: 'spec_version_claim_malformed', severity: 'error', line: claimEntry.line, message: formatVersionClaim(r)! });
    }
  }

  const declared = new Set<string>([...seen.keys(), ...result.specs.map((s) => s.id)]);
  const acceptance = result.specs.filter((s) => s.kind === 'acceptance');
  const requirements = result.specs.filter((s) => s.kind === 'requirement');

  // 3. An `.A<N>` id whose parent requirement is nowhere in the file (A1). The
  //    extractor parents it anyway (by id), so nothing complains at index time
  //    while the criterion hangs off a requirement that doesn't exist.
  for (const spec of result.specs) {
    const parent = parseAcceptanceParentId(spec.id);
    if (parent && !declared.has(parent)) {
      add({
        code: 'spec_orphan_acceptance_parent',
        severity: 'error',
        line: spec.startLine,
        specId: spec.id,
        message: `${spec.id} names ${parent} as its parent requirement, but ${parent} is not declared in this file.`,
      });
    }
  }

  // 4. A requirement with no acceptance criteria (A1) — unverifiable by
  //    construction, and invisible to the behaviour gate.
  for (const req of requirements) {
    const children = acceptance.filter((a) => a.parentId === req.id);
    if (children.length === 0) {
      add({
        code: 'spec_requirement_without_acceptance',
        severity: 'error',
        line: req.startLine,
        specId: req.id,
        message: `${req.id} has no acceptance criteria — nothing can verify it.`,
      });
    }
  }

  // 5. `[needs review]` left inside an acceptance bullet (A1).
  for (const a of acceptance) {
    if (NEEDS_REVIEW.test(stripCode(a.body))) {
      add({
        code: 'spec_needs_review_marker',
        severity: 'error',
        line: a.startLine,
        specId: a.id,
        message: `${a.id} still carries a [needs review] marker.`,
      });
    }
  }

  // 5b. An `(evidence: <kind>)` tag naming a kind outside the four
  //     (REQ-PIPETRUST-001.A3). Resolution would silently fall back to the
  //     derived kind, so the author's intent would be lost — an error.
  for (const a of acceptance) {
    const { invalid } = parseDeclaredEvidenceKind(a.body);
    if (invalid !== undefined) {
      add({
        code: 'spec_unknown_evidence_kind',
        severity: 'error',
        line: a.startLine,
        specId: a.id,
        message: `${a.id} declares unknown evidence kind "${invalid}" — use one of ${EVIDENCE_KINDS.join(', ')}.`,
      });
    }
  }

  // 6. Happy-path-only requirements (A2, warning).
  for (const req of requirements) {
    const children = acceptance.filter((a) => a.parentId === req.id);
    if (children.length === 0) continue; // already an error above
    if (!children.some((a) => NEGATIVE_CASE.test(a.body))) {
      add({
        code: 'spec_no_negative_case',
        severity: 'warning',
        line: req.startLine,
        specId: req.id,
        message: `${req.id} has no negative-case acceptance criterion (no refusal, failure, or absence is specified).`,
      });
    }
  }

  // 7. A requirement stating no obligation (A2, warning). Scoped to the
  //     requirement's own title and body, NOT its bullets: house style writes
  //     acceptance criteria declaratively ("- The tile shows no delta…"), so a
  //     per-bullet check fires on essentially every criterion in the corpus and
  //     carries no signal. The obligation belongs on the requirement.
  for (const req of requirements) {
    const children = acceptance.filter((a) => a.parentId === req.id);
    const prose = requirementProse(lines, req, children);
    if (!RFC_2119.test(req.title) && !RFC_2119.test(prose)) {
      add({
        code: 'spec_requirement_without_rfc2119',
        severity: 'warning',
        line: req.startLine,
        specId: req.id,
        message: `${req.id} states no requirement keyword (MUST / SHOULD / MAY) in its title or body — its obligation is ambiguous.`,
      });
    }
  }

  // 8. Document-level signals the review checklist asks for (A2, warnings).
  //    Only meaningful for a file that actually declares requirements.
  if (requirements.length > 0) {
    if (!NON_GOALS.test(source)) {
      add({
        code: 'spec_missing_non_goals',
        severity: 'warning',
        message: 'No non-goals stated — scope has no stated boundary.',
      });
    }
    if (!TEST_PLAN.test(source)) {
      add({
        code: 'spec_missing_test_plan',
        severity: 'warning',
        message: 'No test-evidence signal (`verifies:` block, `@verifies`, or a test plan) — nothing declares how this gets verified.',
      });
    }
  }

  return sortFindings(findings);
}

/**
 * A requirement's own prose: its body minus the acceptance criteria that live
 * inside it. `Spec.body` spans everything under the heading, criteria included,
 * so scanning it for an obligation keyword would read the bullets' wording
 * back — exactly what the requirement-level check exists to avoid.
 */
function requirementProse(lines: string[], req: Spec, children: Spec[]): string {
  const from = (req.startLine ?? 1) + 1; // 1-indexed, excluding the heading
  const to = req.endLine ?? lines.length;
  const covered = (n: number) =>
    children.some((c) => n >= (c.startLine ?? 0) && n <= (c.endLine ?? c.startLine ?? 0));
  const out: string[] = [];
  for (let n = from; n <= to && n <= lines.length; n++) {
    const line = lines[n - 1] ?? '';
    if (covered(n)) continue;
    if (/^\s*#{1,6}\s*acceptance\s*$/i.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

/** Stable order within a file: by line, then code, then message. */
function sortFindings(findings: LintFinding[]): LintFinding[] {
  return findings.sort(
    (a, b) =>
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message)
  );
}

/** Collect `.md` files under a path (file → itself). Hidden dirs skipped. */
function collectSpecFiles(target: string, out: string[]): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (target.toLowerCase().endsWith('.md')) out.push(target);
    return;
  }
  if (!stat.isDirectory()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      collectSpecFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

export interface LintOptions {
  /** Root that finding paths are made relative to. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /**
   * Looks up the version of a package the project uses, for `checked_against`
   * claims (REQ-LINKACC-008). Defaults to `resolveVersionInUse` (lockfile →
   * node_modules → a probe configured in specship.config.json). Tests inject one.
   */
  resolveVersionInUse?: VersionInUseResolver;
  /**
   * Finds the commits naming a requirement, with the symbols they changed, for
   * link suggestions (REQ-LINKACC-010). Off unless given: a programmatic caller
   * (postcheck, tests that lint the whole repo) never pays for git history.
   * `specship lint` passes `findRequirementCommits` unless `--no-suggest`.
   */
  resolveRequirementCommits?: RequirementCommitResolver | false;
}

/**
 * Stale and unchecked `checked_against` claims of one spec file
 * (REQ-LINKACC-008.A1/A3). Malformed claims are lintSpecSource's (A4).
 */
function versionClaimFindings(
  rel: string,
  source: string,
  projectRoot: string,
  resolver: VersionInUseResolver | undefined
): LintFinding[] {
  if (isNonSpecArtifact(rel) || isDomainFile(rel)) return [];
  const entry = findVersionClaimInSource(source);
  if (!entry) return [];
  const out: LintFinding[] = [];
  for (const r of checkVersionClaims(entry.meta, projectRoot, resolver)) {
    if (r.status !== 'stale' && r.status !== 'unchecked') continue;
    out.push({
      code: r.status === 'stale' ? 'spec_version_claim_stale' : 'spec_version_claim_unchecked',
      severity: 'warning',
      filePath: rel,
      line: entry.line,
      message: `This spec was ${formatVersionClaim(r)!}`,
    });
  }
  return out;
}

/**
 * Lint every `.md` under each path (a path may be a file or a directory).
 * A path that does not exist contributes an error finding rather than throwing —
 * a typo'd argument must not look like a clean run.
 */
export function lintSpecs(paths: string[], options: LintOptions = {}): LintReport {
  const projectRoot = options.projectRoot ?? process.cwd();
  const files: LintFileReport[] = [];
  const decls = new Map<string, IdDeclarationSite[]>();
  const recordDeclarations = (rel: string, source: string) => {
    for (const { id, line } of collectIdDeclarations(rel, source)) {
      const sites = decls.get(id);
      if (sites) sites.push({ filePath: rel, line });
      else decls.set(id, [{ filePath: rel, line }]);
    }
  };

  const targets = paths.length > 0 ? paths : [path.join(projectRoot, 'specs')];
  const absFiles: string[] = [];
  const lintedSources: Array<{ rel: string; source: string }> = [];
  for (const target of targets) {
    const abs = path.isAbsolute(target) ? target : path.join(projectRoot, target);
    if (!fs.existsSync(abs)) {
      files.push({
        filePath: path.relative(projectRoot, abs) || target,
        findings: [
          {
            code: 'lint_path_not_found',
            severity: 'error',
            filePath: path.relative(projectRoot, abs) || target,
            message: `No such file or directory: ${target}`,
          },
        ],
        errorCount: 1,
        warningCount: 0,
        suggestionCount: 0,
      });
      continue;
    }
    collectSpecFiles(abs, absFiles);
  }

  for (const abs of [...new Set(absFiles)].sort()) {
    const rel = path.relative(projectRoot, abs) || abs;
    let source: string;
    try {
      source = fs.readFileSync(abs, 'utf-8');
    } catch (err) {
      files.push({
        filePath: rel,
        findings: [
          {
            code: 'lint_unreadable_file',
            severity: 'error',
            filePath: rel,
            message: `Could not read: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        errorCount: 1,
        warningCount: 0,
        suggestionCount: 0,
      });
      continue;
    }
    const claimFindings = versionClaimFindings(rel, source, projectRoot, options.resolveVersionInUse);
    const findings =
      claimFindings.length > 0
        ? sortFindings([...lintSpecSource(rel, source), ...claimFindings])
        : lintSpecSource(rel, source);
    recordDeclarations(rel, source);
    lintedSources.push({ rel, source });
    files.push({
      filePath: rel,
      findings,
      errorCount: findings.filter((f) => f.severity === 'error').length,
      warningCount: findings.filter((f) => f.severity === 'warning').length,
      suggestionCount: 0,
    });
  }

  // Cross-file duplicate ids (REQ-MULTIDEV-001). The rest of the checkout's
  // specs/ is scanned for declarations even when only a subset was linted
  // (A4), so a linted file colliding with an unlinted one still fails; the
  // unlinted file only contributes sites and gets no report entry.
  // Link suggestions (REQ-LINKACC-010) need every requirement's links, so the
  // corpus scan below also collects them. Read-only: nothing is written (A2).
  const suggestResolver = options.resolveRequirementCommits || null;
  const corpusLinks = new Map<string, Set<string>>();
  const corpusKeys = new Map<string, string>();
  const parsed = new Map<string, ReturnType<MarkdownSpecExtractor['extract']>>();
  const recordLinks = (rel: string, source: string) => {
    if (isNonSpecArtifact(rel) || isDomainFile(rel)) return;
    let result: ReturnType<MarkdownSpecExtractor['extract']>;
    try {
      result = new MarkdownSpecExtractor(rel, source).extract();
    } catch {
      return;
    }
    parsed.set(rel, result);
    const meta = (result.specs.find((s) => s.kind === 'document')?.metadata ?? {}) as Record<string, unknown>;
    for (const spec of result.specs) {
      if (spec.kind !== 'requirement') continue;
      const key = meta[`jira_issue_${spec.id}`];
      if (typeof key === 'string' && key.trim()) corpusKeys.set(spec.id, key.trim());
    }
    for (const c of result.linkCandidates) {
      const owner = parseAcceptanceParentId(c.specId) ?? c.specId;
      let keys = corpusLinks.get(owner);
      if (!keys) corpusLinks.set(owner, (keys = new Set()));
      keys.add(`${c.targetFilePath.replace(/\\/g, '/')}:${c.targetQualifiedName}`);
    }
  };
  if (suggestResolver) for (const { rel, source } of lintedSources) recordLinks(rel, source);

  const linted = new Set(absFiles);
  const corpus: string[] = [];
  collectSpecFiles(path.join(projectRoot, 'specs'), corpus);
  for (const abs of [...new Set(corpus)].sort()) {
    if (linted.has(abs)) continue;
    let source: string;
    try {
      source = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const rel = path.relative(projectRoot, abs) || abs;
    recordDeclarations(rel, source);
    if (suggestResolver) recordLinks(rel, source);
  }
  const reportsByPath = new Map(files.map((f) => [f.filePath, f]));
  const touched = new Set<LintFileReport>();
  for (const finding of findCrossFileDuplicates(decls)) {
    const report = reportsByPath.get(finding.filePath);
    if (!report) continue; // an unlinted file — named in the message only
    report.findings.push(finding);
    touched.add(report);
  }
  if (suggestResolver) {
    for (const { rel } of lintedSources) {
      const result = parsed.get(rel);
      const report = reportsByPath.get(rel);
      if (!result || !report) continue;
      const suggestions = linkSuggestionFindings(rel, result, corpusLinks, suggestResolver, projectRoot, corpusKeys);
      if (suggestions.length === 0) continue;
      report.findings.push(...suggestions);
      report.suggestionCount = suggestions.length;
      touched.add(report);
    }
  }
  for (const report of touched) {
    report.findings = sortFindings(report.findings);
    report.errorCount = report.findings.filter((f) => f.severity === 'error').length;
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const errorCount = files.reduce((n, f) => n + f.errorCount, 0);
  const warningCount = files.reduce((n, f) => n + f.warningCount, 0);
  const suggestionCount = files.reduce((n, f) => n + f.suggestionCount, 0);
  return {
    files,
    filesChecked: files.length,
    errorCount,
    warningCount,
    suggestionCount,
    hasErrors: errorCount > 0,
  };
}

/**
 * Human-readable, file-grouped rendering (A4). Files with no findings are
 * summarized in the tail count rather than listed, so a clean corpus prints
 * one line.
 */
export function formatLintReport(report: LintReport): string {
  const out: string[] = [];
  for (const file of report.files) {
    if (file.findings.length === 0) continue;
    out.push(file.filePath);
    const suggestions = file.findings.filter((f) => f.severity === 'suggestion');
    for (const f of file.findings) {
      if (f.severity === 'suggestion') continue;
      const where = f.line !== undefined ? `:${f.line}` : '';
      out.push(`  ${f.severity === 'error' ? 'error' : 'warn '} ${f.code}${where} — ${f.message}`);
    }
    if (suggestions.length > 0) {
      out.push('  Suggested links');
      for (const f of suggestions) {
        out.push(`    ${f.specId ?? ''}: ${f.message}`);
      }
    }
    out.push('');
  }
  const suggested = report.suggestionCount > 0 ? `, ${report.suggestionCount} suggestion(s)` : '';
  const counts = `${report.errorCount} error(s), ${report.warningCount} warning(s)${suggested} in ${report.filesChecked} file(s)`;
  out.push(report.errorCount === 0 && report.warningCount === 0 ? `Clean — ${counts}` : counts);
  return out.join('\n');
}

/**
 * CLI entry point, kept here so registering the subcommand is three lines in
 * `src/bin/specship.ts`. Returns the text to print and the process exit code
 * (A3) instead of writing or exiting itself — that is what makes it testable.
 *
 * Usage: `specship lint [path...] [--json] [--no-suggest]`
 */
export function runLintCli(
  args: string[] = [],
  options: LintOptions = {}
): { output: string; exitCode: number } {
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const report = lintSpecs(
    paths,
    args.includes('--no-suggest')
      ? { ...options, resolveRequirementCommits: false }
      : { resolveRequirementCommits: findRequirementCommits, ...options }
  );
  return {
    output: json ? JSON.stringify(report, null, 2) : formatLintReport(report),
    exitCode: report.hasErrors ? 1 : 0,
  };
}
