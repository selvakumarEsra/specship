#!/usr/bin/env node
// Aggregate the README A/B (bench-readme.sh output): per repo, median of N runs
// per arm → time, tool calls, tokens, cost, and % saved. Plus an average row.
//
// Tokens = SUM of per-turn assistant `usage` (input + output + cache read +
// cache creation) — the cumulative "total tokens processed". NOTE: `result.usage`
// is last-turn-only in current Claude Code, so it under-counts badly; don't use it.
// `total_cost_usd` and `duration_ms` are already cumulative.
//
// Usage: node parse-bench-readme.mjs [/tmp/ab-readme] [--manifest] [--write-readme]
//   --manifest       also write docs/benchmarks/results.json (BENCH-CLAIM-DOC,
//                    REQ-BENCH-002): per-repo medians + average savings,
//                    stamped with run date, Claude Code version, and model(s).
//   --write-readme   re-render the README's marker-delimited benchmarks block
//                    from that manifest (implies --manifest). Numbers are never
//                    hand-typed — the benchmark-claims test fails on divergence.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { renderBenchSection, extractBenchSection } from './bench-manifest.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const ROOT = args.find((a) => !a.startsWith('--')) || '/tmp/ab-readme';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPOS = ['vscode', 'excalidraw', 'django', 'tokio', 'okhttp', 'gin', 'alamofire'];

// Stamps for the manifest (REQ-BENCH-002.A1) — best-effort from the stream.
const seenModels = new Set();
let claudeCodeVersion = null;

