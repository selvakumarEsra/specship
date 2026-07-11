/**
 * Server-local JSONL ingest. Lives inside @specship/specship-server
 * so the HTTP API has a single deploy unit — no separate package, no
 * dependency wiring.
 *
 * Walks Claude Code's JSONL transcripts under `~/.claude/projects/` and
 * writes parsed entries into specship's SQLite database so the analytics
 * surfaces (Sessions, Heatmap, Costs, Compare, Tips) run sub-millisecond
 * queries instead of re-parsing megabytes of JSONL per page load.
 *
 * Two entry points:
 *   - `ingestAll(db)`     — one-shot pass, useful for CI / scripts.
 *   - `startWatcher(db)`  — live tail; runs ingestAll once + on each FS event.
 */

export { ingestAll, listTranscriptFiles, decodeProjectSlug, primaryProjectMatcher, getLastIngestStats } from './ingestor.js';
export type { IngestOptions, IngestDb } from './ingestor.js';
export { startWatcher } from './watcher.js';
export type { WatcherHandle, WatcherOptions } from './watcher.js';
export type { IngestStats, ClaudeRawEntry, ClaudeUsage, PricingRow } from './types.js';
export { resolvePricing, computeCost, normalizeModelId } from './pricing.js';
export { parseLine, summarizeToolInput, extractUserPrompt, toolResultLength } from './parser.js';
export { backfillDisplaced } from './impact-backfill.js';
