/**
 * Registry of supported agent targets.
 *
 * Currently Claude-only. The interface is preserved so re-adding another
 * agent is one new file in `targets/` plus one entry below.
 */

import { AgentTarget, Location, TargetId } from './types';
import { claudeTarget } from './claude';

export const ALL_TARGETS: readonly AgentTarget[] = Object.freeze([claudeTarget]);

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
