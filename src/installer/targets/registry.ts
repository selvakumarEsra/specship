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

export const ALL_TARGETS: readonly AgentTarget[] = Object.freeze([claudeTarget, geminiTarget]);

export function getTarget(id: string): AgentTarget | undefined {
  return ALL_TARGETS.find((t) => t.id === id);
}

export function listTargetIds(): TargetId[] {
  return ALL_TARGETS.map((t) => t.id);
}

/**
 * Run `detect()` for every target at the given location. Returns the
 * registry zipped with detection results.
 */
export function detectAll(loc: Location): Array<{
  target: AgentTarget;
  detection: ReturnType<AgentTarget['detect']>;
}> {
  return ALL_TARGETS.map((target) => ({
    target,
    detection: target.detect(loc),
  }));
}
