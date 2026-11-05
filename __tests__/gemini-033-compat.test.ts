/**
 * Gemini CLI 0.33.0+ compatibility (REQ-AGENTSWITCH-018, specs/agent-switch.md).
 *
 * Gemini CLI 0.33.0 renamed MCP tools to `mcp_<server>_<tool>`, moved
 * sessions to JSON Lines under a project-name folder, and turned folder trust
 * on by default. The version probe is pinned through `SPECSHIP_GEMINI_VERSION`;
 * HOME / CWD are redirected to tmpdirs. The real-binary check (A5) is
 * `scripts/e2e/gemini-switch.sh` and `scripts/e2e/gemini-model-loop.sh`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openMemoryDb } from './helpers/memory-db';
import { ingestAll } from '../server/src/ingest/ingestor';
import type { IngestDb } from '../server/src/ingest/ingestor';
import { geminiProjectHash, geminiTranscriptAdapter, parseGeminiSession } from '../server/src/ingest/transcripts/gemini';
import { specshipToolPrefix } from '../src/analytics/canonical-tools';
import { CANONICAL_TOOLS } from '../src/analytics/canonical-tools';
import { GEMINI_FOLDER_TRUST_NOTE, geminiAgentsDir, geminiTarget, renderGeminiExplorerAgent } from '../src/installer/targets/gemini';
import { geminiHeadlessAgent, translateGeminiTools } from '../src/workflows/agents/gemini';
import { geminiMcpToolName } from '../src/workflows/agents/gemini-version';
import { buildSearchIntercept } from '../src/activation/search-intercept';
import { GEMINI_CLI_TRAITS } from '../src/activation/hook-output';
import type { PromptNode } from '../src/workflows/schemas/workflow';

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf-8');
const ENV_KEYS = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SPECSHIP_GEMINI_VERSION'] as const;

/**
 * Gemini CLI's own `isValidToolName` for an MCP name, per version:
 * 0.33.0+ (tools/tool-names, verified in 0.67.0) and 0.28.0–0.32.x
 * (`<server>__<tool>`, verified in 0.28.0 and 0.32.1).
 */
function validMcpName(name: string, version: '0.28' | '0.67'): boolean {
  if (version === '0.67') {
    if (!name.startsWith('mcp_') || name.startsWith('mcp__')) return false;
    const m = /^([^_]+)_(.+)$/.exec(name.slice('mcp_'.length));
    return !!m && /^[a-z0-9_.:-]+$/i.test(m[1]!) && !/^_*$/.test(m[2]!);
  }
  return /^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(name) && !name.startsWith('mcp_');
}

const toolsOf = (agent: string): string[] =>
  agent.split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));

let tmpHome: string;
let tmpCwd: string;
let origCwd: string;
let prevEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini033-home-'));
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini033-cwd-'));
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, '.config');
  process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  origCwd = process.cwd();
  process.chdir(tmpCwd);
});

