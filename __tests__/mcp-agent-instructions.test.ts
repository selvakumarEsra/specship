/**
 * REQ-AGENTSWITCH-002 — agent-facing text names the active agent's tools and
 * files. The MCP `initialize` instructions are chosen from the connecting
 * client: Gemini CLI sees its own read/search tools and `GEMINI.md`; Claude
 * Code and an unknown client get today's text byte for byte. The session
 * cheatsheet follows the same rule.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { MCPSession } from '../src/mcp/session';
import type { JsonRpcTransport } from '../src/mcp/transport';
import type { MCPEngine } from '../src/mcp/engine';
import {
  LITE_SERVER_INSTRUCTIONS,
  SERVER_INSTRUCTIONS,
  renderServerInstructions,
  resolveServerInstructions,
} from '../src/mcp/server-instructions';
import { CLAUDE_CODE_TRAITS, GEMINI_CLI_TRAITS } from '../src/activation/hook-output';
import { CHEATSHEET_TEXT, buildCheatsheetPayload, cheatsheetText } from '../src/activation/cheatsheet';

/** sha256 of the instruction text as shipped before REQ-AGENTSWITCH-002. */
const SHIPPED_FULL_SHA = 'b59ced64020e2731ee340b0b10354525427c1444910a5fa2565bc9ea519eb1b0';
const SHIPPED_LITE_SHA = '8738e69c5ae0d539670bf61ca28f12cfdb34cf63b67644accf12dd5ba0ad4f1d';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function fakeTransport() {
  let handler: ((m: unknown) => Promise<void> | void) | null = null;
  const results: Array<{ instructions?: string }> = [];
  const t: JsonRpcTransport = {
    start: (h) => { handler = h as typeof handler; },
    stop: () => {},
    send: () => {},
    notify: () => {},
    request: async () => ({}),
    sendResult: (_id, r) => { results.push(r as { instructions?: string }); },
    sendError: () => {},
  };
  return { t, results, deliver: async (m: unknown) => { await handler!(m); } };
}

const fakeEngine = {
  getToolHandler: () => ({ addTierChangeListener: () => () => {} }),
  ensureInitialized: async () => {},
} as unknown as MCPEngine;

describe('MCP instructions follow the connecting client (REQ-AGENTSWITCH-002)', () => {
  let tmpHome: string;
  let tmpRoot: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-instr-home-'));
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-instr-root-'));
    prevHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function instructionsFor(clientInfo: unknown): Promise<string> {
    const { t, results, deliver } = fakeTransport();
    const session = new MCPSession(t, fakeEngine);
    session.start();
    await deliver({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo, rootUri: pathToFileURL(tmpRoot).href },
    });
    session.stop();
    return results[0]?.instructions ?? '';
  }

  async function reqAgentswitch002A1(): Promise<void> {
    // Gemini CLI: its own read/search tools and memory file; none of Claude's.
    const gemini = await instructionsFor({ name: 'gemini-cli-mcp-client', version: '0.28.0' });
    for (const name of ['read_file', 'grep_search', 'glob', 'GEMINI.md', 'Gemini CLI']) {
      expect(gemini).toContain(name);
    }
    expect(gemini).not.toMatch(/Read\/Grep|Grep\/Glob\/Read|Read-ing|CLAUDE\.md|Claude Code/);

    // Claude Code and an unknown client: today's text byte for byte.
    expect(await instructionsFor({ name: 'claude-code', version: '2.1.0' })).toBe(SERVER_INSTRUCTIONS);
    expect(await instructionsFor({ name: 'some-other-client' })).toBe(SERVER_INSTRUCTIONS);
    expect(await instructionsFor(undefined)).toBe(SERVER_INSTRUCTIONS);
    expect(sha(SERVER_INSTRUCTIONS)).toBe(SHIPPED_FULL_SHA);
    expect(sha(LITE_SERVER_INSTRUCTIONS)).toBe(SHIPPED_LITE_SHA);

    // Every tier: the default host is untouched, Gemini gets its own names.
    expect(renderServerInstructions('lite')).toBe(LITE_SERVER_INSTRUCTIONS);
    expect(renderServerInstructions('lite', CLAUDE_CODE_TRAITS)).toBe(LITE_SERVER_INSTRUCTIONS);
    expect(renderServerInstructions('full', CLAUDE_CODE_TRAITS)).toBe(SERVER_INSTRUCTIONS);
    const liteGemini = renderServerInstructions('lite', GEMINI_CLI_TRAITS);
    expect(liteGemini).toContain('`grep_search`/`glob`/`read_file`');
    expect(liteGemini).toContain('GEMINI.md');
    expect(liteGemini).not.toMatch(/Grep\/Glob\/Read/);

    // The proxy's handshake path resolves through the same function.
    expect(resolveServerInstructions(null, 'gemini')).toBe(renderServerInstructions('full', GEMINI_CLI_TRAITS));
    expect(resolveServerInstructions(null, 'claude')).toBe(SERVER_INSTRUCTIONS);
    expect(resolveServerInstructions(null)).toBe(SERVER_INSTRUCTIONS);
  }

  it('REQ-AGENTSWITCH-002.A1: Gemini gets its tools and GEMINI.md; Claude/unknown get today\'s text', reqAgentswitch002A1);

  function cheatsheetFollowsHost(): void {
    expect(cheatsheetText()).toBe(CHEATSHEET_TEXT);
    expect(cheatsheetText(CLAUDE_CODE_TRAITS)).toBe(CHEATSHEET_TEXT);
    expect(buildCheatsheetPayload({}, {})?.systemMessage).toBe(CHEATSHEET_TEXT);
    const gemini = buildCheatsheetPayload({}, {}, GEMINI_CLI_TRAITS)?.systemMessage ?? '';
    expect(gemini).toContain('Explore before you read_file/grep_search:');
    expect(gemini).not.toContain('Read/Grep');
  }

  it('REQ-AGENTSWITCH-002: the cheatsheet names the host\'s tools; no host keeps today\'s text', cheatsheetFollowsHost);
});
