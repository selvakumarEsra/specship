/**
 * AGENTADAPT-DOC REQ-AGENTADAPT-005/006/007 — workflow prompt steps run through
 * a per-host headless-agent adapter. Claude Code's arguments are unchanged; the
 * agent is chosen deterministically and stored on the run; the Gemini CLI
 * adapter translates a step faithfully or refuses it.
 *
 * Gemini stream lines below are the event shapes from the installed
 * @google/gemini-cli-core 0.28.0 `output/types.d.ts` (DOM-SPECSHIP-008) — no
 * live Gemini run is made here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SpecShip from '../src';
import { WorkflowExecutor } from '../src/workflows/executor';
import { WorktreeProvider } from '../src/isolation/worktree';
import { PromptRunner } from '../src/workflows/runners/prompt';
import { discoverWorkflows } from '../src/workflows/discovery';
import {
  RUN_AGENT_KEY,
  UnknownWorkflowAgentError,
  getHeadlessAgent,
  resolveWorkflowAgent,
} from '../src/workflows/agents';
import { buildClaudeArgs } from '../src/workflows/agents/claude';
import { geminiHeadlessAgent, handleGeminiStreamLine, translateGeminiTools } from '../src/workflows/agents/gemini';
import { newStreamState } from '../src/workflows/agents/types';
import type { PromptNode, WorkflowDefinition } from '../src/workflows/schemas/workflow';
import type { NodeRunner, RunnerContext } from '../src/workflows/runners/types';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-agents-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const FULL_STEP: PromptNode = {
  id: 'implement',
  kind: 'prompt',
  prompt: 'Implement the plan.',
  model: 'sonnet',
  allowed_tools: ['Read', 'Write', 'mcp__specship__specship_spec'],
  denied_tools: ['WebFetch'],
  systemPromptAppend: 'Follow house rules.',
};

function writeConfig(workflow: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, 'specship.config.json'), JSON.stringify({ workflow }));
}

// ---------------------------------------------------------------------------
// REQ-AGENTADAPT-005

function claudeArgsAreUnchanged(): void {
  // The exact list the pre-adapter runner built for this step.
  expect(buildClaudeArgs(FULL_STEP)).toEqual([
    '--print',
    '--output-format', 'stream-json', '--verbose',
    '--model', 'sonnet',
    '--allowed-tools', 'Read,Write,mcp__specship__specship_spec',
    '--disallowed-tools', 'WebFetch',
    '--append-system-prompt', 'Follow house rules.',
  ]);
  const inv = getHeadlessAgent('claude')!.build(FULL_STEP, {}, { SPECSHIP_CLAUDE_BIN: '/x/claude' });
  expect(inv).toEqual({ bin: '/x/claude', args: buildClaudeArgs(FULL_STEP), stdin: 'Implement the plan.' });
}

/** A fake host binary: records argv + stdin, then prints the given stream lines. */
function fakeBin(name: string, lines: object[]): string {
  const bin = path.join(dir, name);
  const record = path.join(dir, `${name}.record.json`);
  fs.writeFileSync(
    bin,
    `#!${process.execPath}\n` +
      `let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{` +
      `require('fs').writeFileSync(${JSON.stringify(record)},JSON.stringify({argv:process.argv.slice(2),stdin:input}));` +
      `process.stdout.write('not json — a host diagnostic\\n');` +
      `for(const l of ${JSON.stringify(lines)})process.stdout.write(JSON.stringify(l)+'\\n');});\n`,
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function ctxFor(agent: string, events: Array<{ type: string; data?: Record<string, unknown> }> = []): RunnerContext {
  return {
    cwd: dir,
    artifactsDir: dir,
    logsDir: dir,
    runId: 'r1',
    outputs: new Map(),
    agent,
    emitEvent: (type, data) => events.push({ type, data }),
  };
}

async function promptRunnerUsesTheRunAgent(): Promise<void> {
  const step: PromptNode = { id: 's', kind: 'prompt', prompt: 'Say done.', allowed_tools: ['Read'] };
  const claude = fakeBin('claude', [
    { type: 'system', model: 'claude-x' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
    { type: 'result', result: 'done', duration_ms: 5 },
  ]);
  const gemini = fakeBin('gemini', [
    { type: 'init', session_id: 's1', model: 'gemini-x', timestamp: 't' },
    { type: 'message', role: 'user', content: 'Say done.', timestamp: 't' },
    { type: 'message', role: 'assistant', content: 'do', delta: true, timestamp: 't' },
    { type: 'message', role: 'assistant', content: 'ne', delta: true, timestamp: 't' },
    { type: 'result', status: 'success', stats: { duration_ms: 7 }, timestamp: 't' },
  ]);
  const prev = { c: process.env.SPECSHIP_CLAUDE_BIN, g: process.env.SPECSHIP_GEMINI_BIN };
  process.env.SPECSHIP_CLAUDE_BIN = claude;
  process.env.SPECSHIP_GEMINI_BIN = gemini;
  try {
    const runner = new PromptRunner();
    const viaClaude = await runner.run(step, ctxFor('claude'));
    const viaGemini = await runner.run(step, ctxFor('gemini'));
    expect(viaClaude.status).toBe('completed');
    expect(viaGemini.status).toBe('completed');
    if (viaClaude.status !== 'completed' || viaGemini.status !== 'completed') return;
    expect(viaClaude.output.text).toBe('done');
    expect(viaGemini.output.text).toBe('done');
    expect(viaGemini.stats).toMatchObject({ model: 'gemini-x', durationMs: 7 });
    // Each host got its own translation of the same step.
    const g = JSON.parse(fs.readFileSync(path.join(dir, 'gemini.record.json'), 'utf8'));
    expect(g.argv).toEqual(['--output-format', 'stream-json', '--allowed-tools', 'read_file']);
    expect(g.stdin).toBe('Say done.');
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'claude.record.json'), 'utf8'));
    expect(c.argv[0]).toBe('--print');
  } finally {
    if (prev.c === undefined) delete process.env.SPECSHIP_CLAUDE_BIN;
    else process.env.SPECSHIP_CLAUDE_BIN = prev.c;
    if (prev.g === undefined) delete process.env.SPECSHIP_GEMINI_BIN;
    else process.env.SPECSHIP_GEMINI_BIN = prev.g;
  }
}