function parse(file) {
  if (!existsSync(file)) return null;
  const L = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let tools = 0, reads = 0, grep = 0, cg = 0, tokens = 0, r = null, raced = false;
  for (const l of L) { let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'init') {
      if (typeof e.version === 'string') claudeCodeVersion = e.version;
      if (typeof e.model === 'string') seenModels.add(e.model);
    }
    if (e.type === 'assistant') {
      if (typeof e.message?.model === 'string') seenModels.add(e.message.model);
      const u = e.message?.usage;
      if (u) tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      for (const b of (e.message?.content || [])) if (b.type === 'tool_use') {
        const n = b.name;
        if (n === 'ToolSearch') continue;
        tools++;
        if (n === 'Read') reads++;
        else if (n === 'Grep' || n === 'Glob') grep++;
        else if (/specship/.test(n)) cg++;
      }
    }
    // MCP cold-start race: the headless agent fired before `specship serve --mcp`
    // finished registering its tools, so early calls returned "No such tool
    // available" and the agent floundered into grep/Read. That measures SpecShip's
    // startup latency, NOT its steady-state value — flag the run so the aggregate
    // can exclude it (an artifact of headless first-turn timing, not the tool).
    if (e.type === 'user') for (const b of (Array.isArray(e.message?.content) ? e.message.content : [])) {
      if (b.type === 'tool_result') {
        const t = Array.isArray(b.content) ? b.content.map(c => c.text || '').join('') : (b.content || '');
        if (/No such tool available/.test(t)) raced = true;
      }
    }
    if (e.type === 'result') r = e;
  }
  if (!r || r.subtype !== 'success') return null;
  return { dur: r.duration_ms / 1000, tools, reads, grep, cg, tokens, cost: r.total_cost_usd || 0, raced };
}
const median = (arr) => { const v = [...arr].sort((a, b) => a - b); const n = v.length; return n === 0 ? 0 : n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
const fmtTime = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
const fmtTok = (t) => t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : `${Math.round(t / 1000)}k`;
const pct = (w, wo) => wo > 0 ? Math.round((1 - w / wo) * 100) : 0;

console.log('repo        n(w/wo)  time WITH→WITHOUT      tools W→WO   tokens W→WO (saved)     cost W→WO (saved)');
const savings = { cost: [], tokens: [], time: [], tools: [] };
const manifestRepos = [];
for (const repo of REPOS) {
  const dir = join(ROOT, repo);
  const runDirs = existsSync(dir) ? readdirSync(dir).filter(d => /^run\d+$/.test(d)) : [];
  // Exclude MCP-cold-start-raced WITH runs by default — they measure a startup
  // race, not steady-state value. `CG_INCLUDE_RACED=1` keeps them (to see the raw
  // distribution). The WITHOUT arm has no MCP, so it's never raced.
  const includeRaced = process.env.CG_INCLUDE_RACED === '1';
  const W = [], WO = []; let racedExcluded = 0;
  for (const rd of runDirs) {
    const w = parse(join(dir, rd, 'run-headless-with.jsonl'));
    if (w) { if (w.raced && !includeRaced) racedExcluded++; else W.push(w); }
    const wo = parse(join(dir, rd, 'run-headless-without.jsonl')); if (wo) WO.push(wo);
  }
  if (!W.length || !WO.length) { console.log(`${repo.padEnd(11)} (incomplete: w=${W.length} wo=${WO.length})`); continue; }
  const m = (arr, k) => median(arr.map(x => x[k]));
  const wT = m(W, 'dur'), woT = m(WO, 'dur'), wTok = m(W, 'tokens'), woTok = m(WO, 'tokens');
  const wC = m(W, 'cost'), woC = m(WO, 'cost'), wTl = m(W, 'tools'), woTl = m(WO, 'tools');
  savings.time.push(pct(wT, woT)); savings.tokens.push(pct(wTok, woTok)); savings.cost.push(pct(wC, woC)); savings.tools.push(pct(wTl, woTl));
  manifestRepos.push({
    repo,
    runs: { with: W.length, without: WO.length, racedExcluded },
    medians: {
      with: { durationSec: wT, tools: wTl, tokens: wTok, costUsd: wC },
      without: { durationSec: woT, tools: woTl, tokens: woTok, costUsd: woC },
    },
    savedPct: { time: pct(wT, woT), tools: pct(wTl, woTl), tokens: pct(wTok, woTok), cost: pct(wC, woC) },
  });
  console.log(
    `${repo.padEnd(11)} ${W.length}/${WO.length}      ` +
    `${(fmtTime(wT) + '→' + fmtTime(woT)).padEnd(22)}` +
    `${(Math.round(wTl) + '→' + Math.round(woTl)).padEnd(12)}` +
    `${(fmtTok(wTok) + '→' + fmtTok(woTok) + ' (' + pct(wTok, woTok) + '%)').padEnd(24)}` +
    `$${wC.toFixed(2)}→$${woC.toFixed(2)} (${pct(wC, woC)}%)` +
    (racedExcluded ? `  [${racedExcluded} raced run${racedExcluded === 1 ? '' : 's'} excluded]` : '')
  );
}
const avg = (a) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0;
console.log(`\nAVERAGE saved:  cost ${avg(savings.cost)}%  ·  tokens ${avg(savings.tokens)}%  ·  time ${avg(savings.time)}%  ·  tool calls ${avg(savings.tools)}%`);

// ---- Claim manifest (BENCH-CLAIM-DOC, REQ-BENCH-002) ----
if (flags.has('--manifest') || flags.has('--write-readme')) {
  if (manifestRepos.length === 0) {
    console.error('no complete repos — refusing to write an empty manifest');
    process.exit(1);
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    claudeCodeVersion,
    models: [...seenModels].sort(),
    repos: manifestRepos,
    averageSavedPct: { cost: avg(savings.cost), tokens: avg(savings.tokens), time: avg(savings.time), tools: avg(savings.tools) },
  };
  const manifestPath = join(REPO_ROOT, 'docs', 'benchmarks', 'results.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nmanifest written: ${manifestPath}`);

  if (flags.has('--write-readme')) {
    const readmePath = join(REPO_ROOT, 'README.md');
    const readme = readFileSync(readmePath, 'utf8');
    const section = renderBenchSection(manifest);
    const existing = extractBenchSection(readme);
    let next;
    if (existing) {
      next = readme.replace(existing, section);
    } else {
      // First-time placement: right under the "## Why SpecShip?" prose.
      const anchor = /(## Why SpecShip\?[\s\S]*?)(\n## )/;
      next = anchor.test(readme)
        ? readme.replace(anchor, `$1\n${section}\n$2`)
        : `${readme.trimEnd()}\n\n${section}\n`;
    }
    writeFileSync(readmePath, next);
    console.log(`README benchmarks block ${existing ? 'updated' : 'inserted'}: ${readmePath}`);
  }
}
