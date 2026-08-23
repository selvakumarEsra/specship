/**
 * Point-of-use search interceptor (STEER-HOOK-DOC, REQ-STEER-004/005).
 *
 * The prompt-level nudge (steering.ts) fires once, at prompt submit, and its
 * pull decays across a long turn — the observed failure is a search-shaped
 * tool call made many tool-calls after the nudge. This module is the decision
 * logic for the `PreToolUse` hook the installer writes on search tools
 * (`specship search-intercept`): deliver the same guidance at the moment of
 * the wrong choice.
 *
 * Two properties are non-negotiable:
 *
 *   - ADVISORY (REQ-STEER-004): the emitted text is `additionalContext`,
 *     never a permission decision. A search the index cannot answer is a
 *     legitimate search; a wrong denial costs the agent a turn — the very
 *     failure this feature exists to reduce.
 *   - SELF-SILENCING (REQ-STEER-005): at most one line per session, and only
 *     when the session has made zero specship tool calls. Firing on every
 *     search would make the hook noise, and noise is what taught the agent to
 *     ignore the prompt-level nudge.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveSetting } from '../config/runtime-settings';

/**
 * The one redirect line. Explicitly advisory ("your search still runs") so
 * the model doesn't treat it as a rejection of the call it just made.
 */
export const SEARCH_INTERCEPT_TEXT =
  'SpecShip: this project has an indexed code graph. For finding or understanding code, ' +
  'mcp__specship__specship_explore with the relevant symbol/file names usually answers in ' +
  'ONE call and returns the verbatim source. Your search still runs — reach for explore ' +
  'on the next lookup.';

/** Per-session tracking file, kept inside the project's own `.specship/`. */
export function interceptStatePath(projectRoot: string): string {
  return path.join(projectRoot, '.specship', 'steer-intercept-state.json');
}

/** Records older than this are pruned on write (REQ-STEER-005.A4). */
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InterceptState = Record<string, { at: string }>;

function readState(file: string): InterceptState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: InterceptState = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === 'object' && typeof (v as { at?: unknown }).at === 'string') {
        out[k] = { at: (v as { at: string }).at };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Best-effort write with TTL pruning; a failed write must never fail the hook. */
function writeState(file: string, state: InterceptState, now: Date): void {
  try {
    const pruned: InterceptState = {};
    for (const [k, v] of Object.entries(state)) {
      const at = Date.parse(v.at);
      if (Number.isFinite(at) && now.getTime() - at < STATE_TTL_MS) pruned[k] = v;
    }
    fs.writeFileSync(file, JSON.stringify(pruned));
  } catch {
    /* state is an optimization; losing it only risks one extra advisory line */
  }
}

/**
 * Whether the session's transcript shows any specship tool USE. A transcript
 * record must be an actual `tool_use` naming a specship tool — a bare
 * mention of a tool name is NOT use: transcripts routinely carry the full
 * tool listing (`deferred_tools_delta` attachments, skill listings), so a
 * substring test alone silences the hook in every session where specship is
 * merely INSTALLED (found live in the REQ-STEER-006 A/B — the interceptor
 * never fired). Reads at most the trailing 4 MB — usage anywhere counts, but
 * a huge transcript must not blow the hook's latency budget, and a false
 * negative costs one harmless advisory line.
 */
function transcriptUsedSpecship(transcriptPath: string): boolean {
  const MAX_SCAN_BYTES = 4 * 1024 * 1024;
  let text: string;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size <= MAX_SCAN_BYTES) {
      text = fs.readFileSync(transcriptPath, 'utf-8');
    } else {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(MAX_SCAN_BYTES);
        const read = fs.readSync(fd, buf, 0, MAX_SCAN_BYTES, stat.size - MAX_SCAN_BYTES);
        text = buf.toString('utf-8', 0, read);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    return false;
  }
  // One JSONL record per line; a specship tool_use block puts both markers on
  // the same record. Cheap two-substring test — no JSON.parse per line.
  for (const line of text.split('\n')) {
    if (line.includes('"type":"tool_use"') && line.includes('"name":"mcp__specship__')) {
      return true;
    }
  }
  return false;
}

export interface SearchInterceptInput {
  /** Project the intercepted call belongs to (the hook payload's `cwd`). */
  cwd: string;
  /** Claude Code session id from the hook payload; null → untrackable, stay silent. */
  sessionId: string | null;
  /** Session transcript path from the hook payload, when present. */
  transcriptPath: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  /** Injectable clock for tests. */
  now?: Date;
}

/**
 * Decide whether to emit the redirect line for one intercepted search call.
 *
 * Silence gates, in order (all REQ-STEER-004.A3 / REQ-STEER-005):
 *   1. `SPECSHIP_NO_STEERING=1` (env > project > install settings) — same
 *      opt-out as the prompt nudge.
 *   2. No `.specship/` directory at cwd — uninitialized projects get zero
 *      noise.
 *   3. No session id — nothing to key the once-per-session guarantee on, so
 *      silence beats repeat-firing.
 *   4. The session is already recorded — it fired before, or was seen using
 *      specship.
 *   5. The transcript shows specship use — the agent doesn't need redirecting;
 *      record the session so later calls skip the scan.
 *
 * Otherwise: record the session and return the line (fires exactly once).
 */
export function buildSearchIntercept(input: SearchInterceptInput): string | null {
  const { cwd, sessionId, transcriptPath, env = process.env, homedir, now = new Date() } = input;

  if (resolveSetting('SPECSHIP_NO_STEERING', cwd, env, homedir) === '1') return null;
  try {
    if (!fs.statSync(path.join(cwd, '.specship')).isDirectory()) return null;
  } catch {
    return null;
  }
  if (!sessionId) return null;

  const stateFile = interceptStatePath(cwd);
  const state = readState(stateFile);
  if (state[sessionId]) return null;

  state[sessionId] = { at: now.toISOString() };
  if (transcriptPath && transcriptUsedSpecship(transcriptPath)) {
    // Already an index user — silence, but remember so we don't rescan.
    writeState(stateFile, state, now);
    return null;
  }

  writeState(stateFile, state, now);
  return SEARCH_INTERCEPT_TEXT;
}