// ---------------------------------------------------------------------------
// REQ-AGENTADAPT-006

function agentResolutionOrder(): void {
  writeConfig({ agent: 'claude' });
  const env = { SPECSHIP_WORKFLOW_AGENT: 'gemini', CLAUDECODE: '1' };
  expect(resolveWorkflowAgent({ flag: 'claude', env, projectRoot: dir })).toBe('claude'); // flag wins
  expect(resolveWorkflowAgent({ env, projectRoot: dir })).toBe('gemini'); // then env
  expect(resolveWorkflowAgent({ env: { GEMINI_CLI: '1' }, projectRoot: dir })).toBe('claude'); // then config, over the launcher
  fs.rmSync(path.join(dir, 'specship.config.json'));
  expect(resolveWorkflowAgent({ env: { GEMINI_CLI: '1' }, projectRoot: dir })).toBe('gemini'); // then the launcher
  expect(resolveWorkflowAgent({ env: {}, projectRoot: dir })).toBe('claude'); // then Claude Code
}

function launchingHostIsDetected(): void {
  expect(resolveWorkflowAgent({ env: { GEMINI_CLI: '1' }, projectRoot: dir })).toBe('gemini');
  expect(resolveWorkflowAgent({ env: { CLAUDECODE: '1' }, projectRoot: dir })).toBe('claude');
}

function unknownAgentFailsBeforeAnyStep(): void {
  expect(() => resolveWorkflowAgent({ flag: 'codex', env: {}, projectRoot: dir })).toThrow(UnknownWorkflowAgentError);
  expect(() => resolveWorkflowAgent({ flag: 'codex', env: {}, projectRoot: dir })).toThrow(/Known agents: claude, gemini/);
  writeConfig({ agent: 'cursor' });
  expect(() => resolveWorkflowAgent({ env: {}, projectRoot: dir })).toThrow(/workflow\.agent/);
}

async function missingBinaryNamesTheOverride(): Promise<void> {
  const prev = process.env.SPECSHIP_GEMINI_BIN;
  process.env.SPECSHIP_GEMINI_BIN = path.join(dir, 'no-such-gemini');
  try {
    const r = await new PromptRunner().run({ id: 's', kind: 'prompt', prompt: 'x' }, ctxFor('gemini'));
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error).toMatch(/no-such-gemini not found on PATH/);
    expect(r.error).toMatch(/--agent/);
    expect(r.transient).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.SPECSHIP_GEMINI_BIN;
    else process.env.SPECSHIP_GEMINI_BIN = prev;
  }
}

