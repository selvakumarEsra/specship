/**
 * WORKFLOW-ETA-DOC (specs/workflow-eta.md) — run time-to-completion estimates.
 *
 * Drives `estimateRunEta` against a real SQLite with hand-seeded runs and
 * step events, so every quantile is verifiable by arithmetic:
 *   - REQ-ETA-001: range (low ≤ high), tightens as steps complete
 *   - REQ-ETA-002: same-workflow history only; sum of per-step quantiles
 *   - REQ-ETA-003: approval request→grant spans excluded; paused runs report
 *     waiting-since instead of a number
 *   - REQ-ETA-004: < 3 prior completed runs → insufficient_history
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { SqliteDatabase } from '../src/db/sqlite-adapter';
import { estimateRunEta, MIN_HISTORY_RUNS } from '../src/workflows/eta';

let dir: string;
let conn: DatabaseConnection;
let db: SqliteDatabase;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-eta-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  db = conn.getDb();
});

afterEach(() => {
  conn.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function seedRun(id: string, workflow: string, status: string, metadata?: Record<string, unknown>): void {
  db.prepare(
    `INSERT INTO workflow_runs (id, workflow_name, status, started_at, completed_at, last_activity_at, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workflow, status, 1000, status === 'completed' ? 99000 : null, 99000, 1000, metadata ? JSON.stringify(metadata) : null);
}

function seedEvent(runId: string, type: string, stepId: string | null, at: number): void {
  db.prepare(
    `INSERT INTO workflow_events (workflow_run_id, event_type, step_id, data, created_at)
     VALUES (?, ?, NULL, ?, ?)`,
  ).run(runId, type, stepId ? JSON.stringify({ stepId }) : null, at);
  seq++;
}

/** A completed prior run with two steps: plan (10s) and build (60s). */
function seedHistoryRun(id: string, workflow = 'wf', planMs = 10_000, buildMs = 60_000): void {
  seedRun(id, workflow, 'completed');
  const t0 = 10_000;
  seedEvent(id, 'step_started', 'plan', t0);
  seedEvent(id, 'step_completed', 'plan', t0 + planMs);
  seedEvent(id, 'step_started', 'build', t0 + planMs);
  seedEvent(id, 'step_completed', 'build', t0 + planMs + buildMs);
}

describe('estimateRunEta', () => {
  it('reports insufficient history below the minimum run count (REQ-ETA-004.A1)', () => {
    for (let i = 0; i < MIN_HISTORY_RUNS - 1; i++) seedHistoryRun(`h${i}`);
    seedRun('live', 'wf', 'running');
    const eta = estimateRunEta(db, 'live');
    expect(eta).toEqual({ available: false, reason: 'insufficient_history' });
  });

  it('produces a low ≤ high range from per-step history at the minimum (REQ-ETA-001.A1, REQ-ETA-004.A1)', () => {
    for (let i = 0; i < MIN_HISTORY_RUNS; i++) seedHistoryRun(`h${i}`);
    seedRun('live', 'wf', 'running');
    const eta = estimateRunEta(db, 'live');
    expect(eta.available).toBe(true);
    if (eta.available) {
      // Identical history → p50 == p90 == 10s + 60s for the two steps.
      expect(eta.lowMs).toBe(70_000);
      expect(eta.highMs).toBe(70_000);
      expect(eta.basisRuns).toBe(MIN_HISTORY_RUNS);
    }
  });

  it('sums per-step quantiles over varied history (REQ-ETA-002.A2)', () => {
    seedHistoryRun('h0', 'wf', 10_000, 50_000);
    seedHistoryRun('h1', 'wf', 20_000, 60_000);
    seedHistoryRun('h2', 'wf', 30_000, 100_000);
    seedRun('live', 'wf', 'running');
    const eta = estimateRunEta(db, 'live');
    expect(eta.available).toBe(true);
    if (eta.available) {
      // n=3, nearest-rank: p50 = 2nd value, p90 = 3rd value per step.
      expect(eta.lowMs).toBe(20_000 + 60_000);
      expect(eta.highMs).toBe(30_000 + 100_000);
    }
  });

  it('tightens as steps complete — last step strictly below full run (REQ-ETA-001.A2)', () => {
    for (let i = 0; i < 3; i++) seedHistoryRun(`h${i}`);
    seedRun('fresh', 'wf', 'running');
    seedRun('late', 'wf', 'running', { completedNodes: ['plan'] });
    const fresh = estimateRunEta(db, 'fresh');
    const late = estimateRunEta(db, 'late');
    expect(fresh.available && late.available).toBe(true);
    if (fresh.available && late.available) {
      expect(late.highMs).toBeLessThan(fresh.highMs);
      expect(late.lowMs).toBe(60_000); // only 'build' remains
    }
  });

  it('ignores other workflows\' history entirely (REQ-ETA-002.A1)', () => {
    for (let i = 0; i < 5; i++) seedHistoryRun(`a${i}`, 'workflow-a');
    seedRun('live-b', 'workflow-b', 'running');
    const eta = estimateRunEta(db, 'live-b');
    expect(eta).toEqual({ available: false, reason: 'insufficient_history' });
  });

  it('excludes approval request→grant spans from a gated step\'s history (REQ-ETA-003.A1)', () => {
    // Each history run's 'gate' step spans 100s wall-clock but contains a 90s
    // human wait — its active duration must be recorded as 10s.
    for (let i = 0; i < 3; i++) {
      const id = `g${i}`;
      seedRun(id, 'gated', 'completed');
      seedEvent(id, 'step_started', 'gate', 10_000);
      seedEvent(id, 'approval_requested', null, 15_000);
      seedEvent(id, 'approval_granted', null, 105_000);
      seedEvent(id, 'step_completed', 'gate', 110_000);
    }
    seedRun('live', 'gated', 'running');
    const eta = estimateRunEta(db, 'live');
    expect(eta.available).toBe(true);
    if (eta.available) {
      expect(eta.lowMs).toBe(10_000);
      expect(eta.highMs).toBe(10_000);
    }
  });

  it('paused runs report waiting-since instead of a number (REQ-ETA-003.A2)', () => {
    for (let i = 0; i < 3; i++) seedHistoryRun(`h${i}`);
    seedRun('paused-run', 'wf', 'paused');
    seedEvent('paused-run', 'approval_requested', null, 42_000);
    const eta = estimateRunEta(db, 'paused-run');
    expect(eta.available).toBe(false);
    if (!eta.available) {
      expect(eta.reason).toBe('paused');
      expect(eta.waitingSinceMs).toBe(42_000);
    }
  });

  it('completed and unknown runs carry no estimate', () => {
    for (let i = 0; i < 3; i++) seedHistoryRun(`h${i}`);
    seedRun('done', 'wf', 'completed');
    expect(estimateRunEta(db, 'done')).toEqual({ available: false, reason: 'not_running' });
    expect(estimateRunEta(db, 'nope')).toEqual({ available: false, reason: 'not_found' });
  });
});
