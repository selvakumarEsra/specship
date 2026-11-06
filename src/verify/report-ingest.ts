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
import { classifySignatureDrift } from '../resolution/signature-drift';
import { rebaselineBodyMetadata } from '../resolution/body-fingerprint';
import { isNonTestEvidence } from '../resolution/test-title-links';

/** One test's outcome in a recorded run (REQ-LINKACC-006). */
export interface RunTestResult {
  test: string;
  status: ReportedTestCase['status'];
}

/** The recorded report run a link's evidence rests on (REQ-LINKACC-006). */
export interface CoveringRun {
  id: string;
  report?: string;
  ranAt: string;
  commit?: string;
  results: RunTestResult[];
  /** Tests whose most recent recorded result is a failure, in any run. */
  failed: string[];
  /** True when every evidence link has a recorded run (otherwise only some are covered). */
  complete: boolean;
}

/**
 * The file-derived test evidence of a link (REQ-VEVID-002, REQ-REVINT-005.A2,
 * REQ-LINKACC-001): `tests` links on the link's spec and on that spec's
 * acceptance criteria, declared in a file and pointing into a test file. An
 * agent-asserted tests link is a DB-only row and never counts.
 */
export function evidenceLinksFor(sq: SpecQueries, link: Pick<SpecLink, 'specId'>): SpecLink[] {
  const ids = [
    link.specId,
    ...sq
      .getSpecsByParent(link.specId)
      .filter((s) => s.kind === 'acceptance')
      .map((s) => s.id),
  ];
  return ids
    .flatMap((id) => sq.getLinksBySpec(id))
    .filter(
      (l) =>
        l.kind === 'tests' &&
        (l.provenance === 'spec-declaration' || l.provenance === 'code-comment') &&
        !isNonTestEvidence(l)
    );
}

/**
 * The newest recorded report run across a link's evidence links, with the
 * per-test results those links hold for it (REQ-LINKACC-006). Newest by
 * `ranAt` wins: an older passing run never outvotes a newer failing one.
 * `null` when no evidence link carries a run — the verify is by hand.
 */
export function coveringRun(evidenceLinks: SpecLink[]): CoveringRun | null {
  type Rec = { run: Record<string, unknown>; v: Record<string, unknown> };
  const recs: Rec[] = [];
  for (const l of evidenceLinks) {
    const v = l.metadata?.verification as Record<string, unknown> | undefined;
    const run = v?.run as Record<string, unknown> | undefined;
    if (!run || typeof run.id !== 'string' || typeof run.ranAt !== 'string') continue;
    recs.push({ run, v: v! });
  }
  if (recs.length === 0) return null;
  // The newest run names the record; the results are every evidence link's
  // OWN latest result (an ingest rewrites only the links its report ran), so a
  // test that failed in an older run and was not re-run still counts as failed.
  const newest = recs.reduce((a, b) => ((b.run.ranAt as string) > (a.run.ranAt as string) ? b : a));
  const id = newest.run.id as string;

  const seen = new Map<string, RunTestResult['status']>();
  for (const { v } of recs) {
    let results: RunTestResult[] = [];
    if (Array.isArray(v.results)) {
      results = v.results.filter(
        (r): r is RunTestResult =>
          !!r && typeof (r as RunTestResult).test === 'string' && typeof (r as RunTestResult).status === 'string'
      );
    } else if (Array.isArray(v.evidence)) {
      // A record written before per-test results were stored: its evidence is
      // the cases behind its verdict.
      const status: RunTestResult['status'] = v.result === 'fail' ? 'failed' : 'passed';
      results = v.evidence.filter((e): e is string => typeof e === 'string').map((test) => ({ test, status }));
    }
    for (const r of results) {
      // A test failing in its latest recorded result stays failed.
      if (seen.get(r.test) !== 'failed') seen.set(r.test, r.status);
    }
  }
  const results = [...seen].map(([test, status]) => ({ test, status }));
  return {
    id,
    report: typeof newest.run.report === 'string' ? newest.run.report : undefined,
    ranAt: newest.run.ranAt as string,
    commit: typeof newest.run.commit === 'string' ? newest.run.commit : undefined,
    results,
    complete: recs.length === evidenceLinks.length,
    failed: results.filter((r) => r.status === 'failed').map((r) => r.test),
  };
}

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
  /**
   * `rename-only` drifted links returned to their pre-drift state because this
   * report, recorded on the current commit, passed every test of their
   * requirement (REQ-LINKACC-003).
   */
  cleared: LinkOutcome[];
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
export interface IngestTestReportOptions {
  runId?: string;
  /**
   * The commit the report's tests ran on. Supplied explicitly — a vitest report
   * carries no commit, and defaulting to today's HEAD would make an old report
   * look current (REQ-LINKACC-003.A3). Unknown → no drift is cleared.
   */
  commit?: string;
  /** The current commit (git HEAD at ingest time). */
  headCommit?: string;
  /** The current signature of a link's target symbol, for re-baselining. */
  currentSignature?: (link: SpecLink) => CurrentSignature | undefined;
}

