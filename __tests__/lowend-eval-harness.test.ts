import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// @ts-expect-error — harness scripts are plain .mjs, no type declarations.
import { emptyMetrics, fallbackRate } from '../scripts/agent-eval/eval-metrics.mjs';
// @ts-expect-error — harness scripts are plain .mjs, no type declarations.
import { parseClaudeStream } from '../scripts/agent-eval/parse-run.mjs';
// @ts-expect-error — harness scripts are plain .mjs, no type declarations.
import { parseGeminiRun } from '../scripts/agent-eval/parse-run-gemini.mjs';
// @ts-expect-error — harness scripts are plain .mjs, no type declarations.
import { renderMetrics } from '../scripts/agent-eval/eval-metrics.mjs';

/**
 * LOWEND-DOC REQ-LOWEND-005 — the Gemini CLI eval runner.
 *   A1 — a documented invocation runs pinned to gemini-3.5-flash and emits
 *        the SAME A/B metrics schema as the Claude runner.
 *   A2 — a missing/unauthenticated gemini fails the run; unparseable output
 *        is never recorded as a clean zero-tool pass.
 *   A3 — the Claude eval path is unchanged.
 */

const ROOT = path.join(__dirname, '..');
const SH = fs.readFileSync(path.join(ROOT, 'scripts', 'agent-eval', 'run-all-gemini.sh'), 'utf-8');
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', 'gemini-eval', name), 'utf-8');

describe('REQ-LOWEND-005.A1 — the runner is pinned and documented (source guard)', () => {
  it('defaults to gemini-3.5-flash and threads the model into both arms', () => {
    expect(SH).toContain('GEMINI_EVAL_MODEL="${GEMINI_EVAL_MODEL:-gemini-3.5-flash}"');
    expect(SH).toContain('-m "$GEMINI_EVAL_MODEL"');
  });

  it('pins the MCP server set per arm and marks the host so tier detection fires', () => {
    expect(SH).toContain('--allowed-mcp-server-names');
    expect(SH).toContain('SPECSHIP_HOST');
    expect(SH).toContain('gemini');
    // REQ-LOWEND-002's two candidate-tier arms ride on the override.
    expect(SH).toContain('SPECSHIP_MODEL');
  });

  it('runs both arms at least twice — never conclude from n=1', () => {
    expect(SH).toContain('EVAL_RUNS="${EVAL_RUNS:-2}"');
    expect(SH).toMatch(/seq 1 "\$EVAL_RUNS"/);
  });

  it('restores any pre-existing .gemini/settings.json', () => {
    expect(SH).toContain('trap restore_settings EXIT');
  });
});

