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
import { buildProposal } from './targets';
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

/**
 * Explicit capture (LEARN-DOC, REQ-LEARN-002): crystallize a workflow the
 * user/agent just performed into a `skill` proposal ON DEMAND — same store,
 * same content-hash convergence, same human gate as mined proposals. The
 * evidence detail marks the explicit provenance so the Improvements surface
 * can distinguish "you asked for this" from "the miner found this".
 */
export function capture(
  db: SqliteDatabase,
  ctx: ReflectContext,
  input: { title: string; content: string },
  now: () => number = () => Date.now(),
): Proposal {
  const store = new ReflectStore(db, now);
  const title = input.title.trim();
  const proposal = buildProposal(ctx, {
    type: 'skill',
    severity: 'info',
    nameSeed: `learn-${title}`,
    title: `Captured routine: ${title}`,
    body: 'Explicitly captured via /specship:learn — a distilled routine from a real session, awaiting your review.',
    content: input.content.trim(),
    evidence: {
      sessions: [],
      prompts: [],
      detail: 'explicitly captured (/specship:learn)',
    },
  });
  store.upsertMined([proposal]);
  // Return the stored row (state may differ if it already existed).
  return store.list().find((p) => p.contentHash === proposal.contentHash) ?? proposal;
}

/**
 * Explicit lesson capture (MEMLESSON-DOC, REQ-MEMLESSON-001): the anti-pattern
 * analog of {@link capture}. Turns a stated mistake + the rule to avoid
 * repeating it into a `memory_rule` proposal — targeting a portable
 * `~/.claude/memory` note (`scope: 'portable'`) or a marked block in the
 * project CLAUDE.md (`scope: 'project'`). Same store, same content-hash
 * convergence, same human gate as mined proposals: nothing reaches disk until
 * the user applies it.
 */
export function captureLesson(
  db: SqliteDatabase,
  ctx: ReflectContext,
  input: { title: string; content: string; scope: 'project' | 'portable' },
  now: () => number = () => Date.now(),
): Proposal {
  const store = new ReflectStore(db, now);
  const title = input.title.trim();
  const proposal = buildProposal(ctx, {
    type: 'memory_rule',
    severity: 'info',
    scope: input.scope,
    nameSeed: `lesson-${title}`,
    title: `Lesson: ${title}`,
    body:
      'Explicitly captured via `specship memory capture` — an anti-pattern to ' +
      'avoid repeating, awaiting your review.',
    content: input.content.trim(),
    evidence: {
      sessions: [],
      prompts: [],
      detail: 'explicitly captured (specship memory capture)',
    },
  });
  store.upsertMined([proposal]);
  return store.list().find((p) => p.contentHash === proposal.contentHash) ?? proposal;
}
