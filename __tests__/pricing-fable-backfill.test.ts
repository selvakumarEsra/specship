import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { resolvePricing, computeCost } from '../packages/server/src/ingest/pricing';
import type { PricingRow } from '../packages/server/src/ingest/types';
import { recostUnpricedPrompts } from '../packages/server/src/ingest/pricing-backfill';
import type { IngestDb } from '../packages/server/src/ingest/ingestor';

/**
 * REQ-DASHINT-001 (specs/dashboard-data-integrity.md): sessions from unpriced
 * Claude model families must not be costed at $0. The `fable` family gets a
 * pricing row + family fallback, and already-ingested $0 rows are re-costed.
 */

const FABLE_ROW: PricingRow = {
  model: 'claude-fable-5',
  input_per_mtok: 10.0,
  output_per_mtok: 50.0,
  cache_creation_per_mtok: 12.5,
  cache_read_per_mtok: 1.0,
};

describe('resolvePricing — fable family (REQ-DASHINT-001)', () => {
  it('A1: resolves claude-fable-5 (with or without date suffix) to the fable row', () => {
    expect(resolvePricing('claude-fable-5', [FABLE_ROW])).toBe(FABLE_ROW);
    expect(resolvePricing('claude-fable-5-20260601', [FABLE_ROW])).toBe(FABLE_ROW);
    expect(resolvePricing('claude-fable-6', [FABLE_ROW])).toBe(FABLE_ROW); // family fallback
  });

  it('A1: computes a non-zero cost for fable usage', () => {
    const pricing = resolvePricing('claude-fable-5', [FABLE_ROW]);
    const cost = computeCost(
      { input_tokens: 63_000, output_tokens: 185_000, cache_read_input_tokens: 20_200_000, cache_creation_input_tokens: 0 },
      pricing,
    );
    expect(cost).toBeGreaterThan(0);
  });

  it('A3: an unknown future family still resolves to null (cost 0), no throw', () => {
    expect(resolvePricing('claude-quasar-9', [FABLE_ROW])).toBeNull();
    expect(computeCost({ input_tokens: 1000 }, null)).toBe(0);
  });
});

describe('recostUnpricedPrompts (REQ-DASHINT-001.A2)', () => {
  let tmp: string;
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recost-'));
    db = new Database(path.join(tmp, 'test.db'));
    db.exec(`
      CREATE TABLE claude_sessions (id TEXT PRIMARY KEY, total_cost_usd REAL DEFAULT 0);
      CREATE TABLE claude_prompts (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model TEXT,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        cache_creation_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0
      );
      CREATE TABLE claude_pricing (
        model TEXT PRIMARY KEY, input_per_mtok REAL, output_per_mtok REAL,
        cache_creation_per_mtok REAL, cache_read_per_mtok REAL, updated_at INTEGER
      );
    `);
    db.prepare('INSERT INTO claude_pricing VALUES (?,?,?,?,?,?)')
      .run('claude-fable-5', 10.0, 50.0, 12.5, 1.0, Date.now());
    db.prepare('INSERT INTO claude_sessions (id, total_cost_usd) VALUES (?, ?)').run('s1', 5.0);
    // Zero-cost fable prompt with real tokens — the bug being healed.
    db.prepare(`INSERT INTO claude_prompts (id, session_id, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
                VALUES ('p1', 's1', 'claude-fable-5', 1000000, 100000, 0, 0)`).run();
    // Already-priced prompt — must not change.
    db.prepare(`INSERT INTO claude_prompts (id, session_id, model, input_tokens, cost_usd)
                VALUES ('p2', 's1', 'claude-fable-5', 1000000, 3.33)`).run();
    // Zero-cost prompt on an unpriced model — must stay 0.
    db.prepare(`INSERT INTO claude_prompts (id, session_id, model, input_tokens, cost_usd)
                VALUES ('p3', 's1', 'claude-quasar-9', 1000000, 0)`).run();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('re-costs $0 prompts with tokens, updates session totals, and is idempotent', () => {
    const updated = recostUnpricedPrompts(db as unknown as IngestDb);
    expect(updated).toBe(1);

    const p1 = db.prepare('SELECT cost_usd FROM claude_prompts WHERE id = ?').get('p1') as { cost_usd: number };
    // 1M input @ $10 + 100K output @ $50 = 10 + 5 = 15
    expect(p1.cost_usd).toBeCloseTo(15.0, 6);

    const p2 = db.prepare('SELECT cost_usd FROM claude_prompts WHERE id = ?').get('p2') as { cost_usd: number };
    expect(p2.cost_usd).toBeCloseTo(3.33, 6);

    const p3 = db.prepare('SELECT cost_usd FROM claude_prompts WHERE id = ?').get('p3') as { cost_usd: number };
    expect(p3.cost_usd).toBe(0);

    const s1 = db.prepare('SELECT total_cost_usd FROM claude_sessions WHERE id = ?').get('s1') as { total_cost_usd: number };
    expect(s1.total_cost_usd).toBeCloseTo(20.0, 6); // 5 existing + 15 backfilled

    // Idempotent: second run touches nothing.
    expect(recostUnpricedPrompts(db as unknown as IngestDb)).toBe(0);
    const s1b = db.prepare('SELECT total_cost_usd FROM claude_sessions WHERE id = ?').get('s1') as { total_cost_usd: number };
    expect(s1b.total_cost_usd).toBeCloseTo(20.0, 6);
  });
});
