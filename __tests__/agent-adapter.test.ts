import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSteeringNudge, STEERING_TEXT, STEERING_TEXT_LITE } from '../src/activation/steering';
import {
  CLAUDE_CODE_TRAITS,
  GEMINI_CLI_TRAITS,
  deriveHostTraits,
  parseHookPayload,
} from '../src/activation/hook-output';

/**
 * AGENTADAPT-DOC (specs/agent-adapter-layer.md) — host specifics live behind
 * the hook adapter; shared code renders agent-facing text in the calling
 * host's tool-name form and never hard-codes a host's names.
 */

// The pre-adapter wording, verbatim. The steering line is A/B-gated
// (REQ-STEER-003), so Claude Code output may not drift as a side effect.
const LEGACY_STEERING_TEXT =
  'This project has a SpecShip code-graph index. Before reading or editing ANY ' +
  'code for a task — understanding, implementing, fixing, refactoring — call ' +
  'mcp__specship__specship_explore with the relevant symbol/file names FIRST. ' +
  'Treat the source it returns as already read; use Read/Grep only for content ' +
  'it did not return.';
const LEGACY_STEERING_TEXT_LITE =
  'This project has a SpecShip index. For any code question, call exactly: ' +
  'mcp__specship__specship_explore with the symbol/file names from the question. ' +
  'ONE call, then answer from its output — the source it returns is already read. ' +
  'Do not spawn subagents. Do not Read/Grep files the tool returned.';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentadapt-'));
  fs.mkdirSync(path.join(dir, '.specship'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const LITE_ENV = { SPECSHIP_MODEL: 'gemini-2.5-flash' };

function claudeSteeringTextIsByteIdentical(): void {
  expect(STEERING_TEXT).toBe(LEGACY_STEERING_TEXT);
  expect(STEERING_TEXT_LITE).toBe(LEGACY_STEERING_TEXT_LITE);
  // A Claude payload and a payload with no event name both get the legacy text.
  for (const raw of [JSON.stringify({ hook_event_name: 'UserPromptSubmit' }), 'plain prompt']) {
    const traits = deriveHostTraits(parseHookPayload(raw));
    expect(buildSteeringNudge(dir, {}, dir, traits.toolPrefix)).toBe(LEGACY_STEERING_TEXT);
  }
  expect(buildSteeringNudge(dir, {}, dir)).toBe(LEGACY_STEERING_TEXT);
}

function geminiSteeringNamesTheBareTool(): void {
  const traits = deriveHostTraits(parseHookPayload(JSON.stringify({ hook_event_name: 'BeforeAgent' })));
  const text = buildSteeringNudge(dir, {}, dir, traits.toolPrefix);
  expect(text).toContain(' specship_explore ');
  expect(text).not.toContain('mcp__specship__');
}

function liteTierFollowsTheHostToolForm(): void {
  const gemini = buildSteeringNudge(dir, LITE_ENV, dir, GEMINI_CLI_TRAITS.toolPrefix);
  expect(gemini).toContain('Do not spawn subagents');
  expect(gemini).toContain(' specship_explore ');
  expect(gemini).not.toContain('mcp__specship__');
  expect(buildSteeringNudge(dir, LITE_ENV, dir, CLAUDE_CODE_TRAITS.toolPrefix)).toBe(LEGACY_STEERING_TEXT_LITE);
}

function traitsComeOnlyFromTheAdapter(): void {
  const gemini = deriveHostTraits(parseHookPayload(JSON.stringify({ hook_event_name: 'BeforeTool' })));
  expect(gemini).toBe(GEMINI_CLI_TRAITS);
  expect(gemini.toolPrefix).toBe('');
  expect(gemini.fallbackPromptEvent).toBe('BeforeAgent');
  expect(gemini.fallbackToolEvent).toBe('BeforeTool');
  expect(gemini.denyEligibleTools).toEqual(['grep_search', 'glob']);
  expect(gemini.shellTool).toBe('run_shell_command');
  const claude = deriveHostTraits(parseHookPayload(JSON.stringify({ hook_event_name: 'PreToolUse' })));
  expect(claude).toBe(CLAUDE_CODE_TRAITS);
  expect(claude.supportsBeforeToolDeny).toBe(false);
  expect(claude.denyEligibleTools).toEqual([]);
}

function payloadWithoutEventNameGetsLegacyTraits(): void {
  expect(deriveHostTraits(parseHookPayload(''))).toBe(CLAUDE_CODE_TRAITS);
  expect(deriveHostTraits(parseHookPayload('{"prompt":"hi"}'))).toBe(CLAUDE_CODE_TRAITS);
}

/**
 * REQ-AGENTADAPT-003/004 — modules allowed to name a host. Every entry needs
 * a reason; an entry with no remaining matches is fine (004.A2).
 */
export const HOST_SPECIFIC_ALLOWLIST: Record<string, string> = {
  'src/installer/': 'install targets write each host\'s own config files (the per-host adapter)',
  'src/activation/hook-output.ts': 'the hook I/O adapter — the single source of host traits',
  'src/analytics/': 'Claude transcript analytics; per-host ingest is uncontracted (2026-09 pivot, phase D)',
  'src/db/migrations.ts': 'schema for the Claude transcript analytics tables',
  'src/claudemd/': 'CLAUDE.md governance audit — Claude-specific per GEMINI-TARGET-DOC',
  'src/reflect/': 'reflection lanes propose Claude hook/settings edits; host-parameterizing them is separate work',
};

const HOST_SPECIFIC = /mcp__specship__|['"`](UserPromptSubmit|PreToolUse|PostToolUse|BeforeAgent|BeforeTool|AfterTool)['"`]/;

function listTs(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listTs(p));
    else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Offending `file:line` hits in `src/` outside the allowlist; comment lines excluded. */
export function findHostSpecificViolations(repoRoot: string, allow = HOST_SPECIFIC_ALLOWLIST): string[] {
  const hits: string[] = [];
  for (const file of listTs(path.join(repoRoot, 'src'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (Object.keys(allow).some((prefix) => rel === prefix || rel.startsWith(prefix))) continue;
    fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
      if (HOST_SPECIFIC.test(line)) hits.push(`${rel}:${i + 1}: ${code}`);
    });
  }
  return hits;
}

function sharedCodeHasNoHostSpecificNames(): void {
  const repoRoot = path.join(__dirname, '..');
  expect(findHostSpecificViolations(repoRoot)).toEqual([]);
  for (const [prefix, reason] of Object.entries(HOST_SPECIFIC_ALLOWLIST)) {
    expect(reason.trim().length, `allowlist entry ${prefix} needs a reason`).toBeGreaterThan(10);
  }
  // The guard actually fires: a planted hard-coded name in a shared module is caught.
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'agentadapt-guard-'));
  try {
    fs.mkdirSync(path.join(fake, 'src', 'activation'), { recursive: true });
    fs.writeFileSync(
      path.join(fake, 'src', 'activation', 'new-hook.ts'),
      "// mentions 'UserPromptSubmit' in a comment — allowed\nexport const ev = 'UserPromptSubmit';\n",
    );
    expect(findHostSpecificViolations(fake)).toEqual([
      "src/activation/new-hook.ts:2: export const ev = 'UserPromptSubmit';",
    ]);
  } finally {
    fs.rmSync(fake, { recursive: true, force: true });
  }
}

describe('agent-adapter layer (AGENTADAPT-DOC)', () => {
  it('Claude steering text stays byte-identical (REQ-AGENTADAPT-001.A1)', claudeSteeringTextIsByteIdentical);
  it('Gemini steering names the bare specship_explore (REQ-AGENTADAPT-001.A2)', geminiSteeringNamesTheBareTool);
  it('the lite tier follows the host tool form too (REQ-AGENTADAPT-001.A3)', liteTierFollowsTheHostToolForm);
  it('host traits come only from the adapter (REQ-AGENTADAPT-002.A1)', traitsComeOnlyFromTheAdapter);
  it('a payload without an event name gets the legacy traits (REQ-AGENTADAPT-002.A2)', payloadWithoutEventNameGetsLegacyTraits);
  it('shared code names no host outside the allowlist (REQ-AGENTADAPT-003.A1)', sharedCodeHasNoHostSpecificNames);
});
