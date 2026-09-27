/**
 * Test-report ingestion (REQ-VSTATE-004).
 *
 * `verified` used to mean "an LLM read a test log and said it passed". This
 * module replaces that with a deterministic mapping: parse a real test report,
 * match each reported case to the `tests` links that claim it, and move those
 * links — passed → `verified`, failed → `broken` — recording the run itself as
 * the evidence.
 *
 * Parsing is total before any write happens, so a malformed report exits with a
 * parse error having changed no state (A4).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SpecLink } from '../types';
import type { SpecQueries } from '../db/spec-queries';

/** Thrown for an unreadable / unparseable / shapeless report (REQ-VSTATE-004.A4). */
export class TestReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestReportParseError';
  }
}

/** One test case as reported by the runner. */
export interface ReportedTestCase {
  /** Project-relative POSIX path of the test file. */
  file: string;
  /** The `it()` title, without ancestor describe titles. */
  title: string;
  /** Ancestors + title joined, as the runner reported it. */
  fullName: string;
  status: 'passed' | 'failed' | 'skipped';
  failureMessage?: string;
}

/** What one link's state move was, for reporting. */
export interface LinkOutcome {
  linkId: number;
  specId: string;
  file: string;
  /** The matched test titles the verdict rests on. */
  titles: string[];
  from: SpecLink['state'];
  to: SpecLink['state'];
}

export interface VerifyReportResult {
  runId: string;
  reportPath: string;
  /** Total cases read out of the report. */
  cases: number;
  promoted: LinkOutcome[];
  demoted: LinkOutcome[];
  /** Links matched whose state didn't move (already there, or only skips). */
  unchanged: number;
  /** Reported cases that matched no `tests` link at all (A3). */
  unmatched: number;
  /** A bounded sample of the unmatched cases, for the operator (A3). */
  unmatchedSample: string[];
}

interface RawAssertion {
  title?: unknown;
  fullName?: unknown;
  ancestorTitles?: unknown;
  status?: unknown;
  failureMessages?: unknown;
}

interface RawFileResult {
  name?: unknown;
  assertionResults?: unknown;
}

