/**
 * The verify step's test report, read for the run view (REQ-WFGATE-002).
 *
 * The bundled verify step writes a vitest JSON report to
 * `<project>/.specship/artifacts/runs/<runId>/nodes/test-report.json` and
 * deletes any earlier one first, so the file on disk is always the latest
 * attempt's — or absent when that attempt never reached the tests. Purging a
 * run removes only its worktree, so the report outlives the purge.
 *
 * Server-local on purpose: it reads the report's top-level counts itself
 * instead of importing the core's report ingest (DOM-SPECSHIP-004). A missing
 * or unparsable report is never a pass.
 */

import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';

/** The bundled workflows' verify node id. */
export const VERIFY_STEP_ID = 'verify';

export type VerifyStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Why there is no report to show. */
export type UnavailableReason =
  | 'not-run'       // the verify step has not started
  | 'running'       // started, report not written yet
  | 'skipped'       // no recognised test framework — tests did not run
  | 'build-failed'  // the build broke before the tests ran
  | 'env-failed'    // install / test tooling missing before the tests ran
  | 'not-vitest'    // tests ran, but not as a vitest project (cargo, pytest, …)
  | 'no-report';    // a vitest run that wrote no report, or no known cause

export interface VerifyTestReport {
  state: 'available' | 'unavailable' | 'unreadable';
  /** Only set when `state === 'available'`; never 'passed' otherwise. */
  outcome: 'passed' | 'failed' | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  stepStatus: VerifyStepStatus;
  /** The report and the verify step's own result disagree (shown as failed). */
  disagreement: boolean;
  reason?: UnavailableReason;
  /** The report's own error text when it could not be read. */
  detail?: string;
}

interface StepEvent { eventType: string; data?: unknown; createdAt?: number }

function eventStep(e: StepEvent): string | undefined {
  const d = e.data as { stepId?: unknown } | undefined;
  return typeof d?.stepId === 'string' ? d.stepId : undefined;
}

/** The verify step's latest status, replaying its own events in order. */
export function verifyStepStatus(events: StepEvent[], stepId = VERIFY_STEP_ID): VerifyStepStatus {
  let status: VerifyStepStatus = 'pending';
  for (const e of events) {
    if (eventStep(e) !== stepId) continue;
    if (e.eventType === 'step_started') status = 'running';
    else if (e.eventType === 'step_completed') status = 'completed';
    else if (e.eventType === 'step_failed') status = 'failed';
    else if (e.eventType === 'step_skipped') status = 'skipped';
  }
  return status;
}

/** The latest `step_started` time of the verify step, when recorded. */
function latestStart(events: StepEvent[], stepId: string): number | undefined {
  let at: number | undefined;
  for (const e of events) {
    if (e.eventType === 'step_started' && eventStep(e) === stepId && typeof e.createdAt === 'number') at = e.createdAt;
  }
  return at;
}

interface VerifyOutput {
  /** Last VERIFY_RESULT marker. */
  marker?: string;
  /** The step announced a vitest JSON report (VERIFY_REPORT=…). */
  vitest: boolean;
}

/**
 * The verify step's recorded output — only when it belongs to the latest
 * attempt. A failed attempt with no output leaves the previous attempt's file
 * in place; its marker would name the wrong cause, so it is ignored.
 */
function verifyOutput(nodesDir: string, stepId: string, startedAt: number | undefined): VerifyOutput {
  const file = path.join(nodesDir, `${stepId}.md`);
  try {
    if (startedAt !== undefined && statSync(file).mtimeMs < startedAt) return { vitest: false };
    const out = readFileSync(file, 'utf8');
    const all = [...out.matchAll(/VERIFY_RESULT=([a-z-]+)/g)];
    return { marker: all.length ? all[all.length - 1]![1] : undefined, vitest: /VERIFY_REPORT=/.test(out) };
  } catch {
    return { vitest: false };
  }
}

function unavailableReason(status: VerifyStepStatus, out: VerifyOutput): UnavailableReason {
  if (status === 'pending') return 'not-run';
  if (status === 'running') return 'running';
  if (status === 'skipped') return 'skipped';
  switch (out.marker) {
    case 'skipped': return 'skipped';
    case 'build-failed': return 'build-failed';
    case 'env-failed': return 'env-failed';
    // A vitest project announces its report path; tests that ran without
    // one are a vitest run that never wrote it (crashed), not a non-vitest
    // project.
    case 'ran-and-passed':
    case 'ran-and-failed': return out.vitest ? 'no-report' : 'not-vitest';
    default: return 'no-report';
  }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Read one run's verify report. `events` are that run's workflow events (in
 * order) — the step's status comes only from them, never from another run.
 */
export function readVerifyTestReport(
  projectRoot: string,
  runId: string,
  events: StepEvent[],
  stepId = VERIFY_STEP_ID,
): VerifyTestReport {
  const nodesDir = path.join(projectRoot, '.specship', 'artifacts', 'runs', runId, 'nodes');
  const file = path.join(nodesDir, 'test-report.json');
  const stepStatus = verifyStepStatus(events, stepId);
  const empty = { outcome: null, passed: null, failed: null, skipped: null, stepStatus, disagreement: false } as const;

  // Not started, or (re)running: whatever is on disk belongs to no finished
  // attempt of this step — an earlier attempt's pass must not show while the
  // rerun is under way (A6).
  if (stepStatus === 'pending' || stepStatus === 'running') {
    return { state: 'unavailable', ...empty, reason: unavailableReason(stepStatus, { vitest: false }) };
  }
  if (!existsSync(file)) {
    const out = verifyOutput(nodesDir, stepId, latestStart(events, stepId));
    return { state: 'unavailable', ...empty, reason: unavailableReason(stepStatus, out) };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { state: 'unreadable', ...empty, detail: err instanceof Error ? err.message : String(err) };
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const { numPassedTests, numFailedTests, numPendingTests } = r;
  const numTodoTests = r.numTodoTests ?? 0;
  if (!isCount(numPassedTests) || !isCount(numFailedTests) || !isCount(numPendingTests) || !isCount(numTodoTests)) {
    return { state: 'unreadable', ...empty, detail: 'report has no test counts' };
  }

  const reportFailed = numFailedTests > 0 || r.success === false;
  const stepFailed = stepStatus === 'failed';
  const stepPassed = stepStatus === 'completed';
  return {
    state: 'available',
    outcome: reportFailed || stepFailed ? 'failed' : 'passed',
    passed: numPassedTests,
    failed: numFailedTests,
    skipped: numPendingTests + numTodoTests,
    stepStatus,
    disagreement: (stepFailed && !reportFailed) || (stepPassed && reportFailed),
  };
}
