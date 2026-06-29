/**
 * Deterministic, rule-based prompt-quality review (no LLM).
 *
 * Ported from the "SpecShip Desktop" Claude Design `screens-claude.jsx`
 * `promptQuality` / `gradeOf` / `improveText`, retyped onto the REAL ingested
 * `ClaudePrompt` + `ClaudeToolCall` shapes. Two design inputs that don't exist
 * in real data are substituted with honest proxies:
 *   - cache rate: computed from the prompt's own token fields (the design read a
 *     synthetic `p.cache`).
 *   - "heavy tool": tool calls have no per-call runtime, so a Bash/Grep/Read call
 *     returning a large result (`result_length`) stands in for the design's
 *     `rt > 30000ms`.
 */
import type { ClaudePrompt, ClaudeToolCall } from '../api/types';

export interface QualityFactor {
  label: string;
  ok: boolean;
}
export interface QualitySuggestion {
  sev: 'error' | 'warn' | 'info';
  text: string;
  /** Optional copyable fix command. */
  fix?: string;
}
export interface QualityResult {
  score: number;
  label: string;
  color: string;
  factors: QualityFactor[];
  suggestions: QualitySuggestion[];
  rewrite: string | null;
}

/** Result-length (bytes) above which a brute-force tool call counts as "heavy". */
const HEAVY_RESULT_BYTES = 30_000;

function gradeOf(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Excellent', color: 'var(--success)' };
  if (score >= 70) return { label: 'Good', color: 'var(--node-route)' };
  if (score >= 50) return { label: 'Fair', color: 'var(--warn)' };
  return { label: 'Needs work', color: 'var(--error)' };
}

/** Per-prompt cache read rate from the real token fields. */
function cacheRate(p: ClaudePrompt): number {
  const total = (p.input_tokens || 0) + (p.cache_creation_tokens || 0) + (p.cache_read_tokens || 0);
  return total > 0 ? (p.cache_read_tokens || 0) / total : 0;
}

function improveText(text: string, target: string | undefined): string | null {
  const lower = text.toLowerCase();
  if (/grep|call site|every/.test(lower)) {
    const term = target || '<symbol>';
    return `Use \`specship_search '${term}' --kind call-site\` instead of grep — it returns just the qualified call sites.`;
  }
  if (/read|explain|map|where|how |why |walk|boundaries|module/.test(lower)) {
    return `Use \`specship_explore --symbol ${target || '<symbol>'} --depth 2\` and summarize callers, callees and linked specs — avoid re-reading the file.`;
  }
  if (/implement/.test(lower) && !/REQ-[A-Z]+-\d+/.test(text)) {
    return `Reference the requirement id: \`Implement REQ-…: ${text.slice(0, 48)}…\` then plan before editing.`;
  }
  if (!target) {
    return `${text} — name the exact symbol, file or REQ id so it can be resolved structurally.`;
  }
  return null;
}

/** True when a tool call is a SpecShip / MCP structural query. */
function isStructural(t: ClaudeToolCall): boolean {
  return t.is_specship === 1 || /specship_/.test(t.tool_name) || /^mcp__/.test(t.tool_name);
}

/** True when a brute-force tool returned a large result (runtime proxy). */
function isHeavy(t: ClaudeToolCall): boolean {
  return (t.tool_name === 'Bash' || t.tool_name === 'Grep' || t.tool_name === 'Read')
    && (t.result_length || 0) > HEAVY_RESULT_BYTES;
}

export function promptQuality(p: ClaudePrompt, tools: ClaudeToolCall[]): QualityResult {
  const text = p.text || '';
  const sym = (text.match(/[a-z][a-zA-Z]+[A-Z][a-zA-Z]+/) || [])[0];
  const file = (text.match(/[\w/]+\.(ts|tsx|js|md)/) || [])[0];
  const req = (text.match(/REQ-[A-Z]+-\d+/) || [])[0];
  const target = req || sym || file;
  const namesTarget = !!target;
  const vagueOpener = /^(read |grep |look |check |explain |tell me|why |what )/i.test(text.trim());
  const specific = (text.length >= 45 && !vagueOpener) || text.length >= 72;
  const heavyTool = tools.some(isHeavy);
  const usedStructural = tools.some(isStructural);
  const cacheOk = cacheRate(p) >= 0.5;

  let score = 62;
  const factors: QualityFactor[] = [];
  factors.push({ label: 'Names a concrete target', ok: namesTarget }); score += namesTarget ? 12 : -10;
  factors.push({ label: 'Scoped & specific', ok: specific }); score += specific ? 10 : -9;
  factors.push({ label: 'Cache-friendly', ok: cacheOk }); score += cacheOk ? 8 : -10;
  factors.push({ label: 'Structural over brute-force', ok: usedStructural || !heavyTool }); score += (usedStructural || !heavyTool) ? 9 : -13;
  score = Math.max(14, Math.min(98, Math.round(score)));

  const suggestions: QualitySuggestion[] = [];
  if (!namesTarget) suggestions.push({ sev: 'warn', text: 'Name the exact symbol, file or REQ id so the agent doesn’t have to search for it first.' });
  if (!specific) suggestions.push({ sev: 'warn', text: 'Lead with the concrete change you want rather than an open-ended question.' });
  if (heavyTool && !usedStructural) suggestions.push({ sev: 'error', text: 'This turn leaned on Read/grep and pulled a lot of tokens. Ask for a structural query instead.', fix: `specship_explore --symbol ${sym || '<name>'} --depth 2` });
  if (!cacheOk) suggestions.push({ sev: 'warn', text: 'Cache hit was low — keep a stable prompt prefix and avoid reordering context to reuse the 1h cache.' });
  if (suggestions.length === 0) suggestions.push({ sev: 'info', text: 'Well-formed prompt — specific, scoped and cache-friendly. Nothing to change.' });

  const rewrite = score < 72 ? improveText(text, target) : null;
  const g = gradeOf(score);
  return { score, label: g.label, color: g.color, factors, suggestions, rewrite };
}

/** A shareable plain-text summary of the review (the design's "Share" payload). */
export function qualityReviewText(q: QualityResult): string {
  return `Prompt quality: ${q.label} (${q.score}/100)\n`
    + q.suggestions.map((s) => `- ${s.text}${s.fix ? `  [${s.fix}]` : ''}`).join('\n')
    + (q.rewrite ? `\nSuggested rewrite: ${q.rewrite}` : '');
}