/** Normalize an absolute or relative path to a project-relative POSIX path. */
function toProjectRelative(projectRoot: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const abs = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(projectRoot, normalized);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
  return rel.startsWith('..') ? normalized.replace(/^\.\//, '') : rel;
}

/**
 * Parse a vitest / jest JSON report (`vitest run --reporter=json`).
 *
 * Shape: `{ testResults: [{ name, assertionResults: [{ title, fullName,
 * ancestorTitles, status, failureMessages }] }] }`. Anything else — invalid
 * JSON, a non-object, a missing/!array `testResults` — is a parse error rather
 * than an empty result, so a report written by a crashed runner can never read
 * as "nothing to verify" (A4).
 */
export function parseVitestJsonReport(raw: string, projectRoot: string): ReportedTestCase[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new TestReportParseError('report file is empty');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new TestReportParseError(
      `report is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TestReportParseError('report is not a JSON object');
  }
  const results = (parsed as { testResults?: unknown }).testResults;
  if (!Array.isArray(results)) {
    throw new TestReportParseError(
      'report has no `testResults` array — expected `vitest run --reporter=json` output'
    );
  }

  const cases: ReportedTestCase[] = [];
  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) continue;
    const fileResult = entry as RawFileResult;
    const name = typeof fileResult.name === 'string' ? fileResult.name : '';
    if (!name) continue;
    const file = toProjectRelative(projectRoot, name);
    const assertions = Array.isArray(fileResult.assertionResults)
      ? fileResult.assertionResults
      : [];
    for (const a of assertions) {
      if (typeof a !== 'object' || a === null) continue;
      const ar = a as RawAssertion;
      const title = typeof ar.title === 'string' ? ar.title : '';
      if (!title) continue;
      const ancestors = Array.isArray(ar.ancestorTitles)
        ? ar.ancestorTitles.filter((t): t is string => typeof t === 'string')
        : [];
      const fullName =
        typeof ar.fullName === 'string' && ar.fullName.length > 0
          ? ar.fullName
          : [...ancestors, title].join(' > ');
      const rawStatus = typeof ar.status === 'string' ? ar.status : 'skipped';
      const status: ReportedTestCase['status'] =
        rawStatus === 'passed'
          ? 'passed'
          : rawStatus === 'failed'
            ? 'failed'
            : 'skipped';
      const failures = Array.isArray(ar.failureMessages)
        ? ar.failureMessages.filter((m): m is string => typeof m === 'string')
        : [];
      cases.push({
        file,
        title,
        fullName,
        status,
        failureMessage: failures[0],
      });
    }
  }
  return cases;
}

/**
 * Does `testCase` prove `link`? Matching is by FILE first — a link's evidence
 * must live in the file it points at — then by title, in descending precision:
 *
 *   1. the link's recorded `metadata.testTitles` (written by the test-title pass,
 *      REQ-VSTATE-002) contains the case's title or full name;
 *   2. the case's full name mentions the link's spec id (the `(REQ-X.A1)` title
 *      convention, for links that predate the recorded titles);
 *   3. the case's full name mentions the link's target symbol (a `verifies:`
 *      block naming a hoisted test function).
 */
export function caseMatchesLink(testCase: ReportedTestCase, link: SpecLink): boolean {
  const linkFile = link.targetFilePath.replace(/\\/g, '/');
  if (linkFile !== testCase.file) return false;

  const recorded = link.metadata?.testTitles;
  if (Array.isArray(recorded)) {
    for (const t of recorded) {
      if (typeof t !== 'string') continue;
      if (t === testCase.title || t === testCase.fullName) return true;
    }
  }
  if (testCase.fullName.includes(link.specId)) return true;
  // A file-targeted link (the test-title pass) has no symbol to match on — its
  // qualified name IS the path, whose extension would match almost any title.
  if (link.targetNodeKind === 'file') return false;
  const symbol = link.targetQualifiedName.split('.').pop() ?? '';
  if (symbol.length >= 3 && testCase.fullName.includes(symbol)) return true;
  return false;
}

/**
 * Read a report and apply it to the DB (REQ-VSTATE-004).
 *
 * Per matched link: any failed case → `broken`; otherwise at least one passed
 * case → `verified`; only-skipped → left alone (a skipped test proves nothing
 * either way). The verification record persisted on the link carries the run id,
 * the report path, the ISO timestamp and the exact test names the verdict rests
 * on, so `verified` is auditable back to a specific run.
 */
export function ingestTestReport(
  sq: SpecQueries,
  projectRoot: string,
  reportPath: string,
  options: { runId?: string } = {}
): VerifyReportResult {
  let raw: string;
  try {
    raw = fs.readFileSync(path.resolve(projectRoot, reportPath), 'utf-8');
  } catch (err) {
    throw new TestReportParseError(
      `cannot read report ${reportPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  // Parse EVERYTHING before the first write (A4).
  const cases = parseVitestJsonReport(raw, projectRoot);

  const runId = options.runId ?? `run-${Date.now()}`;
  const verifiedAt = new Date().toISOString();
  const testsLinks = sq.getAllLinks().filter((l) => l.kind === 'tests');

  // Bucket the cases per link, and track which cases matched something.
  const perLink = new Map<number, { link: SpecLink; cases: ReportedTestCase[] }>();
  const matchedCases = new Set<ReportedTestCase>();
  for (const link of testsLinks) {
    for (const c of cases) {
      if (!caseMatchesLink(c, link)) continue;
      const bucket = perLink.get(link.id) ?? { link, cases: [] };
      bucket.cases.push(c);
      perLink.set(link.id, bucket);
      matchedCases.add(c);
    }
  }

  const promoted: LinkOutcome[] = [];
  const demoted: LinkOutcome[] = [];
  let unchanged = 0;

  for (const { link, cases: linkCases } of perLink.values()) {
    const failed = linkCases.filter((c) => c.status === 'failed');
    const passed = linkCases.filter((c) => c.status === 'passed');
    if (failed.length === 0 && passed.length === 0) {
      unchanged++;
      continue;
    }
    const pass = failed.length === 0;
    const relevant = pass ? passed : failed;
    const titles = relevant.map((c) => c.fullName);
    const now = Date.now();

    const metadata: Record<string, unknown> = {
      ...(link.metadata ?? {}),
      verification: {
        result: pass ? 'pass' : 'fail',
        verifiedAt,
        reason: pass
          ? `${passed.length} test(s) passed in ${path.basename(reportPath)}`
          : (failed[0]?.failureMessage?.split('\n')[0] ??
             `${failed.length} test(s) failed in ${path.basename(reportPath)}`),
        evidence: relevant.map((c) => `${c.file}:${c.fullName}`),
        run: { id: runId, report: reportPath, source: 'vitest-json', ranAt: verifiedAt },
      },
    };

    const to: SpecLink['state'] = pass ? 'verified' : 'broken';
    sq.updateSpecLinkState(link.id, to, null, now);
    sq.updateSpecLinkMetadata(link.id, metadata, now);
    const outcome: LinkOutcome = {
      linkId: link.id,
      specId: link.specId,
      file: link.targetFilePath,
      titles,
      from: link.state,
      to,
    };
    if (pass) promoted.push(outcome);
    else demoted.push(outcome);
  }

  const unmatchedCases = cases.filter((c) => !matchedCases.has(c));
  return {
    runId,
    reportPath,
    cases: cases.length,
    promoted,
    demoted,
    unchanged,
    unmatched: unmatchedCases.length,
    unmatchedSample: unmatchedCases.slice(0, 10).map((c) => `${c.file}:${c.fullName}`),
  };
}