afterEach(() => {
  process.chdir(origCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

describe('Gemini CLI 0.33.0+ compatibility (REQ-AGENTSWITCH-018)', () => {
  it('REQ-AGENTSWITCH-018.A1 the subagent lists the installed version’s tool names', reqAgentswitch018A1);
  it('REQ-AGENTSWITCH-018.A2 a JSON Lines session ingests', reqAgentswitch018A2);
  it('REQ-AGENTSWITCH-018.A2 a session written by the real Gemini CLI 0.67.0 ingests', reqAgentswitch018A2RealSession);
  it('REQ-AGENTSWITCH-018.A3 workflow steps pass mcp_specship_<tool> on 0.33.0+', reqAgentswitch018A3);
  it('REQ-AGENTSWITCH-018.A4 install names folder trust and never writes it', reqAgentswitch018A4);
  it('REQ-AGENTSWITCH-018.A6 the subagents-off note is for Gemini CLI < 0.36.0 only', reqAgentswitch018A6);
});

function reqAgentswitch018A1(): void {
  process.env.SPECSHIP_GEMINI_VERSION = '0.33.0';
  const current = renderGeminiExplorerAgent();
  expect(current).toContain('  - mcp_specship_specship_explore');
  expect(toolsOf(current).every((t) => validMcpName(t, '0.67'))).toBe(true);

  process.env.SPECSHIP_GEMINI_VERSION = '0.32.1';
  const legacy = renderGeminiExplorerAgent();
  expect(legacy).toContain('  - specship__specship_explore');
  expect(toolsOf(legacy).every((t) => validMcpName(t, '0.28'))).toBe(true);

  // Neither form passes the other version's validator, so the gate matters.
  expect(validMcpName('specship__specship_explore', '0.67')).toBe(false);
  expect(validMcpName('mcp_specship_specship_explore', '0.28')).toBe(false);

  // Unknown version → the current form.
  expect(geminiMcpToolName('specship', 'specship_explore', null)).toBe('mcp_specship_specship_explore');

  // What install writes is the same render.
  process.env.SPECSHIP_GEMINI_VERSION = '0.67.0';
  geminiTarget.install('local', { autoAllow: false });
  const written = fs.readFileSync(path.join(geminiAgentsDir('local'), 'specship-explorer.md'), 'utf-8');
  expect(written).toContain('  - mcp_specship_specship_explore');
  expect(written).not.toContain('specship__');
}

/** A 0.67.0-shaped session: header, messages, a re-written message, a `$patch`, a `$set`. */
function jsonlSession(projectRoot: string): string {
  const lines: unknown[] = [
    { sessionId: 'g067-session', projectHash: geminiProjectHash(projectRoot), startTime: '2026-11-06T09:00:00.000Z', lastUpdated: '2026-11-06T09:00:00.000Z', kind: 'main' },
    { id: 'u1', timestamp: '2026-11-06T09:00:01.000Z', type: 'user', content: [{ text: 'how does sync work?' }] },
    {
      id: 'g1', timestamp: '2026-11-06T09:00:02.000Z', type: 'gemini', content: '', model: 'gemini-3.5-flash',
      toolCalls: [{ id: 'tc1', name: 'mcp_specship_specship_explore', args: { query: 'sync' }, result: null, status: 'executing', timestamp: '2026-11-06T09:00:02.000Z' }],
    },
    // The same message written again — last one for an id wins, counted once.
    {
      id: 'g1', timestamp: '2026-11-06T09:00:02.000Z', type: 'gemini', content: 'Here is the flow.', model: 'gemini-3.5-flash',
      tokens: { input: 120, output: 30, cached: 20, thoughts: 5 },
      toolCalls: [
        { id: 'tc1', name: 'mcp_specship_specship_explore', args: { query: 'sync' }, result: null, status: 'success', timestamp: '2026-11-06T09:00:02.000Z' },
        { id: 'tc2', name: 'read_file', args: { file_path: 'src/sync/index.ts' }, result: [{ functionResponse: { response: { output: 'export {}' } } }], status: 'success', timestamp: '2026-11-06T09:00:03.000Z' },
      ],
    },
    { $patch: { id: 'g1', toolCalls: [{ id: 'tc1', result: [{ functionResponse: { response: { output: '## src/sync/index.ts ...' } } }] }] } },
    { $set: { lastUpdated: '2026-11-06T09:00:05.000Z', summary: 'sync flow' } },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function reqAgentswitch018A2(): void {
  const project = '/tmp/g067-project';
  const root = path.join(tmpHome, 'gemini-tmp');
  // 0.33.0+ names the folder after the project, not its hash.
  const chats = path.join(root, 'g067-project', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const file = path.join(chats, 'session-2026-11-06T09-00-g067sess.jsonl');
  fs.writeFileSync(file, jsonlSession(project), 'utf-8');
  expect(geminiTranscriptAdapter.watches(file)).toBe(true);

  const db = openMemoryDb() as unknown as IngestDb;
  db.exec(SCHEMA);
  const stats = ingestAll(db, { roots: { gemini: root }, projectPaths: [project] });
  expect(stats.errors).toBe(0);
  expect(stats.filesUnreadable).toBe(0);

  const rows = db
    .prepare(`SELECT tool_use_id, raw_tool_name, tool_name, is_specship, result_length FROM claude_tool_calls ORDER BY tool_use_id`)
    .all() as Array<{ tool_use_id: string; raw_tool_name: string; tool_name: string; is_specship: number; result_length: number }>;
  expect(rows.map((r) => [r.raw_tool_name, r.tool_name, r.is_specship])).toEqual([
    ['mcp_specship_specship_explore', `${specshipToolPrefix}specship_explore`, 1],
    ['read_file', CANONICAL_TOOLS.read, 0],
  ]);
  // The `$patch` set the explore call's result.
  expect(rows[0]!.result_length).toBeGreaterThan(0);

  const session = db.prepare(`SELECT project_path, prompt_count, last_model FROM claude_sessions`).get();
  expect(session).toEqual({ project_path: project, prompt_count: 1, last_model: 'gemini-3.5-flash' });

  // A header-only file (a session just started) is an empty session, not unreadable.
  const headerOnly = parseGeminiSession(jsonlSession(project).split('\n')[0]!);
  expect(headerOnly?.sessionId).toBe('g067-session');
  expect(headerOnly?.prompts).toEqual([]);

  // The search intercept reads the same file: a SpecShip call was made, so no nudge.
  const projectDir = path.join(tmpCwd, 'p');
  fs.mkdirSync(path.join(projectDir, '.specship'), { recursive: true });
  const base = { cwd: projectDir, env: {}, traits: GEMINI_CLI_TRAITS, denyEligible: true };
  expect(buildSearchIntercept({ ...base, sessionId: 's-used', transcriptPath: file })).toBeNull();
  const unused = path.join(chats, 'session-unused.jsonl');
  fs.writeFileSync(unused, jsonlSession(project).replace(/mcp_specship_specship_explore/g, 'glob'), 'utf-8');
  expect(buildSearchIntercept({ ...base, sessionId: 's-unused', transcriptPath: unused })).not.toBeNull();
}

/** The real thing: a session Gemini CLI 0.67.0 wrote in scripts/e2e/gemini-model-loop.sh (paths scrubbed to /tmp/g067). */
function reqAgentswitch018A2RealSession(): void {
  const project = '/tmp/g067/project';
  const root = path.join(tmpHome, 'gemini-tmp');
  const chats = path.join(root, 'project', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'transcripts', 'gemini-session-0.67.jsonl'), path.join(chats, 'session-2026-11-05T22-30-d3b8e1bd.jsonl'));

  const db = openMemoryDb() as unknown as IngestDb;
  db.exec(SCHEMA);
  const stats = ingestAll(db, { roots: { gemini: root }, projectPaths: [project] });
  expect(stats.errors).toBe(0);
  expect(stats.filesUnreadable).toBe(0);
  const calls = db.prepare(`SELECT raw_tool_name, is_specship, result_length FROM claude_tool_calls`).all() as Array<{ raw_tool_name: string; is_specship: number; result_length: number }>;
  expect(calls.map((c) => [c.raw_tool_name, c.is_specship])).toEqual([['mcp_specship_specship_explore', 1]]);
  expect(calls[0]!.result_length).toBeGreaterThan(0);
  // Gemini's own context turn and the tool response open no prompt; the prompt text is what the user typed.
  const prompts = db.prepare(`SELECT text FROM claude_prompts`).all() as Array<{ text: string }>;
  expect(prompts).toEqual([{ text: 'Where is renderScene defined and what does it call?' }]);
  expect(db.prepare(`SELECT project_path FROM claude_sessions`).get()).toEqual({ project_path: project });
}

function reqAgentswitch018A3(): void {
  expect(translateGeminiTools(['specship_explore', 'mcp__specship__specship_spec', 'Read'], '0.67.0')).toEqual({
    tools: ['mcp_specship_specship_explore', 'mcp_specship_specship_spec', 'read_file'],
  });
  expect(translateGeminiTools(['specship_explore'], '0.32.1')).toEqual({ tools: ['specship__specship_explore'] });

  process.env.SPECSHIP_GEMINI_VERSION = '0.67.0';
  const node = { id: 'n', kind: 'prompt', prompt: 'p', allowed_tools: ['specship_spec', 'Read'] } as unknown as PromptNode;
  const inv = geminiHeadlessAgent.build(node, {}, {});
  if ('error' in inv) throw new Error(inv.error);
  const at = inv.args.indexOf('--allowed-tools');
  expect(inv.args.slice(at + 1)).toEqual(['mcp_specship_specship_spec', 'read_file']);
}

function reqAgentswitch018A4(): void {
  process.env.SPECSHIP_GEMINI_VERSION = '0.67.0';
  for (const loc of ['local', 'global'] as const) {
    const notes = geminiTarget.install(loc, { autoAllow: false }).notes ?? [];
    const trustLines = notes.join('\n').split('\n').filter((l) => /trust this folder/.test(l));
    expect(trustLines).toEqual([GEMINI_FOLDER_TRUST_NOTE]);
  }
  // An automatic switch appends the same line.
  expect(geminiTarget.switchNote).toBe(GEMINI_FOLDER_TRUST_NOTE);
  // SpecShip never trusts a folder for the user.
  expect(fs.existsSync(path.join(tmpHome, '.gemini', 'trustedFolders.json'))).toBe(false);
}

function reqAgentswitch018A6(): void {
  const agentNote = (version: string): boolean => {
    process.env.SPECSHIP_GEMINI_VERSION = version;
    return (geminiTarget.install('local', { autoAllow: false }).notes ?? []).some((n) => n.includes('experimental.enableAgents'));
  };
  expect(agentNote('0.35.0')).toBe(true);
  expect(agentNote('0.36.0')).toBe(false);
  expect(agentNote('0.67.0')).toBe(false);
}
