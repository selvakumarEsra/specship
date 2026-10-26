/**
 * Point-of-use search interceptor (STEER-HOOK-DOC, REQ-STEER-004/005,
 * REQ-GEMINI-011).
 *
 * The prompt-level nudge (steering.ts) fires once, at prompt submit, and its
 * pull decays across a long turn — the observed failure is a search-shaped
 * tool call made many tool-calls after the nudge. This module is the decision
 * logic for the hook the installer writes on each host's search tools
 * (Claude: PreToolUse on Grep/Glob; Gemini: BeforeTool on grep_search / glob /
 * run_shell_command): deliver the same guidance at the moment of the wrong
 * choice.
 *
 * Two modes exist:
 *
 *   - ADVISORY (default, both hosts, REQ-STEER-004/005): emit a one-line
 *     `additionalContext` redirect. At most once per session, silent once the
 *     session has used specship. The search still runs.
 *   - STRICT (Gemini-only opt-in, REQ-GEMINI-011): for a built-in search tool
 *     (`grep_search`, `glob`) in an indexed project, emit a top-level
 *     `{decision:'deny'}` with a reason naming `specship_explore`. A
 *     search-shaped `run_shell_command` NEVER denies — Gemini's hook runs
 *     after the user's shell confirmation, so denying it would make the user
 *     approve a command and then see it blocked. Parse-failure / unindexed
 *     project / already-using-specship → ALLOW.
 *
 * Shared code stays agent-agnostic: this file never sniffs `hook_event_name`
 * or tool-name prefixes. The caller (bin/specship) hands in host traits
 * derived in the hook I/O adapter (`activation/hook-output.ts`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveSetting } from '../config/runtime-settings';
import { CLAUDE_CODE_TRAITS } from './hook-output';

/**
 * The one redirect line. Explicitly advisory ("your search still runs") so
 * the model doesn't treat it as a rejection of the call it just made.
 */
export const SEARCH_INTERCEPT_TEXT =
  'SpecShip: this project has an indexed code graph. For finding or understanding code, ' +
  'specship_explore with the relevant symbol/file names usually answers in ' +
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

type TranscriptScan = 'used' | 'not-used' | 'parse-failure';

function scanTranscript(
  transcriptPath: string,
  markers: string[],
  format: 'jsonl' | 'single-json',
): TranscriptScan {
  const MAX_SCAN_BYTES = 4 * 1024 * 1024;
  let text: string;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size <= MAX_SCAN_BYTES) {
      text = fs.readFileSync(transcriptPath, 'utf-8');
    } else if (format === 'jsonl') {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(MAX_SCAN_BYTES);
        const read = fs.readSync(fd, buf, 0, MAX_SCAN_BYTES, stat.size - MAX_SCAN_BYTES);
        text = buf.toString('utf-8', 0, read);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      // single-json needs a full read to parse; a huge transcript can't be
      // reliably scanned → treat as parse-failure (ALLOW in strict).
      return 'parse-failure';
    }
  } catch {
    return format === 'single-json' ? 'parse-failure' : 'not-used';
  }

  if (format === 'jsonl') {
    for (const line of text.split('\n')) {
      if (line.includes('"type":"tool_use"') && markers.some((m) => line.includes(m))) {
        return 'used';
      }
    }
    return 'not-used';
  }

  // single-json: Gemini CLI's ChatRecordingService writes one pretty-printed
  // JSON doc with `messages[].toolCalls[].name`. Parse once, iterate names.
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return 'parse-failure';
  }
  const messages = (doc as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) return 'not-used';
  for (const m of messages) {
    const calls = (m as { toolCalls?: unknown })?.toolCalls;
    if (!Array.isArray(calls)) continue;
    for (const c of calls) {
      const name = (c as { name?: unknown })?.name;
      if (typeof name === 'string') {
        // Gemini records the function name the model called, which for an
        // MCP tool is its bare name (`specship_explore`); the composite
        // `specship__<tool>` form appears only when a name collision forces
        // qualification (verified in 0.28.0 DiscoveredMCPTool). `specship_`
        // covers both; tolerate the Claude form if a transcript carries it.
        if (name.startsWith('specship_') || name.startsWith(CLAUDE_CODE_TRAITS.toolPrefix)) {
          return 'used';
        }
      }
    }
  }
  return 'not-used';
}

/**
 * Classify a shell command string for intercept purposes. We ONLY look at the
 * first pipeline segment: `npm test | grep FAIL` uses grep as a FILTER on
 * another command's output and must not be nudged, while `rg "renderScene"
 * src/` is the lookup we care about. Read-shaped programs (`cat`, `head`,
 * `tail`, `sed -n`, …) are never classified `search` — reading a config or
 * log is legitimate.
 */
export function classifyShellCommand(cmd: string): 'search' | 'other' {
  const first = firstPipelineSegment(cmd).trim();
  if (!first) return 'other';
  const tokens = first.split(/\s+/);
  const t0 = tokens[0] ?? '';
  const t1 = tokens[1] ?? '';
  const SEARCH_TOOLS = new Set(['grep', 'rg', 'ag', 'ack', 'fd', 'find']);
  if (SEARCH_TOOLS.has(t0)) return 'search';
  if (t0 === 'git' && t1 === 'grep') return 'search';
  return 'other';
}

