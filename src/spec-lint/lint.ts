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

export type LintSeverity = 'error' | 'warning';

/**
 * Stable finding codes. Extractor-produced findings keep the extractor's own
 * code (`spec_missing_id`, `spec_stranded_id`, `spec_bare_path_ref`,
 * `spec_acceptance_parent_mismatch`) so one vocabulary spans both layers.
 */
export type LintCode =
  // errors
  | 'spec_duplicate_id'
  | 'spec_orphan_acceptance_parent'
  | 'spec_requirement_without_acceptance'
  | 'spec_needs_review_marker'
  // warnings
  | 'spec_no_negative_case'
  | 'spec_missing_non_goals'
  | 'spec_missing_test_plan'
  | 'spec_requirement_without_rfc2119'
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
}

export interface LintReport {
  /** One entry per linted file, sorted by path — the stable grouping (A4). */
  files: LintFileReport[];
  filesChecked: number;
  errorCount: number;
  warningCount: number;
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
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ID_COMMENT_LINE);
    const id = m?.[1];
    if (!id) continue;
    const first = seen.get(id);
    if (first !== undefined) {
      add({
        code: 'spec_duplicate_id',
        severity: 'error',
        line: i + 1,
        specId: id,
        message: `Duplicate id ${id} (first declared on line ${first}). The last occurrence overwrites earlier ones, so the earlier section is lost.`,
      });
    } else {
      seen.set(id, i + 1);
    }
  }

  // A domain fact keeps the extractor's verdict (its frontmatter can genuinely
  // be malformed) but has no requirement/acceptance structure to check.
  if (isDomainFile(filePath)) return sortFindings(findings);

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
}

/**
 * Lint every `.md` under each path (a path may be a file or a directory).
 * A path that does not exist contributes an error finding rather than throwing —
 * a typo'd argument must not look like a clean run.
 */
export function lintSpecs(paths: string[], options: LintOptions = {}): LintReport {
  const projectRoot = options.projectRoot ?? process.cwd();
  const files: LintFileReport[] = [];

  const targets = paths.length > 0 ? paths : [path.join(projectRoot, 'specs')];
  const absFiles: string[] = [];
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
      });
      continue;
    }
    const findings = lintSpecSource(rel, source);
    files.push({
      filePath: rel,
      findings,
      errorCount: findings.filter((f) => f.severity === 'error').length,
      warningCount: findings.filter((f) => f.severity === 'warning').length,
    });
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const errorCount = files.reduce((n, f) => n + f.errorCount, 0);
  const warningCount = files.reduce((n, f) => n + f.warningCount, 0);
  return {
    files,
    filesChecked: files.length,
    errorCount,
    warningCount,
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
    for (const f of file.findings) {
      const where = f.line !== undefined ? `:${f.line}` : '';
      out.push(`  ${f.severity === 'error' ? 'error' : 'warn '} ${f.code}${where} — ${f.message}`);
    }
    out.push('');
  }
  const counts = `${report.errorCount} error(s), ${report.warningCount} warning(s) in ${report.filesChecked} file(s)`;
  out.push(report.errorCount === 0 && report.warningCount === 0 ? `Clean — ${counts}` : counts);
  return out.join('\n');
}

/**
 * CLI entry point, kept here so registering the subcommand is three lines in
 * `src/bin/specship.ts`. Returns the text to print and the process exit code
 * (A3) instead of writing or exiting itself — that is what makes it testable.
 *
 * Usage: `specship lint [path...] [--json]`
 */
export function runLintCli(
  args: string[] = [],
  options: LintOptions = {}
): { output: string; exitCode: number } {
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const report = lintSpecs(paths, options);
  return {
    output: json ? JSON.stringify(report, null, 2) : formatLintReport(report),
    exitCode: report.hasErrors ? 1 : 0,
  };
}
