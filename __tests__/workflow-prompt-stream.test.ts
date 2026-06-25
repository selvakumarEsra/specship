/**
 * Agent-step stream parsing (WF-STREAM-DOC / REQ-WFSTREAM-001).
 *
 * Pure tests over the prompt runner's stream-json line handler — no spawn.
 */

import { describe, it, expect } from 'vitest';
import {
  handleStreamLine,
  summarizeToolInput,
  newStreamState,
} from '../src/workflows/runners/prompt';
import type { WorkflowEventType } from '../src/types';

function collector() {
  const events: Array<{ type: WorkflowEventType; data?: Record<string, unknown> }> = [];
  return {
    events,
    emit: (type: WorkflowEventType, data?: Record<string, unknown>) => events.push({ type, data }),
  };
}

describe('summarizeToolInput', () => {
  it('picks the salient field and single-lines it', () => {
    expect(summarizeToolInput({ file_path: 'src/x.ts' })).toBe('src/x.ts');
    expect(summarizeToolInput({ command: 'npm  test\n--filter' })).toBe('npm test --filter');
    expect(summarizeToolInput('plain')).toBe('plain');
    expect(summarizeToolInput(null)).toBe('');
  });
  it('truncates long input', () => {
    const out = summarizeToolInput('x'.repeat(300));
    expect(out.length).toBe(141); // 140 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('handleStreamLine (REQ-WFSTREAM-001)', () => {
  it('emits tool_called for a tool_use block', () => {
    const { events, emit } = collector();
    const state = newStreamState();
    handleStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } }),
      emit, state,
    );
    expect(events).toEqual([{ type: 'tool_called', data: { name: 'Read', input: 'a.ts' } }]);
    expect(state.sawStream).toBe(true);
  });

  it('emits agent_message for a text turn (full text) and accumulates it', () => {
    const { events, emit } = collector();
    const state = newStreamState();
    handleStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Planning the change.' }] } }),
      emit, state,
    );
    expect(events).toEqual([{ type: 'agent_message', data: { text: 'Planning the change.' } }]);
    expect(state.assistantText).toBe('Planning the change.');
  });

  it('does NOT emit for thinking blocks', () => {
    const { events, emit } = collector();
    const state = newStreamState();
    handleStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } }),
      emit, state,
    );
    expect(events).toEqual([]);
  });

  it('captures the terminal result as output text (no event)', () => {
    const { events, emit } = collector();
    const state = newStreamState();
    handleStreamLine(JSON.stringify({ type: 'result', result: 'final answer' }), emit, state);
    expect(state.resultText).toBe('final answer');
    expect(events).toEqual([]);
  });

  it('ignores non-JSON lines and leaves state untouched (fallback path)', () => {
    const { events, emit } = collector();
    const state = newStreamState();
    handleStreamLine('not json at all', emit, state);
    handleStreamLine('', emit, state);
    expect(events).toEqual([]);
    expect(state.sawStream).toBe(false);
  });

  it('a full stream produces ordered events and a result', () => {
    const { events, emit } = collector();
    const state = newStreamState();
    for (const line of [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the spec.' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/y.ts' } }] } }),
      JSON.stringify({ type: 'result', result: 'done' }),
    ]) handleStreamLine(line, emit, state);

    expect(events.map((e) => e.type)).toEqual(['agent_message', 'tool_called']);
    expect(state.resultText).toBe('done');
    expect(state.sawStream).toBe(true);
  });
});