describe('REQ-LOWEND-005.A2 — a missing or broken host fails loudly', () => {
  // @verifies REQ-LOWEND-005.A2
  function missingOrUnauthenticatedGeminiFailsTheRun(): void {
    expect(SH).toContain('command -v gemini');
    expect(SH).toContain('@google/gemini-cli');
    expect(SH).toContain("gemini -m \"$GEMINI_EVAL_MODEL\" -p 'reply OK'");
    expect(SH.match(/exit 1/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // An arm invocation is never suffixed with an ignore-failure clause.
    expect(SH).not.toContain('|| true');
  }
  it('preflights the binary and an auth smoke call, exiting non-zero', missingOrUnauthenticatedGeminiFailsTheRun);

  // @verifies REQ-LOWEND-005.A2
  function unparseableOutputIsNeverAZeroToolPass(): void {
    expect(() => parseGeminiRun('')).toThrow(/empty/i);
    expect(() => parseGeminiRun('   \n  ')).toThrow(/empty/i);
    expect(() => parseGeminiRun('Error: could not authenticate')).toThrow(/unparseable|unrecognized/i);
    expect(() => parseGeminiRun('{"unexpected":"shape"}')).toThrow(/unrecognized/i);
  }
  it('empty or unrecognizable output throws instead of scoring a zero-tool run', unparseableOutputIsNeverAZeroToolPass);

  it('an error document parses as an error result, not a success', () => {
    const m = parseGeminiRun('{"session_id":"s","error":{"type":"FatalAuthenticationError","message":"no creds"}}');
    expect(m.resultSubtype).toBe('error');
    expect(m.toolCalls).toHaveLength(0);
  });
});

describe('REQ-LOWEND-005.A1 — Gemini metrics match the Claude schema', () => {
  const claude = parseClaudeStream(
    fs
      .readFileSync(path.join(__dirname, 'fixtures', 'claude-eval', 'run-headless-with.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean),
    'run-headless-with.jsonl'
  );

  // @verifies REQ-LOWEND-005.A1
  function geminiRunnerEmitsTheClaudeMetricsSchema(): void {
    const gemini = parseGeminiRun(fixture('with-specship.jsonl'), 'with-specship.jsonl');
    expect(Object.keys(gemini).sort()).toEqual(Object.keys(claude).sort());
    expect(Object.keys(gemini).sort()).toEqual(Object.keys(emptyMetrics('gemini')).sort());
    expect(gemini.runner).toBe('gemini');
    expect(claude.runner).toBe('claude');
  }
  it('the two runners emit exactly the same keys', geminiRunnerEmitsTheClaudeMetricsSchema);

  it('with-arm: specship calls counted, no Read/Grep fallback, no invented cost', () => {
    const m = parseGeminiRun(fixture('with-specship.jsonl'), 'with-specship.jsonl');
    expect(m.specshipCalls).toBe(2);
    expect(m.reads).toBe(0);
    expect(m.greps).toBe(0);
    expect(fallbackRate(m)).toBe(0);
    expect(m.costUsd).toBeNull(); // Gemini CLI reports no dollar figure
    expect(m.model).toBe('gemini-3.5-flash');
    expect(m.durationSec).toBeCloseTo(41.2);
    expect(m.tokens).toEqual({ in: 18400, out: 1000 });
    expect(m.resultSubtype).toBe('success');
  });

  it('without-arm: read_file → Read, search_file_content → Grep, run_shell_command → Bash', () => {
    const m = parseGeminiRun(fixture('without-specship.jsonl'), 'without-specship.jsonl');
    expect(m.counts).toEqual({ Grep: 1, Read: 2, Bash: 1 });
    expect(m.reads).toBe(2);
    expect(m.greps).toBe(1);
    expect(m.specshipCalls).toBe(0);
    expect(fallbackRate(m)).toBe(0.75);
  });

  it('the aggregate --output-format json document parses too (order lost, counts kept)', () => {
    const m = parseGeminiRun(fixture('aggregate-json.json'), 'aggregate-json.json');
    expect(m.counts).toEqual({ specship_explore: 1, Read: 1 });
    expect(m.reads).toBe(1);
    expect(m.specshipCalls).toBe(1);
    expect(m.turns).toBe(3);
    expect(m.durationSec).toBe(39);
    expect(m.tokens).toEqual({ in: 18400, out: 1000 });
    expect(m.costUsd).toBeNull();
  });

  it('prose the CLI interleaves between events is skipped, not fatal', () => {
    const jsonl = [
      '{"type":"init","session_id":"s","model":"gemini-3.5-flash"}',
      'Loaded cached credentials.',
      '{"type":"tool_use","tool_name":"read_file","tool_id":"t1","parameters":{"absolute_path":"/repo/a.ts"}}',
      '{"type":"result","status":"success","stats":{"duration_ms":1000,"input_tokens":5,"output_tokens":6,"tool_calls":1}}',
    ].join('\n');
    const m = parseGeminiRun(jsonl, 'stream.jsonl');
    expect(m.reads).toBe(1);
    expect(m.durationSec).toBe(1);
    expect(m.tokens).toEqual({ in: 5, out: 6 });
  });
});

describe('REQ-LOWEND-005.A3 — the Claude path is byte-unchanged', () => {
  // @verifies REQ-LOWEND-005.A3
  function claudeRunnerRendersAByteIdenticalBlock(): void {
    const lines = fs
      .readFileSync(path.join(__dirname, 'fixtures', 'claude-eval', 'run-headless-with.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean);
    const rendered = renderMetrics(parseClaudeStream(lines, 'run-headless-with.jsonl'));
    expect(rendered).toBe(
      [
        '',
        '=== run-headless-with.jsonl ===',
        'specship tools exposed: 2',
        '',
        'Tool calls (4):',
        '  by type: {"mcp__specship__specship_explore":1,"Read":1,"Bash":1,"Task":1}',
        '  1. mcp__specship__specship_explore "mutateElement renderScene"',
        '  2. Read Scene.ts',
        '  3. Bash rg -n canvasNonce src | head -20',
        '  4. Task [subagent_type=specship-explorer] trace the render path end to end',
        '',
        'Result: success | duration 74s | turns 6',
        '  tokens: in=43000 out=2100 | cost $0.213',
      ].join('\n')
    );
  }
  it('parse-run.mjs renders the same block it always did', claudeRunnerRendersAByteIdenticalBlock);

  it('run-all.sh still drives claude with its own model knob', () => {
    const claudeSh = fs.readFileSync(path.join(ROOT, 'scripts', 'agent-eval', 'run-all.sh'), 'utf-8');
    expect(claudeSh).toContain('EVAL_MODEL="${EVAL_MODEL:-opus}"');
    expect(claudeSh).not.toContain('gemini');
  });
});