/** Return the first `|`/`&&`/`;` separated segment, respecting simple quotes. */
function firstPipelineSegment(cmd: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote && cmd[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c as '"' | "'";
      continue;
    }
    if (c === '|' || c === ';') return cmd.slice(0, i);
    if (c === '&' && cmd[i + 1] === '&') return cmd.slice(0, i);
  }
  return cmd;
}

export interface SearchInterceptInput {
  /** Project the intercepted call belongs to (the hook payload's `cwd`). */
  cwd: string;
  /** Host session id from the hook payload; null → untrackable, stay silent. */
  sessionId: string | null;
  /** Session transcript path from the hook payload, when present. */
  transcriptPath: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  /** Injectable clock for tests. */
  now?: Date;

  /** Transcript substrings signaling specship tool_use. Default: Claude form. */
  specshipToolMarkers?: string[];
  /** Transcript file format. Default: Claude JSONL. */
  transcriptFormat?: 'jsonl' | 'single-json';
  /** Strict mode (host supports a BeforeTool deny AND user opted in). */
  strict?: boolean;
  /** Whether the intercepted tool is a built-in search eligible for deny. */
  denyEligible?: boolean;
  /** When the intercepted tool is a shell runner, the raw command string. */
  shellCommand?: string | null;
  /** Search pattern/needle to echo in the deny reason, when known. */
  searchPattern?: string | null;
}

export type SearchInterceptResult =
  | { additionalContext: string }
  | { decision: 'deny'; reason: string }
  | null;

function denyReason(pattern?: string | null): string {
  const trimmed = pattern ? pattern.trim() : '';
  const named = trimmed ? ` naming ${JSON.stringify(trimmed.slice(0, 80))}` : '';
  return (
    `SpecShip: this project has an indexed code graph. Call specship_explore${named} ` +
    'instead — it returns the verbatim source in one call. If the index cannot ' +
    'answer the question, ask the user and retry.'
  );
}

/**
 * Decide what to emit for one intercepted search call.
 *
 * Order:
 *   1. `SPECSHIP_NO_STEERING=1` → ALLOW (silent).
 *   2. No `.specship/` at cwd → ALLOW.
 *   3. Shell runner: classify; `other` → ALLOW; `search` → advisory path
 *      only (never deny, REQ-GEMINI-011.A3).
 *   4. Strict + denyEligible: parse transcript; `used` or `parse-failure` or
 *      no transcript path → ALLOW; `not-used` → DENY with reason.
 *   5. Otherwise advisory: once-per-session, silent in sessions already using
 *      specship (REQ-STEER-005).
 */
export function buildSearchIntercept(input: SearchInterceptInput): SearchInterceptResult {
  const {
    cwd,
    sessionId,
    transcriptPath,
    env = process.env,
    homedir,
    now = new Date(),
    specshipToolMarkers = CLAUDE_CODE_TRAITS.specshipToolMarkers,
    transcriptFormat = 'jsonl',
    strict = false,
    denyEligible = false,
    shellCommand = null,
    searchPattern = null,
  } = input;

  if (resolveSetting('SPECSHIP_NO_STEERING', cwd, env, homedir) === '1') return null;
  try {
    if (!fs.statSync(path.join(cwd, '.specship')).isDirectory()) return null;
  } catch {
    return null;
  }

  // Shell runner — strict is NEVER applied here. Non-search shell commands
  // pass through silently; search-shaped ones fall into the advisory path.
  if (shellCommand !== null) {
    if (classifyShellCommand(shellCommand) !== 'search') return null;
  }

  // Strict deny path: built-in search tools only, never shell.
  if (strict && denyEligible && shellCommand === null) {
    if (!transcriptPath) return null;
    const scan = scanTranscript(transcriptPath, specshipToolMarkers, transcriptFormat);
    if (scan !== 'not-used') return null;
    return { decision: 'deny', reason: denyReason(searchPattern) };
  }

  // Advisory path.
  if (!sessionId) return null;
  const stateFile = interceptStatePath(cwd);
  const state = readState(stateFile);
  if (state[sessionId]) return null;

  state[sessionId] = { at: now.toISOString() };
  if (transcriptPath) {
    const scan = scanTranscript(transcriptPath, specshipToolMarkers, transcriptFormat);
    if (scan === 'used') {
      writeState(stateFile, state, now);
      return null;
    }
    // Gemini parse-failure fails toward silence in advisory mode (spec
    // REQ-GEMINI-011); Claude JSONL never returns parse-failure.
    if (scan === 'parse-failure' && transcriptFormat === 'single-json') {
      writeState(stateFile, state, now);
      return null;
    }
  }

  writeState(stateFile, state, now);
  return { additionalContext: SEARCH_INTERCEPT_TEXT };
}