async function agentIsRecordedOnTheRun(): Promise<void> {
  const cg = await SpecShip.init(dir);
  try {
    const sq = cg.getSpecQueries();
    const executor = new WorkflowExecutor(sq, new WorktreeProvider(sq));
    const seen: Array<string | undefined> = [];
    const stub: NodeRunner = {
      kind: 'prompt',
      run: async (_node, ctx) => {
        seen.push(ctx.agent);
        return { status: 'completed', output: { text: 'ok' } };
      },
    };
    (executor as unknown as { runners: Map<string, NodeRunner> }).runners.set('prompt', stub);
    const wf: WorkflowDefinition = {
      name: 'agent-probe',
      nodes: [
        { id: 'plan', kind: 'prompt', prompt: 'plan' },
        { id: 'gate', kind: 'approval', message: 'ok?', depends_on: ['plan'] },
        { id: 'implement', kind: 'prompt', prompt: 'build', depends_on: ['gate'] },
      ],
    } as WorkflowDefinition;

    const { run } = await executor.start(wf, { projectRoot: dir, agent: 'gemini' });
    expect((sq.getWorkflowRunById(run.id)!.metadata as Record<string, unknown>)[RUN_AGENT_KEY]).toBe('gemini');
    expect(sq.getWorkflowRunById(run.id)!.status).toBe('paused');

    // Resumed from a shell that would pick another agent: the stored one wins.
    const prev = process.env.SPECSHIP_WORKFLOW_AGENT;
    process.env.SPECSHIP_WORKFLOW_AGENT = 'claude';
    try {
      executor.approve(run.id);
      await executor.resume(wf, run.id, { projectRoot: dir });
    } finally {
      if (prev === undefined) delete process.env.SPECSHIP_WORKFLOW_AGENT;
      else process.env.SPECSHIP_WORKFLOW_AGENT = prev;
    }
    expect(seen).toEqual(['gemini', 'gemini']);
  } finally {
    cg.close();
  }
}

// ---------------------------------------------------------------------------
// REQ-AGENTADAPT-007

function geminiToolsAreTranslated(): void {
  expect(
    translateGeminiTools(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'mcp__specship__specship_spec', 'Bash(git status:*)']),
  ).toEqual({
    tools: ['read_file', 'write_file', 'replace', 'run_shell_command', 'glob', 'grep_search', 'specship__specship_spec', 'run_shell_command(git status)'],
  });
  // Every prompt step of every bundled workflow translates (no step is refused on Gemini).
  const refused: string[] = [];
  let checked = 0;
  for (const { workflow } of discoverWorkflows(dir).workflows) {
    for (const node of workflow.nodes) {
      if (node.kind !== 'prompt') continue;
      checked++;
      const inv = geminiHeadlessAgent.build(node as PromptNode, {}, {});
      if ('error' in inv) refused.push(`${workflow.name}/${node.id}: ${inv.error}`);
    }
  }
  expect(checked).toBeGreaterThan(10);
  expect(refused).toEqual([]);
}

function geminiSystemPromptLeadsTheStdin(): void {
  const { denied_tools: _d, ...step } = FULL_STEP;
  const inv = geminiHeadlessAgent.build(step as PromptNode, {}, {});
  if ('error' in inv) throw new Error(inv.error);
  expect(inv.stdin.indexOf('Follow house rules.')).toBe(0);
  expect(inv.stdin.indexOf('Implement the plan.')).toBeGreaterThan(inv.stdin.indexOf('Follow house rules.'));
  expect(inv.args.join(' ')).not.toMatch(/system-prompt/);
}

function geminiModelTiersMapThroughConfig(): void {
  const step = (model: string): PromptNode => ({ id: 's', kind: 'prompt', prompt: 'x', model });
  const args = (model: string, models?: Record<string, string>) => {
    const inv = geminiHeadlessAgent.build(step(model), { models }, {});
    if ('error' in inv) throw new Error(inv.error);
    return inv.args;
  };
  expect(args('haiku', { haiku: 'gemini-flash-lite-x' })).toEqual(['--output-format', 'stream-json', '--model', 'gemini-flash-lite-x']);
  expect(args('haiku')).not.toContain('--model'); // no mapping → Gemini's default
  expect(args('claude-opus-5-5', { opus: 'gemini-pro-x' })).not.toContain('--model'); // Claude id never passed
  expect(args('gemini-pro-x')).toContain('gemini-pro-x');
}

