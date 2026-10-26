import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderGeminiPolicyToml } from '../../src/installer/targets/gemini';
import { buildHookDenyDecision, GEMINI_CLI_TRAITS } from '../../src/activation/hook-output';
import { buildSearchIntercept } from '../../src/activation/search-intercept';

/**
 * Contract fixtures for Gemini CLI 0.28.0 (KNOWLEDGE-DOC REQ-KNOW-006).
 *
 * Each test pins SpecShip's behaviour against a shape recorded from the
 * installed `@google/gemini-cli` / `@google/gemini-cli-core` 0.28.0 source.
 * They back the external facts DOM-SPECSHIP-005/006/007: when Gemini CLI's
 * installed version changes, `specship knowledge stale` lists these tests as
 * the ones to re-check against the new source.
 */

/**
 * Gemini's policy loader (`policy/toml-loader.js`, `PolicyFileSchema`) reads
 * `rule` (an array of tables) and composes `${mcpName}__${toolName}`. A
 * minimal parser of exactly the subset we emit: `[[table]]` headers and
 * `key = value` lines with string, string-array and integer values.
 */
function parseTomlSubset(src: string): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  let current: Record<string, unknown> | null = null;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const table = line.match(/^\[\[([A-Za-z_]+)\]\]$/);
    if (table) {
      current = {};
      (out[table[1]!] ??= []).push(current);
      continue;
    }
    const kv = line.match(/^([A-Za-z_]+)\s*=\s*(.+)$/);
    if (!kv || !current) throw new Error(`unparsed line: ${line}`);
    const value = kv[2]!.trim();
    current[kv[1]!] = value.startsWith('[')
      ? JSON.parse(value)
      : value.startsWith('"')
        ? JSON.parse(value)
        : Number(value);
  }
  return out;
}

function geminiPolicyUsesRuleTables(): void {
  const parsed = parseTomlSubset(renderGeminiPolicyToml());
  // Gemini 0.28.0 PolicyFileSchema: { rule?: PolicyRule[], safety_checker?: ... }.
  // Any other top-level table (e.g. `rules`) is silently ignored by the loader.
  expect(Object.keys(parsed)).toEqual(['rule']);
  const [rule] = parsed.rule!;
  expect(rule!.mcpName).toBe('specship');
  expect(rule!.decision).toBe('allow');
  expect(Number.isInteger(rule!.priority)).toBe(true);
  expect(rule!.priority as number).toBeGreaterThanOrEqual(0);
  expect(rule!.priority as number).toBeLessThanOrEqual(999);
  // The loader composes `specship__<toolName>`, so names must be bare.
  for (const name of rule!.toolName as string[]) {
    expect(name).toMatch(/^specship_[a-z_]+$/);
    expect(name.startsWith('specship__')).toBe(false);
  }
}

function geminiDenyDecisionIsTopLevel(): void {
  const out = JSON.parse(buildHookDenyDecision('use specship_explore')) as Record<string, unknown>;
  // Gemini 0.28.0 hooks/types.js: isBlockingDecision() { return this.decision === 'block' || this.decision === 'deny'; }
  const isBlockingDecision = (o: Record<string, unknown>) => o.decision === 'block' || o.decision === 'deny';
  expect(isBlockingDecision(out)).toBe(true);
  expect(out.reason).toBe('use specship_explore');
  expect(out.hookSpecificOutput).toBeUndefined();
  // Only the Gemini traits allow a before-tool deny at all.
  expect(GEMINI_CLI_TRAITS.supportsBeforeToolDeny).toBe(true);
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-contract-'));
  fs.mkdirSync(path.join(dir, '.specship'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function geminiTranscriptIsSingleJson(): void {
  // Gemini 0.28.0 services/chatRecordingService.js writes ONE pretty-printed
  // JSON document (JSON.stringify(conversation, null, 2)); tool calls are
  // messages[].toolCalls[].name, and an MCP tool appears under its bare name
  // (tools/mcp-tool.js DiscoveredMCPTool: nameOverride ?? generateValidName(serverToolName)).
  const used = path.join(dir, 'used.json');
  fs.writeFileSync(
    used,
    JSON.stringify(
      { sessionId: 's1', messages: [{ type: 'gemini', toolCalls: [{ id: 't1', name: 'specship_explore', args: {} }] }] },
      null,
      2,
    ),
  );
  const base = {
    cwd: dir,
    specshipToolMarkers: GEMINI_CLI_TRAITS.specshipToolMarkers,
    transcriptFormat: GEMINI_CLI_TRAITS.transcriptFormat,
  };
  // A session that already used SpecShip is not nudged.
  expect(buildSearchIntercept({ ...base, sessionId: 'used', transcriptPath: used })).toBeNull();
  // A session with no SpecShip call gets the one-line pointer.
  const fresh = path.join(dir, 'fresh.json');
  fs.writeFileSync(fresh, JSON.stringify({ sessionId: 's2', messages: [{ type: 'gemini', toolCalls: [{ name: 'grep_search' }] }] }, null, 2));
  expect(buildSearchIntercept({ ...base, sessionId: 'fresh', transcriptPath: fresh })).not.toBeNull();
}

describe('Gemini CLI 0.28.0 contract fixtures (REQ-KNOW-006)', () => {
  it('policy files use [[rule]] tables with bare tool names (REQ-KNOW-006.A2)', geminiPolicyUsesRuleTables);
  it('a before-tool deny is a top-level decision (REQ-KNOW-006.A2)', geminiDenyDecisionIsTopLevel);
  it('transcripts are one JSON document with bare MCP tool names (REQ-KNOW-006.A2)', geminiTranscriptIsSingleJson);
});
