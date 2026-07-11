// Benchmark claim governance (BENCH-CLAIM-DOC, REQ-BENCH-002/003).
//
// The manifest (docs/benchmarks/results.json) is the ONLY source numeric
// performance claims may be rendered from. parse-bench-readme.mjs writes it;
// this module renders the marker-delimited README section from it; the
// benchmark-claims test regenerates the section and fails the suite when the
// README block has drifted from the manifest (or carries no stamps).

export const BENCH_START = '<!-- BENCH_RESULTS_START — generated from docs/benchmarks/results.json; edit via the A/B harness, never by hand -->';
export const BENCH_END = '<!-- BENCH_RESULTS_END -->';

const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const fmtTok = (t) => (t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : `${Math.round(t / 1000)}k`);

/**
 * Render the README benchmarks block (markers included) from a manifest.
 * Deterministic: same manifest → same bytes, so drift is byte-comparable.
 */
export function renderBenchSection(m) {
  const lines = [];
  lines.push(BENCH_START);
  lines.push('### Measured: with vs. without SpecShip');
  lines.push('');
  const stamps = [
    `measured ${m.generatedAt.slice(0, 10)}`,
    m.claudeCodeVersion ? `Claude Code ${m.claudeCodeVersion}` : null,
    m.models?.length ? m.models.join(', ') : null,
    'median per repo',
  ].filter(Boolean);
  lines.push(`_${stamps.join(' · ')}_`);
  lines.push('');
  lines.push('| repo | time | tool calls | tokens | cost |');
  lines.push('|---|---|---|---|---|');
  for (const r of m.repos) {
    const w = r.medians.with; const wo = r.medians.without;
    lines.push(
      `| ${r.repo} ` +
      `| ${fmtTime(w.durationSec)} → ${fmtTime(wo.durationSec)} (${r.savedPct.time}%) ` +
      `| ${Math.round(w.tools)} → ${Math.round(wo.tools)} (${r.savedPct.tools}%) ` +
      `| ${fmtTok(w.tokens)} → ${fmtTok(wo.tokens)} (${r.savedPct.tokens}%) ` +
      `| $${w.costUsd.toFixed(2)} → $${wo.costUsd.toFixed(2)} (${r.savedPct.cost}%) |`
    );
  }
  lines.push('');
  const a = m.averageSavedPct;
  lines.push(`**Average saved — cost ${a.cost}% · tokens ${a.tokens}% · time ${a.time}% · tool calls ${a.tools}%.**`);
  lines.push(BENCH_END);
  return lines.join('\n');
}

/** Extract the governed block (markers included) from a README, or null. */
export function extractBenchSection(readme) {
  const start = readme.indexOf(BENCH_START);
  if (start === -1) return null;
  const end = readme.indexOf(BENCH_END, start);
  if (end === -1) return null;
  return readme.slice(start, end + BENCH_END.length);
}
