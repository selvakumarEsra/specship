/**
 * Registry of supported agent targets.
 *
 * Claude Code plus the one ratified exception, Gemini CLI (GEMINI-TARGET-DOC).
 * Registration does NOT make a target install by default — `specship install`
 * writes Claude alone unless `--target` names another (REQ-GEMINI-002.A4).
 * Being here means the target participates in the contract suite, in
 * `detectAll`, and in the uninstall sweep.
 */

import { AgentTarget, Location, TargetId } from './types';
import { claudeTarget } from './claude';
import { geminiTarget } from './gemini';

/**
 * Every install target, built on each call. A function, not a module-level
 * array: the targets import modules that import this registry (the Gemini
 * target records the context files it adds through the installed-agents
 * record), and an array literal evaluated mid-cycle would freeze a target
 * that is still `undefined` into the list for the life of the process.
 */
export function allTargets(): readonly AgentTarget[] {
  return Object.freeze([claudeTarget, geminiTarget]);
}

export function getTarget(id: string): AgentTarget | undefined {
  return allTargets().find((t) => t.id === id);
}

export function listTargetIds(): TargetId[] {
  return allTargets().map((t) => t.id);
}

/**
 * Run `detect()` for every target at the given location. Returns the
 * registry zipped with detection results.
 */
export function detectAll(loc: Location): Array<{
  target: AgentTarget;
  detection: ReturnType<AgentTarget['detect']>;
}> {
  return allTargets().map((target) => ({
    target,
    detection: target.detect(loc),
  }));
}
