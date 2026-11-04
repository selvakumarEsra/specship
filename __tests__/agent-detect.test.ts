/**
 * REQ-AGENTSWITCH-007 — detect which agent SpecShip is running under, from
 * the MCP client name, the hook payload's event name, and the launcher
 * environment variables. Anything unmatched (or ambiguous) is "unknown".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { agentFromMcpClient, agentFromHookEvent, agentFromEnv, UNKNOWN_AGENT } from '../src/agents/detect';
import { detectHookAgent, parseHookPayload } from '../src/activation/hook-output';
import { MCPSession } from '../src/mcp/session';
import type { JsonRpcTransport } from '../src/mcp/transport';
import type { MCPEngine } from '../src/mcp/engine';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');

/** In-memory transport: captures the handler so the test can feed messages. */
function fakeTransport() {
  let handler: ((m: any) => Promise<void> | void) | null = null;
  const results: unknown[] = [];
  const t: JsonRpcTransport = {
    start: (h) => { handler = h as any; },
    stop: () => {},
    send: () => {},
    notify: () => {},
    request: async () => ({}),
    sendResult: (_id, r) => { results.push(r); },
    sendError: () => {},
  };
  return { t, results, deliver: async (m: unknown) => { await handler!(m); } };
}

const fakeEngine = {
  getToolHandler: () => ({ addTierChangeListener: () => () => {} }),
  ensureInitialized: async () => {},
} as unknown as MCPEngine;

async function detectViaSession(clientInfo: unknown): Promise<string> {
  const { t, results, deliver } = fakeTransport();
  const session = new MCPSession(t, fakeEngine);
  session.start();
  await deliver({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo },
  });
  expect(results).toHaveLength(1); // the handshake reply is unchanged
  const agent = session.getDetectedAgent();
  session.stop();
  return agent;
}

async function reqAgentswitch007A1(): Promise<void> {
  expect(agentFromMcpClient({ name: 'gemini-cli-mcp-client' })).toBe('gemini');
  expect(agentFromMcpClient({ name: 'claude-code' })).toBe('claude');
  expect(agentFromMcpClient({ name: 'cursor' })).toBe(UNKNOWN_AGENT);
  expect(agentFromMcpClient({ name: 42 })).toBe(UNKNOWN_AGENT);
  expect(agentFromMcpClient({})).toBe(UNKNOWN_AGENT);
  expect(agentFromMcpClient(undefined)).toBe(UNKNOWN_AGENT);

  expect(await detectViaSession({ name: 'gemini-cli-mcp-client', version: '0.28.0' })).toBe('gemini');
  expect(await detectViaSession({ name: 'claude-code', version: '2.1.318' })).toBe('claude');
  expect(await detectViaSession({ name: 'test', version: '0.0.0' })).toBe(UNKNOWN_AGENT);
  expect(await detectViaSession(undefined)).toBe(UNKNOWN_AGENT);
}

function runStatusJson(cwd: string, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const stdout = execFileSync(process.execPath, [BIN, 'status', '--json'], {
    cwd,
    encoding: 'utf-8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = stdout.trim().split('\n').filter(Boolean).pop()!;
  return JSON.parse(line);
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, SPECSHIP_NO_DAEMON: '1' };
  delete env.CLAUDECODE;
  delete env.GEMINI_CLI;
  return env;
}

describe('REQ-AGENTSWITCH-007 — current-agent detection', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-agent-detect-')); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it('REQ-AGENTSWITCH-007.A1 — MCP initialize client name maps to Gemini / Claude Code / unknown', reqAgentswitch007A1);

  async function reqAgentswitch007A2(): Promise<void> {
    expect(agentFromEnv({ GEMINI_CLI: '1' })).toBe('gemini');
    expect(agentFromEnv({ CLAUDECODE: '1' })).toBe('claude');
    expect(agentFromEnv({})).toBe(UNKNOWN_AGENT);
    expect(agentFromEnv({ GEMINI_CLI: '1', CLAUDECODE: '1' })).toBe(UNKNOWN_AGENT);

    const gemini = runStatusJson(tempDir, { ...cleanEnv(), GEMINI_CLI: '1' });
    expect(gemini.currentAgent).toBe('gemini');
    const none = runStatusJson(tempDir, cleanEnv());
    expect(none.currentAgent).toBe(UNKNOWN_AGENT);
  }
  it('REQ-AGENTSWITCH-007.A2 — specship status with GEMINI_CLI=1 reports Gemini as the current agent', reqAgentswitch007A2);

  function reqAgentswitch007A3(): void {
    const sessionStart = parseHookPayload(JSON.stringify({ hook_event_name: 'SessionStart', cwd: '/x' }));
    expect(detectHookAgent(sessionStart)).toBe(UNKNOWN_AGENT);
    expect(detectHookAgent(parseHookPayload('{}'))).toBe(UNKNOWN_AGENT);
    expect(agentFromHookEvent('SessionStart')).toBe(UNKNOWN_AGENT);
    expect(agentFromHookEvent(undefined)).toBe(UNKNOWN_AGENT);
    expect(agentFromHookEvent('SomethingElse')).toBe(UNKNOWN_AGENT);

    expect(detectHookAgent(parseHookPayload(JSON.stringify({ hook_event_name: 'BeforeAgent' })))).toBe('gemini');
    expect(detectHookAgent(parseHookPayload(JSON.stringify({ hook_event_name: 'UserPromptSubmit' })))).toBe('claude');
    expect(agentFromHookEvent('AfterTool')).toBe('gemini');
    expect(agentFromHookEvent('PreToolUse')).toBe('claude');
  }
  it('REQ-AGENTSWITCH-007.A3 — a SessionStart payload alone proves neither agent', reqAgentswitch007A3);
});
