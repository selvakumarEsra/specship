/**
 * Headless-agent adapters for workflow prompt steps (AGENTADAPT-DOC,
 * REQ-AGENTADAPT-005). One adapter per coding agent owns that host's binary,
 * argument translation and output parsing; the prompt runner stays
 * host-neutral and gets the same step result whichever host ran it.
 */

import type { PromptNode } from '../schemas/workflow';
import type { WorkflowEventType } from '../../types';

/** Accumulated state while parsing an agent's streamed output. */
export interface StreamParseState {
  /** True once at least one line parsed as a known stream event. */
  sawStream: boolean;
  /** Final result text from a terminal result event, if the host sends one. */
  resultText: string | null;
  /** Concatenated assistant text (the result when there's no result text). */
  assistantText: string;
  costUsd?: number;
  durationMs?: number;
  model?: string;
  /** Set when the host's own terminal event reports failure. */
  failure?: string;
}

export function newStreamState(): StreamParseState {
  return { sawStream: false, resultText: null, assistantText: '' };
}

export type EmitFn = (type: WorkflowEventType, data?: Record<string, unknown>) => void;

/** What to spawn for one step. */
export interface HeadlessInvocation {
  bin: string;
  args: string[];
  /** Written to the child's stdin, then closed. */
  stdin: string;
}

/** Per-agent settings from `workflow.agents.<id>` in specship.config.json. */
export interface HeadlessAgentConfig {
  /** Model tier alias (`haiku`, `sonnet`, `opus`) → this host's model id. */
  models?: Record<string, string>;
}

export interface HeadlessAgent {
  /** The name `--agent` / `SPECSHIP_WORKFLOW_AGENT` / `workflow.agent` use. */
  readonly id: string;
  /** True when `env` shows the command was launched from inside this host. */
  launchedFrom(env: NodeJS.ProcessEnv): boolean;
  /**
   * Translate a step. Returns `{ error }` — never a partial invocation — when
   * the step uses something this host cannot honour (REQ-AGENTADAPT-007.A4).
   */
  build(node: PromptNode, config: HeadlessAgentConfig, env: NodeJS.ProcessEnv): HeadlessInvocation | { error: string };
  /** Parse one output line, emitting live events and folding into `state`. */
  handleLine(line: string, emit: EmitFn, state: StreamParseState): void;
}

/** A short, single-line summary of a tool's input for the `tool_called` event. */
export function summarizeToolInput(input: unknown): string {
  if (input == null) return '';
  let s: string;
  if (typeof input === 'string') {
    s = input;
  } else if (typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const pick =
      o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.query ?? o.url ?? o.prompt;
    s = typeof pick === 'string' ? pick : JSON.stringify(o);
  } else {
    s = String(input);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const ev = JSON.parse(trimmed);
    return ev && typeof ev === 'object' && !Array.isArray(ev) ? (ev as Record<string, unknown>) : null;
  } catch {
    return null; // not JSON — ignore (hosts may print plain diagnostics)
  }
}
