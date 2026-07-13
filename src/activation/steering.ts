/**
 * Retrieval steering nudge (STEER-HOOK-DOC).
 *
 * Coverage that the agent never exercises is worthless: dynamic-dispatch
 * synthesizers repeatedly probe-validate but show "agent A/B null" because
 * the agent reaches for Read/Grep before specship. The only channel that
 * measurably fixed adoption was high-salience per-prompt steering
 * (`--append-system-prompt`); low-salience channels (MCP initialize
 * instructions, tool descriptions) failed across wording variants. This
 * module is that channel, shipped as an installer-written `UserPromptSubmit`
 * hook (REQ-STEER-001) whose command is `specship steer-nudge`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectModelTier } from '../mcp/model-context';
import { resolveSetting } from '../config/runtime-settings';

/**
 * The one steering line injected per prompt. Kept short (~40 tokens) — it is
 * added to EVERY prompt in an initialized project, so brevity is the cost
 * ceiling. Wording is A/B-gated before default-on release (REQ-STEER-003).
 */
export const STEERING_TEXT =
  'This project has a SpecShip code-graph index. Before reading or editing ANY ' +
  'code for a task — understanding, implementing, fixing, refactoring — call ' +
  'mcp__specship__specship_explore with the relevant symbol/file names FIRST. ' +
  'Treat the source it returns as already read; use Read/Grep only for content ' +
  'it did not return.';

/**
 * The haiku-tier template (LOWMODEL-DOC, REQ-LOWMODEL-002): small models
 * follow prescriptive templates far better than principles, and fan-out
 * (subagents) multiplies their cost and confusion. Kept under ~80 tokens
 * (REQ-LOWMODEL-002.A2).
 */
export const STEERING_TEXT_HAIKU =
  'This project has a SpecShip index. For any code question, call exactly: ' +
  'mcp__specship__specship_explore with the symbol/file names from the question. ' +
  'ONE call, then answer from its output — the source it returns is already read. ' +
  'Do not spawn subagents. Do not Read/Grep files the tool returned.';

/**
 * Decide whether to emit the steering line (REQ-STEER-002): silent unless the
 * project is initialized (`.specship/` exists at cwd), and silent when the
 * user opted out via `SPECSHIP_NO_STEERING=1`. Uninitialized projects and
 * opted-out users get zero prompt noise. Tier-aware (REQ-LOWMODEL-002):
 * haiku sessions get the prescriptive template; sonnet and frontier keep the
 * standard line.
 */
export function buildSteeringNudge(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir?: string
): string | null {
  // RUNSET-DOC: the opt-out resolves env > project .specship/settings.json >
  // ~/.specship/settings.json, so a repo can silence steering durably.
  if (resolveSetting('SPECSHIP_NO_STEERING', cwd, env, homedir) === '1') return null;
  try {
    if (!fs.statSync(path.join(cwd, '.specship')).isDirectory()) return null;
  } catch {
    return null;
  }
  return detectModelTier(cwd, env, homedir) === 'haiku' ? STEERING_TEXT_HAIKU : STEERING_TEXT;
}