/** A link target's live signature, plus its language for the classifier. */
export interface CurrentSignature {
  signature: string;
  language?: string;
  /** The symbol's current body fingerprint (REQ-LINKACC-004), when it can be taken. */
  bodyFp?: string;
  /**
   * The linked requirement's current text hash (REQ-LINKACC-013). `signature`
   * is empty when the target has no signature but this is still known.
   */
  specHash?: string;
}

/**
 * Re-baseline a link's body fingerprint and drop its body-changed marker
 * (REQ-LINKACC-004.A3) — what a passing verification does. A link whose
 * current fingerprint can't be taken keeps its old baseline, marker dropped.
 */
function rebaselineBody(metadata: Record<string, unknown>, current: CurrentSignature | undefined): void {
  rebaselineBodyMetadata(metadata, current?.bodyFp);
}

/**
 * Everything a passing report re-baselines on a link (REQ-LINKACC-013): the
 * body fingerprint (in `metadata`, persisted by the caller), the code signature
 * and the requirement's current text hash, each when known. Never called for a
 * failed run, so a failure keeps both stored baselines (A5).
 */
function rebaselineOnPass(
  sq: SpecQueries,
  link: SpecLink,
  metadata: Record<string, unknown>,
  current: CurrentSignature | undefined,
  now: number
): void {
  rebaselineBody(metadata, current);
  if (current?.signature) sq.updateSpecLinkSigBaseline(link.id, current.signature, now);
  if (current?.specHash) sq.updateSpecLinkSpecBaseline(link.id, current.specHash, now);
}

type LinkBucket = { link: SpecLink; cases: ReportedTestCase[] };

/** The requirement a spec id belongs to: `REQ-X.A3` → `REQ-X`. */
function rootRequirement(specId: string): string {
  return specId.replace(/\.A\d+$/, '');
}

/**
 * Clear `rename-only` code drifts the report proves harmless (REQ-LINKACC-003).
 *
 * Runs only when the report's commit is known and equals the current commit
 * (A3). A candidate is a link `drifted` on the code axis with kind
 * `rename-only` — never `type-change` / `shape-change` / `unclassified` (A4).
 * It clears only when EVERY `tests` link of its requirement and the
 * requirement's criteria has, in this report, at least one passed case and no
 * failed case (A1/A2); a test link the report did not run blocks the clear.
 * The current signature is re-classified against the baseline at clear time,
 * so code that changed again since the drift stays drifted. Clearing restores
 * the saved `preDrift.state`, re-baselines the signature and drops `preDrift`;
 * without a saved state or a live signature the link stays drifted — silent
 * beats wrong.
 */
