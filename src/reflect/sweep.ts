/**
 * Reflection orchestration (REQ-REFLECT-001 / 006).
 *
 * `analyze` runs the miner and persists the batch, returning the current open
 * proposals — this is what the on-demand button and `specship reflect` call.
 *
 * `sweep` does the same but additionally returns the proposals that should fire
 * a notification: freshly-inserted (not previously seen, applied, or dismissed)
 * AND high-severity. Already-seen and lower-severity findings are persisted and
 * listed, but never re-notified.
 */

import { SqliteDatabase } from '../db/sqlite-adapter';
import { mineProposals } from './miner';
import { ReflectStore } from './store';
import { Proposal, ReflectContext } from './types';

export interface AnalyzeResult {
  /** All currently-open proposals after this run. */
  open: Proposal[];
  /** Whether the transcript corpus yielded any signal at all (REQ-REFLECT-001.A2). */
  empty: boolean;
}

export interface SweepResult extends AnalyzeResult {
  /** New high-severity proposals worth a notification (REQ-REFLECT-006.A2/A3). */
  notify: Proposal[];
}

export function analyze(
  db: SqliteDatabase,
  ctx: ReflectContext,
  now: () => number = () => Date.now(),
): AnalyzeResult {
  const store = new ReflectStore(db, now);
  const mined = mineProposals(db, ctx);
  if (mined.length > 0) store.upsertMined(mined);
  return { open: store.list('open'), empty: mined.length === 0 };
}

export function sweep(
  db: SqliteDatabase,
  ctx: ReflectContext,
  now: () => number = () => Date.now(),
): SweepResult {
  const store = new ReflectStore(db, now);
  const mined = mineProposals(db, ctx);
  const notify: Proposal[] = [];
  if (mined.length > 0) {
    const { stored, insertedHashes } = store.upsertMined(mined);
    for (const p of stored) {
      // Notify only on a brand-new, still-open, high-severity proposal. A row
      // that already existed (even if re-mined) is not "new"; an applied or
      // dismissed one is filtered by the open check.
      if (insertedHashes.has(p.contentHash) && p.severity === 'high' && p.state === 'open') {
        notify.push(p);
      }
    }
  }
  return { open: store.list('open'), empty: mined.length === 0, notify };
}
