/**
 * Workflow run time-to-completion estimation (WORKFLOW-ETA-DOC).
 *
 * Estimates the remaining machine time of a `running` run as a range — the
 * sum over its not-yet-completed steps of that step's historical duration
 * quantiles (p50 → low, p90 → high), computed from prior completed runs of
 * the SAME workflow (REQ-ETA-001/002). Recomputing after each step completes
 * is what makes the estimate tighten as the run progresses — this function is
 * pure read, cheap, and safe to call on every poll.
 *
 * Honesty rules:
 *   - Human gate-wait is unbounded latency: approval request→grant spans are
 *     subtracted from any step duration they overlap, and a paused run gets
 *     a "waiting since" timestamp instead of a number (REQ-ETA-003).
 *   - Fewer than MIN_HISTORY_RUNS completed prior runs → no estimate at all,
 *     never a fabricated default (REQ-ETA-004).
 *
 * Step identity: the executor logs step_started/step_completed with the step
 * id inside the event's data JSON (the step_id column predates that and is
 * often null), hence the COALESCE.
 */

import { SqliteDatabase } from '../db/sqlite-adapter';

export interface RunEtaAvailable {
  available: true;
  /** Optimistic remaining time — sum of remaining steps' historical medians. */
  lowMs: number;
  /** Pessimistic remaining time — sum of remaining steps' historical p90s. */
  highMs: number;
  /** How many completed prior runs the estimate is based on. */
  basisRuns: number;
}

export interface RunEtaUnavailable {
  available: false;
  reason: 'not_found' | 'not_running' | 'paused' | 'insufficient_history';
  /** For 'paused': when the run began waiting on the human (approval request). */
  waitingSinceMs?: number;
}

export type RunEta = RunEtaAvailable | RunEtaUnavailable;

/** Below this many completed prior runs, report insufficient_history. */
export const MIN_HISTORY_RUNS = 3;

/** Quantile of a non-empty sorted array (nearest-rank on small samples). */
function quantile(sortedAsc: number[], q: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}

interface EventRow {
  rid: string;
  et: string;
  sid: string | null;
  t: number;
}

/** Overlap of [aStart, aEnd] with [bStart, bEnd], ≥ 0. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function estimateRunEta(db: SqliteDatabase, runId: string): RunEta {
  const run = db
    .prepare(`SELECT id, workflow_name AS name, status, metadata FROM workflow_runs WHERE id = ?`)
    .get(runId) as { id: string; name: string; status: string; metadata: string | null } | undefined;
  if (!run) return { available: false, reason: 'not_found' };

  if (run.status === 'paused') {
    const w = db
      .prepare(
        `SELECT MAX(created_at) AS t FROM workflow_events
         WHERE workflow_run_id = ? AND event_type = 'approval_requested'`,
      )
      .get(runId) as { t: number | null } | undefined;
    return { available: false, reason: 'paused', waitingSinceMs: w?.t ?? undefined };
  }
  if (run.status !== 'running') return { available: false, reason: 'not_running' };

  const prior = db
    .prepare(
      `SELECT id FROM workflow_runs
       WHERE workflow_name = ? AND status = 'completed' AND id != ?
       ORDER BY completed_at DESC LIMIT 50`,
    )
    .all(run.name, runId) as Array<{ id: string }>;
  if (prior.length < MIN_HISTORY_RUNS) return { available: false, reason: 'insufficient_history' };

  const placeholders = prior.map(() => '?').join(',');
  const events = db
    .prepare(
      `SELECT workflow_run_id AS rid, event_type AS et,
              COALESCE(step_id, json_extract(data, '$.stepId')) AS sid,
              created_at AS t
       FROM workflow_events
       WHERE workflow_run_id IN (${placeholders})
         AND event_type IN ('step_started', 'step_completed', 'approval_requested', 'approval_granted')
       ORDER BY created_at ASC`,
    )
    .all(...prior.map((p) => p.id)) as EventRow[];

  // Human-wait spans per prior run: sequential request→grant pairs.
  const waitSpans = new Map<string, Array<[number, number]>>();
  const pendingReq = new Map<string, number>();
  for (const e of events) {
    if (e.et === 'approval_requested') pendingReq.set(e.rid, e.t);
    else if (e.et === 'approval_granted') {
      const req = pendingReq.get(e.rid);
      if (req !== undefined) {
        const spans = waitSpans.get(e.rid) ?? [];
        spans.push([req, e.t]);
        waitSpans.set(e.rid, spans);
        pendingReq.delete(e.rid);
      }
    }
  }

  // Per-step ACTIVE durations across prior runs (gate-wait subtracted), and
  // the step universe in first-seen order.
  const durations = new Map<string, number[]>();
  const firstSeen = new Map<string, number>();
  const openStep = new Map<string, { sid: string; t: number }>(); // rid → in-flight step
  for (const e of events) {
    if (!e.sid) continue;
    if (e.et === 'step_started') {
      openStep.set(e.rid, { sid: e.sid, t: e.t });
      if (!firstSeen.has(e.sid)) firstSeen.set(e.sid, e.t);
    } else if (e.et === 'step_completed') {
      const open = openStep.get(e.rid);
      if (!open || open.sid !== e.sid) continue;
      openStep.delete(e.rid);
      let dur = e.t - open.t;
      for (const [ws, we] of waitSpans.get(e.rid) ?? []) dur -= overlap(open.t, e.t, ws, we);
      if (dur >= 0) {
        const arr = durations.get(e.sid) ?? [];
        arr.push(dur);
        durations.set(e.sid, arr);
      }
    }
  }
  if (durations.size === 0) return { available: false, reason: 'insufficient_history' };

  // Steps this run has already completed: run metadata + its own event log.
  const done = new Set<string>();
  try {
    const meta = run.metadata ? (JSON.parse(run.metadata) as { completedNodes?: unknown }) : {};
    if (Array.isArray(meta.completedNodes)) for (const n of meta.completedNodes) done.add(String(n));
  } catch { /* unreadable metadata — fall back to the event log alone */ }
  const ownCompleted = db
    .prepare(
      `SELECT DISTINCT COALESCE(step_id, json_extract(data, '$.stepId')) AS sid
       FROM workflow_events
       WHERE workflow_run_id = ? AND event_type IN ('step_completed', 'step_skipped')`,
    )
    .all(runId) as Array<{ sid: string | null }>;
  for (const r of ownCompleted) if (r.sid) done.add(r.sid);

  const universe = [...durations.keys()].sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
  const remaining = universe.filter((sid) => !done.has(sid));

  // Fallback distribution for a remaining step with no history of its own:
  // this workflow's overall per-step durations (never another workflow's).
  const allDurs = [...durations.values()].flat().sort((a, b) => a - b);

  let lowMs = 0;
  let highMs = 0;
  for (const sid of remaining) {
    const durs = (durations.get(sid) ?? allDurs).slice().sort((a, b) => a - b);
    lowMs += quantile(durs, 0.5);
    highMs += quantile(durs, 0.9);
  }
  return { available: true, lowMs: Math.round(lowMs), highMs: Math.round(highMs), basisRuns: prior.length };
}
