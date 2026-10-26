/**
 * Headless-agent registry and selection (REQ-AGENTADAPT-005/006).
 *
 * The agent is resolved once at run start — `--agent`, then
 * `SPECSHIP_WORKFLOW_AGENT`, then `workflow.agent` in specship.config.json,
 * then the coding agent that launched the command, then Claude Code — and is
 * stored on the run so approve / revise / resume use the same one.
 */

import * as fs from 'fs';
import * as path from 'path';
import { claudeHeadlessAgent } from './claude';
import { geminiHeadlessAgent } from './gemini';
import type { HeadlessAgent, HeadlessAgentConfig } from './types';

export type { HeadlessAgent, HeadlessAgentConfig, HeadlessInvocation, StreamParseState } from './types';

const AGENTS: readonly HeadlessAgent[] = [claudeHeadlessAgent, geminiHeadlessAgent];
export const DEFAULT_WORKFLOW_AGENT = claudeHeadlessAgent.id;
/** Run-metadata key the chosen agent is stored under. */
export const RUN_AGENT_KEY = 'agent';

export function knownWorkflowAgents(): string[] {
  return AGENTS.map((a) => a.id);
}

export function getHeadlessAgent(id: string): HeadlessAgent | undefined {
  return AGENTS.find((a) => a.id === id);
}

export class UnknownWorkflowAgentError extends Error {
  constructor(name: string, source: string) {
    super(`Unknown workflow agent "${name}" (from ${source}). Known agents: ${knownWorkflowAgents().join(', ')}`);
    this.name = 'UnknownWorkflowAgentError';
  }
}

interface WorkflowAgentsConfig {
  agent?: unknown;
  agents?: Record<string, HeadlessAgentConfig>;
}

function readWorkflowConfig(projectRoot: string): WorkflowAgentsConfig {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'specship.config.json'), 'utf8'));
    return (cfg && typeof cfg.workflow === 'object' && cfg.workflow) || {};
  } catch {
    return {};
  }
}

export interface ResolveAgentOptions {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  projectRoot: string;
}

/** The agent id for a new run, or throws UnknownWorkflowAgentError (REQ-AGENTADAPT-006.A4). */
export function resolveWorkflowAgent(opts: ResolveAgentOptions): string {
  const env = opts.env ?? process.env;
  const cfg = readWorkflowConfig(opts.projectRoot);
  const explicit: Array<[unknown, string]> = [
    [opts.flag, '--agent'],
    [env.SPECSHIP_WORKFLOW_AGENT, 'SPECSHIP_WORKFLOW_AGENT'],
    [cfg.agent, 'workflow.agent in specship.config.json'],
  ];
  for (const [value, source] of explicit) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const id = value.trim().toLowerCase();
    if (!getHeadlessAgent(id)) throw new UnknownWorkflowAgentError(value, source);
    return id;
  }
  const launcher = AGENTS.find((a) => a.id !== DEFAULT_WORKFLOW_AGENT && a.launchedFrom(env));
  return launcher?.id ?? DEFAULT_WORKFLOW_AGENT;
}

/** `workflow.agents.<id>` settings (model tier mapping), {} when unset. */
export function workflowAgentConfig(projectRoot: string, id: string): HeadlessAgentConfig {
  const entry = readWorkflowConfig(projectRoot).agents?.[id];
  return entry && typeof entry === 'object' ? entry : {};
}
