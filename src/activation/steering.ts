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

/**
 * The one steering line injected per prompt. Kept short (~40 tokens) — it is
 * added to EVERY prompt in an initialized project, so brevity is the cost
 * ceiling. Wording is A/B-gated before default-on release (REQ-STEER-003).
 */
export const STEERING_TEXT =
  'This project has a SpecShip code-graph index. For structure/flow questions ' +
  '("how does X work / reach Y", "who calls Z", architecture, impact), call ' +
  'mcp__specship__specship_explore with the relevant symbol names FIRST — before ' +
  'any Read/Grep — and treat the source it returns as already read.';

/**
 * Decide whether to emit the steering line (REQ-STEER-002): silent unless the
 * project is initialized (`.specship/` exists at cwd), and silent when the
 * user opted out via `SPECSHIP_NO_STEERING=1`. Uninitialized projects and
 * opted-out users get zero prompt noise.
 */
export function buildSteeringNudge(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env.SPECSHIP_NO_STEERING === '1') return null;
  try {
    if (!fs.statSync(path.join(cwd, '.specship')).isDirectory()) return null;
  } catch {
    return null;
  }
  return STEERING_TEXT;
}
