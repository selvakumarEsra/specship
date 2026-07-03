/**
 * Re-cost prompts that were ingested while their model had no pricing row
 * (REQ-DASHINT-001.A2). Before the fable family was priced, every
 * `claude-fable-5` prompt landed with `cost_usd = 0` despite real token
 * usage — poisoning session totals, the dashboard's last-session tile, and
 * the Costs/Compare rankings.
 *
 * Idempotent: only rows with `cost_usd = 0` AND non-zero tokens are
 * touched, and only when their model now resolves to a pricing row with a
 * non-zero computed cost. Session totals are bumped by the same delta the
 * prompt rows gained. Run once per server boot (cheap: indexed scan).
 */

import { loadPricing, type IngestDb } from './ingestor.js';
import { computeCost, resolvePricing } from './pricing.js';
import type { PricingRow } from './types.js';

interface UnpricedPromptRow {
  id: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

/** Returns the number of prompt rows re-costed. */
export function recostUnpricedPrompts(db: IngestDb): number {
  const pricingRows: PricingRow[] = loadPricing(db);
  const candidates = db
    .prepare(`
      SELECT id, session_id, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens
      FROM claude_prompts
      WHERE cost_usd = 0 AND model IS NOT NULL
        AND (input_tokens > 0 OR output_tokens > 0 OR cache_creation_tokens > 0 OR cache_read_tokens > 0)
    `)
    .all() as UnpricedPromptRow[];
  if (candidates.length === 0) return 0;

  const updatePrompt = db.prepare('UPDATE claude_prompts SET cost_usd = ? WHERE id = ?');
  const bumpSession = db.prepare(
    'UPDATE claude_sessions SET total_cost_usd = total_cost_usd + ? WHERE id = ?'
  );

  let updated = 0;
  const run = db.transaction(() => {
    const sessionDeltas = new Map<string, number>();
    for (const row of candidates) {
      const pricing = resolvePricing(row.model, pricingRows);
      if (!pricing) continue;
      const cost = computeCost(
        {
          input_tokens: row.input_tokens,
          output_tokens: row.output_tokens,
          cache_creation_input_tokens: row.cache_creation_tokens,
          cache_read_input_tokens: row.cache_read_tokens,
        },
        pricing,
      );
      if (cost <= 0) continue;
      updatePrompt.run(cost, row.id);
      sessionDeltas.set(row.session_id, (sessionDeltas.get(row.session_id) ?? 0) + cost);
      updated++;
    }
    for (const [sessionId, delta] of sessionDeltas) {
      bumpSession.run(delta, sessionId);
    }
  });
  run();
  return updated;
}
