/**
 * Cost calculation from Claude Code usage records.
 *
 * Pricing is per-model and per-token-bucket (input / output / cache write /
 * cache read). The DB seeds defaults for the current Anthropic public tiers;
 * users can override via the UI / CLI. The seeded rates live in the
 * `claude_pricing` table — see the v6 migration in specship core.
 *
 * Model name matching is loose: Claude sometimes reports versioned model
 * names like `claude-opus-4-7-20260601`. We strip the date suffix and try
 * exact match first, then fall back to family-level rates (e.g. any
 * `claude-opus-*` falls back to a generic Opus rate).
 */

import type { ClaudeUsage, PricingRow } from './types.js';

const FAMILY_FALLBACKS: Record<string, string> = {
  opus: 'claude-opus-4',
  sonnet: 'claude-sonnet-4',
  haiku: 'claude-haiku-4',
};

/**
 * Normalize a Claude model ID:
 *   - Lower-case
 *   - Strip trailing -YYYYMMDD or -YYYY-MM-DD date markers
 *   - Strip [1m] context-window suffixes (e.g. claude-opus-4-7[1m])
 */
export function normalizeModelId(model: string | undefined): string {
  if (!model) return '';
  let m = model.toLowerCase();
  m = m.replace(/\[\d+[a-z]+\]$/, '');
  m = m.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  return m;
}

/**
 * Look up a PricingRow for a model. Tries:
 *   1. exact match on normalized model id
 *   2. exact match on the original id
 *   3. family fallback (opus / sonnet / haiku → generic v4 rate)
 *   4. null (caller should treat cost as 0)
 */
export function resolvePricing(
  model: string | undefined,
  rows: PricingRow[]
): PricingRow | null {
  if (!model) return null;
  const norm = normalizeModelId(model);
  for (const r of rows) {
    if (r.model.toLowerCase() === norm) return r;
  }
  for (const r of rows) {
    if (r.model.toLowerCase() === model.toLowerCase()) return r;
  }
  // Family fallback.
  for (const [family, fallbackModel] of Object.entries(FAMILY_FALLBACKS)) {
    if (norm.includes(family)) {
      for (const r of rows) {
        if (r.model.toLowerCase() === fallbackModel) return r;
      }
    }
  }
  return null;
}

/**
 * Compute USD cost for one assistant turn's usage record. Returns 0 if no
 * pricing row resolves — the caller will report that separately.
 */
export function computeCost(
  usage: ClaudeUsage | undefined,
  pricing: PricingRow | null
): number {
  if (!usage || !pricing) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (input * pricing.input_per_mtok) / 1_000_000 +
    (output * pricing.output_per_mtok) / 1_000_000 +
    (cacheCreate * pricing.cache_creation_per_mtok) / 1_000_000 +
    (cacheRead * pricing.cache_read_per_mtok) / 1_000_000
  );
}
