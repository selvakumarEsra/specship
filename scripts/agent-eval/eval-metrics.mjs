// Shared A/B metrics schema + renderer for the agent-eval runners
// (LOWEND-DOC REQ-LOWEND-005.A1).
//
// Both runners — Claude Code (parse-run.mjs) and Gemini CLI
// (parse-run-gemini.mjs) — normalize their host's very different run logs
// into THIS object and print it with THIS renderer, so an A/B row measured
// under gemini-3.5-flash is comparable field-for-field with a Claude row.
//
// The rendered block is byte-identical to what parse-run.mjs printed before
// the extraction (REQ-LOWEND-005.A3) — the Claude path must not move.

/** The metrics schema. Every runner returns exactly these keys. */
export function emptyMetrics(runner) {
  return {
    runner: runner ?? null,        // 'claude' | 'gemini'
    model: null,                   // model id when the log names one
    label: '',                     // display label (usually the log basename)
    toolCalls: [],                 // ordered "Name detail" strings
    counts: {},                    // tool name → count, first-seen order
    specshipToolsExposed: null,    // # specship tools the host exposed, or null
    resultSubtype: null,           // host's terminal status, or null
    durationSec: null,
    turns: null,
    tokens: { in: 0, out: 0 },
    costUsd: null,                 // null when the host reports no cost
    reads: 0,
    greps: 0,
    specshipCalls: 0,
    exitCode: 0,
  };
}

/**
 * Derive `counts`/`reads`/`greps`/`specshipCalls` from `toolCalls`.
 * Call after a runner has filled `toolCalls`.
 */
export function tallyCounts(m) {
  const counts = {};
  for (const tc of m.toolCalls) {
    const n = tc.split(' ')[0];
    counts[n] = (counts[n] || 0) + 1;
  }
  m.counts = counts;
  m.reads = counts.Read || 0;
  m.greps = counts.Grep || 0;
  m.specshipCalls = Object.entries(counts)
    .filter(([k]) => /specship/.test(k))
    .reduce((s, [, v]) => s + v, 0);
  return m;
}

/** Read/Grep escapes as a share of all tool calls — the low-end pass signal. */
export function fallbackRate(m) {
  if (!m.toolCalls.length) return 0;
  return (m.reads + m.greps) / m.toolCalls.length;
}

/** Render the metrics block. Deterministic: same metrics → same bytes. */
export function renderMetrics(m) {
  const out = [];
  out.push(`\n=== ${m.label} ===`);
  out.push(`specship tools exposed: ${m.specshipToolsExposed ?? '?'}`);
  out.push(`\nTool calls (${m.toolCalls.length}):`);
  out.push(`  by type: ${JSON.stringify(m.counts)}`);
  m.toolCalls.forEach((tc, i) => out.push(`  ${i + 1}. ${tc}`));
  if (m.resultSubtype !== null) {
    out.push(
      `\nResult: ${m.resultSubtype} | duration ${(m.durationSec ?? 0).toFixed(0)}s | turns ${m.turns ?? '?'}`
    );
    const cost = m.costUsd === null ? 'n/a' : `$${m.costUsd.toFixed(3)}`;
    out.push(`  tokens: in=${m.tokens.in} out=${m.tokens.out} | cost ${cost}`);
  }
  return out.join('\n');
}
