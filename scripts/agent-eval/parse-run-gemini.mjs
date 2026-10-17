#!/usr/bin/env node
// Parse a Gemini CLI run log into the shared A/B metrics schema
// (LOWEND-DOC REQ-LOWEND-005.A1).
//
// Gemini CLI does not emit Claude Code's stream-json, so this is a
// NORMALIZER, not an extension of parse-run.mjs — the Claude path stays
// byte-unchanged (REQ-LOWEND-005.A3).
//
// Schema provenance (same rule as src/installer/targets/gemini.ts: never
// invented from memory) — read out of the installed `@google/gemini-cli`
// **0.28.0** / `@google/gemini-cli-core` `dist/src/output/types.d.ts`,
// `output/json-formatter.js`, `output/stream-json-formatter.js` and
// `telemetry/uiTelemetry.js`:
//
//   --output-format stream-json  → JSONL of JsonStreamEvent:
//       {type:'init', session_id, model}
//       {type:'message', role, content, delta?}
//       {type:'tool_use', tool_name, tool_id, parameters}
//       {type:'tool_result', tool_id, status}
//       {type:'result', status, stats:{total_tokens, input_tokens,
//                                      output_tokens, cached, input,
//                                      duration_ms, tool_calls}}
//     This is the arm format: it carries the ORDERED tool sequence.
//   --output-format json         → one {session_id, response, stats, error?}
//     document whose `stats` is SessionMetrics — aggregate only:
//       stats.models[id].api{totalRequests,totalLatencyMs}
//       stats.models[id].tokens{prompt,candidates,cached,thoughts,…}
//       stats.tools{totalCalls,totalDurationMs,byName{name:{count,…}}}
//     Order is lost, so call sequence is reconstructed as counts.
//
// Hard rule (REQ-LOWEND-005.A2): output we cannot recognize is an ERROR, not
// an empty run. A silent zero-tool parse would read as a perfect
// "0 Read / 0 Grep" arm — the exact false pass the spec forbids.
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { emptyMetrics, renderMetrics, tallyCounts } from './eval-metrics.mjs';

/**
 * Gemini's built-in tool names → the Claude names the pass bar is written
 * in, so Read/Grep-fallback counting is comparable across hosts.
 */
const TOOL_NAME_MAP = {
  run_shell_command: 'Bash',
  read_file: 'Read',
  read_many_files: 'Read',
  search_file_content: 'Grep',
  grep: 'Grep',
  glob: 'Glob',
  list_directory: 'Glob',
  write_file: 'Write',
  replace: 'Edit',
  google_web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  save_memory: 'Memory',
};

/** MCP tools arrive plain (`specship_explore`) or server-qualified. */
function normalizeToolName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return 'unknown';
  const bare = name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name;
  return TOOL_NAME_MAP[bare] ?? bare;
}

/** Same detail suffixes the Claude parser prints, from Gemini's params. */
function callDetail(name, params) {
  if (!params || typeof params !== 'object') return '';
  const pick = (...keys) => {
    for (const k of keys) if (typeof params[k] === 'string' && params[k]) return params[k];
    return '';
  };
  if (/specship/.test(name)) return ` ${JSON.stringify(pick('query', 'task', 'symbol')).slice(0, 60)}`;
  if (name === 'Bash') return ` ${pick('command').slice(0, 50)}`;
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const p = pick('absolute_path', 'file_path', 'path', 'paths');
    return p ? ` ${p.split('/').slice(-1)[0]}` : '';
  }
  if (name === 'Grep') return ` ${pick('pattern', 'query').slice(0, 50)}`;
  return '';
}

function pushCall(calls, rawName, params) {
  if (!rawName) return;
  const name = normalizeToolName(rawName);
  calls.push(`${name}${callDetail(name, params)}`);
}

