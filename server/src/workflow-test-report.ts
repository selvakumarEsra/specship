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
import { existsSync, readFileSync } from 'node:fs';

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
  | 'no-report';    // ended without a report and without a known cause

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

interface StepEvent { eventType: string; data?: unknown }

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

/** Last VERIFY_RESULT marker in the verify step's recorded output. */
function verifyMarker(nodesDir: string, stepId: string): string | undefined {
  try {
    const out = readFileSync(path.join(nodesDir, `${stepId}.md`), 'utf8');
    const all = [...out.matchAll(/VERIFY_RESULT=([a-z-]+)/g)];
    return all.length ? all[all.length - 1]![1] : undefined;
  } catch {
    return undefined;
  }
}

function unavailableReason(status: VerifyStepStatus, marker: string | undefined): UnavailableReason {
  if (status === 'pending') return 'not-run';
  if (status === 'running') return 'running';
  if (status === 'skipped') return 'skipped';
  switch (marker) {
    case 'skipped': return 'skipped';
    case 'build-failed': return 'build-failed';
    case 'env-failed': return 'env-failed';
    case 'ran-and-passed':
    case 'ran-and-failed': return 'not-vitest';
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

  if (!existsSync(file)) {
    return { state: 'unavailable', ...empty, reason: unavailableReason(stepStatus, verifyMarker(nodesDir, stepId)) };
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
