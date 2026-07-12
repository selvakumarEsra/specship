/**
 * Model-aware context compaction (MODCTX-DOC).
 *
 * Lower-tier models (Haiku; Sonnet to a lesser degree) pay more attention
 * cost per token of scaffolding. When the session runs on one, code-graph
 * tool responses pass through a deterministic, fence-preserving compactor:
 * SpecShip's own prose (boilerplate notices, meta-guidance, blank runs)
 * compresses "caveman style" — terse, information-dense — while source code,
 * symbol names, paths, and line numbers stay byte-verbatim. Code is the
 * payload; scaffolding is the overhead.
 *
 * Detection rides the status line: Claude Code pipes the model into every
 * status-line render, and `recordSessionModel` persists it to
 * `.specship/session/model.json`; the MCP server reads it per call.
 * Unknown model → `full` tier → identity (never compact blind).
 */

import * as fs from 'fs';
import { modelMarkerPath, writeJsonAtomic, readJsonSafe } from '../statusline/paths';

export type ModelTier = 'haiku' | 'sonnet' | 'full';

export interface ModelMarker {
  v: 1;
  model: string;
  at: number;
}

/**
 * Persist the session's model (REQ-MODCTX-001). Called from the status-line
 * render path; writes only when the value changed so sub-second re-renders
 * stay cheap. Best-effort — never throws.
 */
export function recordSessionModel(projectRoot: string, model: string): void {
  try {
    const p = modelMarkerPath(projectRoot);
    const cur = readJsonSafe<ModelMarker>(p);
    if (cur?.model === model) return;
    writeJsonAtomic(p, { v: 1, model, at: Date.now() } satisfies ModelMarker);
  } catch {
    /* a marker write must never affect the status line */
  }
}

/** How much transcript tail to scan for the latest model (REQ-MODCTX-001.A5). */
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

/**
 * Extract the newest assistant turn's `message.model` from a Claude Code
 * transcript JSONL (REQ-MODCTX-001.A4) — the channel every hook gets via
 * `transcript_path`, present on every default install (unlike the opt-in
 * status line). Tail-bounded: reads at most the last 64 KB, scans lines
 * newest-first. Malformed lines and unreadable files return null — a hook
 * must never fail over telemetry.
 */
export function readModelFromTranscript(transcriptPath: string): string | null {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile() || stat.size === 0) return null;
    const start = Math.max(0, stat.size - TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    let text: string;
    try {
      const buf = Buffer.allocUnsafe(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = (lines[i] ?? '').trim();
      if (!line) continue;
      try {
        const e = JSON.parse(line) as { type?: string; message?: { model?: unknown } };
        if (e.type === 'assistant' && typeof e.message?.model === 'string' && e.message.model) {
          return e.message.model;
        }
      } catch {
        // partial or non-JSON line (tail cut mid-line) — keep scanning.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Map a model id / display name to a compaction tier. */
export function modelTier(model: string | null | undefined): ModelTier {
  if (!model) return 'full';
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  return 'full';
}

/**
 * Resolve the active tier for a project (REQ-MODCTX-001):
 * `SPECSHIP_COMPACT=0` disables outright; `SPECSHIP_MODEL` overrides;
 * else the session model marker; else `full`.
 */
export function detectModelTier(
  projectRoot: string | null,
  env: NodeJS.ProcessEnv = process.env
): ModelTier {
  if (env.SPECSHIP_COMPACT === '0') return 'full';
  if (env.SPECSHIP_MODEL) return modelTier(env.SPECSHIP_MODEL);
  if (!projectRoot) return 'full';
  const marker = readJsonSafe<ModelMarker>(modelMarkerPath(projectRoot));
  return modelTier(marker?.model);
}

/**
 * Known long boilerplate → terse equivalents carrying the SAME instruction —
 * in particular the stop-reading signal ("treat as already Read") must
 * survive compression (REQ-MODCTX-002.A2).
 */
const TERSE_NOTICES: Array<[RegExp, string]> = [
  [
    /> The code below is the \*\*verbatim, current on-disk source\*\*[\s\S]*?do not Read a file shown here\./,
    '> Verbatim on-disk source, line-numbered. Treat as already Read — do NOT Read these files.',
  ],
  [
    /\.\.\. \(output truncated to budget; the source above is complete and verbatim[\s\S]*?do NOT Read these files\.\)/,
    '… (truncated to budget. Shown source = already Read. Need more: another specship_explore with the names — not Read.)',
  ],
  [
    /> Some file sections were trimmed for size\.[\s\S]*?cheaper and more complete than Read\./,
    '> Some sections trimmed. Need a symbol: specship_explore / specship_node with its exact name — not Read.',
  ],
];

/** Blast-radius bullets kept on the haiku tier before "+N more". */
const HAIKU_BLAST_CAP = 3;

/**
 * Compact one tool-response markdown string for a tier (REQ-MODCTX-002/003).
 * `full` → identity. Fenced code blocks are byte-verbatim at every tier.
 */
export function compactToolResult(text: string, tier: ModelTier): string {
  if (tier === 'full') return text;

  // Split on fences; even indices are prose, odd are code (kept verbatim).
  const parts = text.split(/(```[\s\S]*?```)/);
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // fenced code — never touched
    let p = part;
    for (const [re, terse] of TERSE_NOTICES) p = p.replace(re, terse);
    if (tier === 'haiku') p = capBlastRadius(p);
    // Collapse runs of blank lines (prose only).
    p = p.replace(/\n{3,}/g, '\n\n');
    return p;
  });

  // Visibility (REQ-MODCTX-003.A1): one line naming the tier — worded to
  // ASSERT completeness. Measured on the haiku baseline (express, 2/2 runs):
  // the original wording ("— SPECSHIP_COMPACT=0 for full output") read as
  // "this output is incomplete" to a small model, which then re-Read files
  // it had been handed (4 Reads / 11 turns vs 0-1 / 5-7 without the banner).
  // The opt-out stays documented in the reference docs, not advertised here.
  return `⛁ compact mode (${tier}): prose condensed, ALL code complete and verbatim — answer from this output; do not re-read these files.\n${out.join('')}`;
}

/**
 * Cap the "### Blast radius" bullet list (haiku tier). Truncation is loud —
 * an explicit "+N more" line, never silent (REQ-MODCTX-002.A3).
 */
function capBlastRadius(prose: string): string {
  const heading = /^### Blast radius[^\n]*$/m;
  const h = prose.match(heading);
  if (!h || h.index === undefined) return prose;
  const start = h.index + h[0].length;
  const rest = prose.slice(start);
  const lines = rest.split('\n');
  const kept: string[] = [];
  let bullets = 0;
  let dropped = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') { kept.push(line); continue; }
    if (!line.startsWith('- ')) break; // section ended
    bullets++;
    if (bullets <= HAIKU_BLAST_CAP) kept.push(line);
    else dropped++;
  }
  if (dropped === 0) return prose;
  kept.push(`- …+${dropped} more dependents (full list on a larger model or SPECSHIP_COMPACT=0)`);
  return prose.slice(0, start) + kept.join('\n') + '\n' + lines.slice(i).join('\n');
}