/** stream-json (JSONL events) — the ordered, preferred form. */
function fromStreamEvents(m, docs) {
  let sawEvent = false;
  let assistantMessages = 0;
  for (const ev of docs) {
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') continue;
    sawEvent = true;
    switch (ev.type) {
      case 'init':
        if (typeof ev.model === 'string') m.model = ev.model;
        break;
      case 'message':
        if (ev.role === 'assistant' && !ev.delta) assistantMessages++;
        break;
      case 'tool_use':
        pushCall(m.toolCalls, ev.tool_name ?? ev.name, ev.parameters ?? ev.args ?? ev.input);
        break;
      case 'result': {
        m.resultSubtype = ev.status ?? (ev.error ? 'error' : 'success');
        const s = ev.stats ?? {};
        if (typeof s.duration_ms === 'number') m.durationSec = s.duration_ms / 1000;
        m.tokens = { in: s.input_tokens ?? 0, out: s.output_tokens ?? 0 };
        break;
      }
      case 'error':
        if (m.resultSubtype === null) m.resultSubtype = 'error';
        break;
      default:
        break;
    }
  }
  if (assistantMessages) m.turns = assistantMessages;
  return sawEvent;
}

/** --output-format json — one document, aggregate stats, order lost. */
function fromJsonDocument(m, docs) {
  let sawDoc = false;
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    if (!('response' in doc) && !('stats' in doc) && !('error' in doc)) continue;
    sawDoc = true;
    if (doc.error) m.resultSubtype = 'error';
    else if (m.resultSubtype === null) m.resultSubtype = 'success';

    const s = doc.stats;
    if (!s || typeof s !== 'object') continue;

    for (const [id, stat] of Object.entries(s.models ?? {})) {
      if (!m.model) m.model = id;
      const t = stat?.tokens ?? {};
      m.tokens.in += t.prompt ?? t.input ?? 0;
      m.tokens.out += (t.candidates ?? t.output ?? 0) + (t.thoughts ?? 0);
      if (typeof stat?.api?.totalRequests === 'number') m.turns = (m.turns ?? 0) + stat.api.totalRequests;
      if (typeof stat?.api?.totalLatencyMs === 'number') {
        m.durationSec = (m.durationSec ?? 0) + stat.api.totalLatencyMs / 1000;
      }
    }
    // Aggregate tool counts: no order, so the sequence is count-expanded.
    const byName = s.tools?.byName;
    if (byName && typeof byName === 'object') {
      for (const [raw, v] of Object.entries(byName)) {
        const n = typeof v === 'number' ? v : (v?.count ?? 0);
        for (let i = 0; i < n; i++) pushCall(m.toolCalls, raw, null);
      }
    }
  }
  return sawDoc;
}

/**
 * Normalize a Gemini CLI run log into the shared metrics schema.
 * Throws on empty or unrecognizable output — never returns a zero-tool run
 * for output it did not understand (REQ-LOWEND-005.A2).
 */
export function parseGeminiRun(text, label = '') {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('empty gemini run log — the arm produced no output (auth failure? crash?)');

  const docs = [];
  let whole = null;
  try { whole = JSON.parse(raw); } catch { /* not a single document */ }
  if (whole !== null) docs.push(...(Array.isArray(whole) ? whole : [whole]));
  else {
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try { docs.push(JSON.parse(l)); } catch { /* prose the CLI interleaves */ }
    }
  }
  if (!docs.length) throw new Error('unparseable gemini run log — no JSON document or JSONL event found');

  const m = emptyMetrics('gemini');
  m.label = label;
  const sawStream = fromStreamEvents(m, docs);
  const sawDoc = fromJsonDocument(m, docs);
  if (!sawStream && !sawDoc) {
    throw new Error('unrecognized gemini run log — no stream event or response/stats document present');
  }
  tallyCounts(m);
  // Gemini CLI reports no dollar figure — never fabricate one (BENCH-CLAIM).
  m.costUsd = null;
  return m;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) { console.error('usage: parse-run-gemini.mjs <run-gemini-*.jsonl|.json>'); process.exit(2); }
  let metrics;
  try {
    metrics = parseGeminiRun(readFileSync(file, 'utf8'), file.split('/').pop());
  } catch (err) {
    console.error(`parse-run-gemini: ${err.message}`);
    process.exit(2);
  }
  console.log(renderMetrics(metrics));
}