function geminiUntranslatableStepFails(): void {
  const denied = geminiHeadlessAgent.build(FULL_STEP, {}, {});
  expect(denied).toEqual({ error: expect.stringMatching(/denied_tools \(WebFetch\)/) });
  const unknown = geminiHeadlessAgent.build({ id: 's', kind: 'prompt', prompt: 'x', allowed_tools: ['Read', 'NotebookEdit'] }, {}, {});
  expect(unknown).toEqual({ error: expect.stringMatching(/"NotebookEdit" has no Gemini CLI equivalent/) });
}

async function geminiStreamIsParsed(): Promise<void> {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const state = newStreamState();
  const lines = [
    { type: 'init', session_id: 's', model: 'gemini-x', timestamp: 't' },
    { type: 'tool_use', tool_name: 'read_file', tool_id: '1', parameters: { file_path: 'src/a.ts' }, timestamp: 't' },
    { type: 'tool_result', tool_id: '1', status: 'success', timestamp: 't' },
    { type: 'message', role: 'assistant', content: 'Read it.', timestamp: 't' },
    { type: 'message', role: 'assistant', content: 'Done.', timestamp: 't' },
    { type: 'result', status: 'success', stats: { duration_ms: 42 }, timestamp: 't' },
  ];
  for (const l of lines) handleGeminiStreamLine(JSON.stringify(l), (type, data) => events.push({ type, data }), state);
  expect(events).toEqual([
    { type: 'tool_called', data: { name: 'read_file', input: 'src/a.ts' } },
    { type: 'agent_message', data: { text: 'Read it.' } },
    { type: 'agent_message', data: { text: 'Done.' } },
  ]);
  expect(state).toMatchObject({ sawStream: true, assistantText: 'Read it.\nDone.', model: 'gemini-x', durationMs: 42 });
  expect(state.failure).toBeUndefined();

  // An error result fails the step through the runner.
  const failing = fakeBin('gemini-err', [
    { type: 'init', session_id: 's', model: 'gemini-x', timestamp: 't' },
    { type: 'result', status: 'error', error: { type: 'Quota', message: 'quota exceeded' }, timestamp: 't' },
  ]);
  const prev = process.env.SPECSHIP_GEMINI_BIN;
  process.env.SPECSHIP_GEMINI_BIN = failing;
  try {
    const r = await new PromptRunner().run({ id: 's', kind: 'prompt', prompt: 'x' }, ctxFor('gemini'));
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.error).toMatch(/quota exceeded/);
  } finally {
    if (prev === undefined) delete process.env.SPECSHIP_GEMINI_BIN;
    else process.env.SPECSHIP_GEMINI_BIN = prev;
  }
}

describe('headless-agent adapters (REQ-AGENTADAPT-005)', () => {
  it('Claude Code gets exactly the pre-adapter arguments (REQ-AGENTADAPT-005.A1)', claudeArgsAreUnchanged);
  it.runIf(process.platform !== 'win32')(
    'the runner spawns the run agent and yields the same text on either host (REQ-AGENTADAPT-005.A2)',
    promptRunnerUsesTheRunAgent,
  );
});

describe('workflow agent selection (REQ-AGENTADAPT-006)', () => {
  it('flag > env > config > launching host > Claude Code (REQ-AGENTADAPT-006.A1)', agentResolutionOrder);
  it('a command launched inside Gemini CLI selects Gemini (REQ-AGENTADAPT-006.A2)', launchingHostIsDetected);
  it('the agent is stored on the run and survives resume from another shell (REQ-AGENTADAPT-006.A3)', agentIsRecordedOnTheRun);
  it('an unknown agent fails before a run exists, listing the known ones (REQ-AGENTADAPT-006.A4)', unknownAgentFailsBeforeAnyStep);
  it('a missing binary fails non-transiently, naming the binary and --agent (REQ-AGENTADAPT-006.A5)', missingBinaryNamesTheOverride);
});

describe('Gemini CLI adapter (REQ-AGENTADAPT-007)', () => {
  it('tools translate to Gemini names (REQ-AGENTADAPT-007.A1)', geminiToolsAreTranslated);
  it('the appended system prompt leads the stdin prompt (REQ-AGENTADAPT-007.A2)', geminiSystemPromptLeadsTheStdin);
  it('model tiers map through config; Claude ids are never passed (REQ-AGENTADAPT-007.A3)', geminiModelTiersMapThroughConfig);
  it('an untranslatable step fails before spawning, naming the item (REQ-AGENTADAPT-007.A4)', geminiUntranslatableStepFails);
  it.runIf(process.platform !== 'win32')(
    'stream-json events become step events, text, stats and failures (REQ-AGENTADAPT-007.A5)',
    geminiStreamIsParsed,
  );
});
