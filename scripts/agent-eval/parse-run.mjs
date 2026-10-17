#!/usr/bin/env node
// Parse a Claude Code stream-json run log: tool-call sequence + token usage.
//
// The tallying lives in `parseClaudeStream` and the printing in
// `renderMetrics` (eval-metrics.mjs) so the Gemini runner can emit the same
// schema (REQ-LOWEND-005.A1). The printed block is byte-identical to the
// pre-extraction output — the Claude eval path must not move
// (REQ-LOWEND-005.A3).
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { emptyMetrics, renderMetrics, tallyCounts } from './eval-metrics.mjs';

/** Normalize Claude Code stream-json lines into the shared metrics schema. */
export function parseClaudeStream(lines, label = '') {
  const m = emptyMetrics('claude');
  m.label = label;

  let result = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      m.specshipToolsExposed = (ev.tools || []).filter(t => /specship/.test(t)).length;
      if (ev.model) m.model = ev.model;
    }
    if (ev.type === 'assistant' && ev.message?.content) {
      if (ev.message.model) m.model = ev.message.model;
      for (const block of ev.message.content) {
        if (block.type === 'tool_use') {
          let detail = '';
          if (block.name === 'Task') detail = ` [subagent_type=${block.input?.subagent_type ?? '?'}] ${(block.input?.description ?? '').slice(0,40)}`;
          else if (/specship/.test(block.name)) detail = ` ${JSON.stringify(block.input?.query ?? block.input?.task ?? block.input?.symbol ?? '').slice(0,60)}`;
          else if (block.name === 'Bash') detail = ` ${(block.input?.command ?? '').slice(0,50)}`;
          else if (block.name === 'Read') detail = ` ${(block.input?.file_path ?? '').split('/').slice(-1)[0]}`;
          m.toolCalls.push(`${block.name}${detail}`);
        }
      }
    }
    if (ev.type === 'result') result = ev;
  }
  tallyCounts(m);

  if (result) {
    const u = result.usage || {};
    m.resultSubtype = result.subtype;
    m.durationSec = result.duration_ms / 1000;
    m.turns = result.num_turns;
    m.tokens = {
      in: (u.input_tokens||0) + (u.cache_read_input_tokens||0) + (u.cache_creation_input_tokens||0),
      out: u.output_tokens||0,
    };
    m.costUsd = result.total_cost_usd || 0;
  }
  return m;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const file = process.argv[2];
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  console.log(renderMetrics(parseClaudeStream(lines, file.split('/').pop())));
}