export function clearRenameOnlyDrift(
  sq: SpecQueries,
  perLink: Map<number, LinkBucket>,
  ctx: {
    commit?: string;
    headCommit?: string;
    currentSignature?: (link: SpecLink) => CurrentSignature | undefined;
    now?: number;
  }
): LinkOutcome[] {
  const cleared: LinkOutcome[] = [];
  if (!ctx.commit || !ctx.headCommit || ctx.commit !== ctx.headCommit) return cleared;
  if (!ctx.currentSignature) return cleared;

  const all = sq.getAllLinks();
  const candidates = all.filter(
    (l) => l.state === 'drifted' && l.driftAxis === 'code' && l.driftKind === 'rename-only'
  );
  if (candidates.length === 0) return cleared;

  const testsByRoot = new Map<string, SpecLink[]>();
  for (const l of all) {
    if (l.kind !== 'tests') continue;
    const root = rootRequirement(l.specId);
    const list = testsByRoot.get(root) ?? [];
    list.push(l);
    testsByRoot.set(root, list);
  }

  const now = ctx.now ?? Date.now();
  for (const link of candidates) {
    const tests = testsByRoot.get(rootRequirement(link.specId)) ?? [];
    if (tests.length === 0) continue;
    const allPass = tests.every((t) => {
      const bucket = perLink.get(t.id);
      if (!bucket) return false;
      const failed = bucket.cases.some((c) => c.status === 'failed');
      const passed = bucket.cases.some((c) => c.status === 'passed');
      return passed && !failed;
    });
    if (!allPass) continue;

    const preDrift = link.metadata?.preDrift as { state?: unknown } | undefined;
    const restoreTo = preDrift?.state;
    if (typeof restoreTo !== 'string' || restoreTo === 'drifted') continue;

    const current = ctx.currentSignature(link);
    if (!current || !current.signature) continue;
    // The code may have changed again since the drift was recorded.
    const kindNow = classifySignatureDrift(link.nodeSigAtLink, current.signature, current.language);
    if (kindNow !== 'rename-only') continue;

    const to = restoreTo as SpecLink['state'];
    const metadata: Record<string, unknown> = { ...(link.metadata ?? {}) };
    delete metadata.preDrift;
    // The signature is re-baselined below; the body baseline moves with it so a
    // cleared link doesn't come back carrying a stale body-changed marker.
    rebaselineBody(metadata, current);
    sq.updateSpecLinkState(link.id, to, null, now);
    sq.updateSpecLinkSigBaseline(link.id, current.signature, now);
    sq.updateSpecLinkMetadata(link.id, metadata, now);
    cleared.push({
      linkId: link.id,
      specId: link.specId,
      file: link.targetFilePath,
      titles: tests.flatMap((t) =>
        (perLink.get(t.id)?.cases ?? []).filter((c) => c.status === 'passed').map((c) => c.fullName)
      ),
      from: link.state,
      to,
    });
  }
  return cleared;
}

export function ingestTestReport(
  sq: SpecQueries,
  projectRoot: string,
  reportPath: string,
  options: IngestTestReportOptions = {}
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
  const perLink = new Map<number, LinkBucket>();
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
        // Every case the link matched, pass or fail, so a later verify can
        // copy the run's per-test results (REQ-LINKACC-006.A1).
        results: linkCases.map((c) => ({ test: `${c.file}:${c.fullName}`, status: c.status })),
        run: {
          id: runId,
          report: reportPath,
          source: 'vitest-json',
          ranAt: verifiedAt,
          ...(options.commit ? { commit: options.commit } : {}),
        },
      },
    };

    // A passing run is a re-verification (REQ-LINKACC-004.A3, REQ-LINKACC-013).
    if (pass) rebaselineOnPass(sq, link, metadata, options.currentSignature?.(link), now);
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

  const cleared = clearRenameOnlyDrift(sq, perLink, {
    commit: options.commit,
    headCommit: options.headCommit,
    currentSignature: options.currentSignature,
  });

  const unmatchedCases = cases.filter((c) => !matchedCases.has(c));
  return {
    runId,
    reportPath,
    cases: cases.length,
    promoted,
    demoted,
    cleared,
    unchanged,
    unmatched: unmatchedCases.length,
    unmatchedSample: unmatchedCases.slice(0, 10).map((c) => `${c.file}:${c.fullName}`),
  };
}
