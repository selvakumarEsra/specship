/**
 * Proposal persistence (REQ-REFLECT-007).
 *
 * Wraps the `reflect_proposals` table. Proposals are keyed by `contentHash`, so
 * re-mining the same pattern UPSERTs the existing row (refreshing the
 * user-facing fields + evidence) while PRESERVING its state — a dismissed
 * proposal stays dismissed, an applied one stays applied. `upsertMined` reports
 * which hashes were freshly inserted, which the sweep uses to decide what's
 * "new" and therefore notify-worthy (REQ-REFLECT-006).
 */

import { SqliteDatabase } from '../db/sqlite-adapter';
import { Proposal, ProposalState } from './types';

interface Row {
  content_hash: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  target_kind: string;
  target_path: string;
  payload: string;
  evidence: string;
  state: string;
  created_at: number;
  updated_at: number;
  applied_at: number | null;
}

function rowToProposal(r: Row): Proposal {
  return {
    contentHash: r.content_hash,
    type: r.type as Proposal['type'],
    severity: r.severity as Proposal['severity'],
    title: r.title,
    body: r.body,
    targetKind: r.target_kind as Proposal['targetKind'],
    targetPath: r.target_path,
    payload: JSON.parse(r.payload) as Proposal['payload'],
    evidence: JSON.parse(r.evidence) as Proposal['evidence'],
    state: r.state as ProposalState,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    appliedAt: r.applied_at,
  };
}

export class ReflectStore {
  constructor(private db: SqliteDatabase, private now: () => number = () => Date.now()) {}

  /**
   * Persist a freshly-mined batch. Returns the proposals as stored (with state
   * resolved) plus the set of hashes that were newly inserted this call.
   */
  upsertMined(mined: Proposal[]): { stored: Proposal[]; insertedHashes: Set<string> } {
    const insertedHashes = new Set<string>();
    const ts = this.now();
    const existsStmt = this.db.prepare(`SELECT 1 AS x FROM reflect_proposals WHERE content_hash = ?`);
    const insertStmt = this.db.prepare(
      `INSERT INTO reflect_proposals
         (content_hash, type, severity, title, body, target_kind, target_path, payload, evidence, state, created_at, updated_at, applied_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'open', ?, ?, NULL)
       ON CONFLICT(content_hash) DO UPDATE SET
         severity = excluded.severity,
         title    = excluded.title,
         body     = excluded.body,
         payload  = excluded.payload,
         evidence = excluded.evidence,
         updated_at = excluded.updated_at`,
    );
    const tx = this.db.transaction((items: Proposal[]) => {
      for (const p of items) {
        const already = existsStmt.get(p.contentHash);
        if (!already) insertedHashes.add(p.contentHash);
        insertStmt.run(
          p.contentHash,
          p.type,
          p.severity,
          p.title,
          p.body,
          p.targetKind,
          p.targetPath,
          JSON.stringify(p.payload),
          JSON.stringify(p.evidence),
          ts,
          ts,
        );
      }
    });
    tx(mined);
    const stored = mined.map((p) => this.get(p.contentHash)).filter((x): x is Proposal => !!x);
    return { stored, insertedHashes };
  }

  get(hash: string): Proposal | null {
    const r = this.db
      .prepare(`SELECT * FROM reflect_proposals WHERE content_hash = ?`)
      .get(hash) as Row | undefined;
    return r ? rowToProposal(r) : null;
  }

  /** List proposals, optionally filtered by state. Newest-updated first. */
  list(state?: ProposalState): Proposal[] {
    const rows = state
      ? (this.db
          .prepare(`SELECT * FROM reflect_proposals WHERE state = ? ORDER BY updated_at DESC`)
          .all(state) as Row[])
      : (this.db.prepare(`SELECT * FROM reflect_proposals ORDER BY updated_at DESC`).all() as Row[]);
    return rows.map(rowToProposal);
  }

  /** Transition a proposal's state. `applied` stamps `applied_at` on first apply. */
  setState(hash: string, state: ProposalState): void {
    const ts = this.now();
    if (state === 'applied') {
      this.db
        .prepare(
          `UPDATE reflect_proposals
           SET state = ?, updated_at = ?, applied_at = COALESCE(applied_at, ?)
           WHERE content_hash = ?`,
        )
        .run(state, ts, ts, hash);
    } else {
      this.db
        .prepare(`UPDATE reflect_proposals SET state = ?, updated_at = ? WHERE content_hash = ?`)
        .run(state, ts, hash);
    }
  }
}
