import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { claudeTarget } from '../src/installer/targets/claude';
import { geminiTarget } from '../src/installer/targets/gemini';

/**
 * THROUGHPUT-DOC REQ-THRU-011 — per-target smoke: install into a temporary
 * home, read back the hook commands the installer wired, run them with that
 * host's recorded payload shape through the BUILT CLI, and assert the
 * host-shaped output. Exercises the whole chain (installer → settings → hook
 * command → payload parsing → output dialect) without a live model.
 *
 * Needs `dist/` (run `npm run build`) — like the other CLI-spawning suites.
 */

const DIST = path.join(__dirname, '..', 'dist', 'bin', 'specship.js');

let home: string;
let project: string;
let prevHome: string | undefined;
let prevProfile: string | undefined;

beforeEach(() => {
  if (!fs.existsSync(DIST)) throw new Error(`host smoke needs a build: ${DIST} missing — run npm run build`);
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-proj-'));
  fs.mkdirSync(path.join(project, '.specship')); // an initialized project, so steering speaks
  prevHome = process.env.HOME;
  prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevProfile;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

type HookGroups = Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;

/** The installed command for `event` whose command contains `needle`. */
function installedCommand(settingsPath: string, event: string, needle: string): string {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { hooks?: HookGroups };
  const cmd = (settings.hooks?.[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command)).find((c) => c.includes(needle));
  if (!cmd) throw new Error(`no ${event} hook containing "${needle}" in ${settingsPath}`);
  return cmd;
}

/** Run an installed `specship …` hook command through the built CLI with a payload on stdin. */
function runHook(command: string, payload: Record<string, unknown>, env: Record<string, string> = {}): string {
  expect(command.startsWith('specship ')).toBe(true);
  const args = command.slice('specship '.length).split(/\s+/).filter(Boolean);
  const r = spawnSync(process.execPath, [DIST, ...args], {
    input: JSON.stringify(payload),
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, SPECSHIP_NO_PULSE: '1', ...env },
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

function claudeTargetSmoke(): void {
  claudeTarget.install('global', { autoAllow: true });
  const settings = path.join(home, '.claude', 'settings.json');

  const nudge = JSON.parse(
    runHook(installedCommand(settings, 'UserPromptSubmit', 'steer-nudge'), {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'c1',
      cwd: project,
      prompt: 'how does login reach the session store?',
    }),
  );
  expect(nudge.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  expect(nudge.hookSpecificOutput.additionalContext).toContain('mcp__specship__specship_explore');

  const intercept = JSON.parse(
    runHook(installedCommand(settings, 'PreToolUse', 'search-intercept'), {
      hook_event_name: 'PreToolUse',
      session_id: 'c1',
      transcript_path: path.join(project, 'none.jsonl'),
      cwd: project,
      tool_name: 'Grep',
      tool_input: { pattern: 'renderScene' },
    }),
  );
  expect(intercept.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  expect(intercept.hookSpecificOutput.additionalContext).toContain('specship_explore');
  expect(intercept.decision).toBeUndefined(); // Claude never gets a deny
}

function geminiTargetSmoke(): void {
  geminiTarget.install('global', { autoAllow: true });
  const settings = path.join(home, '.gemini', 'settings.json');

  const nudge = JSON.parse(
    runHook(installedCommand(settings, 'BeforeAgent', 'steer-nudge'), {
      hook_event_name: 'BeforeAgent',
      session_id: 'g1',
      cwd: project,
      prompt: 'how does login reach the session store?',
    }),
  );
  expect(nudge.hookSpecificOutput.hookEventName).toBe('BeforeAgent');
  expect(nudge.hookSpecificOutput.additionalContext).toContain(' specship_explore ');
  expect(nudge.hookSpecificOutput.additionalContext).not.toContain('mcp__specship__');

  const transcript = path.join(project, 'session.json');
  fs.writeFileSync(transcript, JSON.stringify({ messages: [{ toolCalls: [{ name: 'grep_search' }] }] }, null, 2));
  const deny = JSON.parse(
    runHook(
      installedCommand(settings, 'BeforeTool', 'search-intercept'),
      {
        hook_event_name: 'BeforeTool',
        session_id: 'g2',
        transcript_path: transcript,
        cwd: project,
        tool_name: 'grep_search',
        tool_input: { pattern: 'renderScene' },
      },
      { SPECSHIP_GEMINI_STRICT: '1' },
    ),
  );
  // Gemini reads a TOP-LEVEL decision (DOM-SPECSHIP-006).
  expect(deny.decision).toBe('deny');
  expect(deny.reason).toContain('specship_explore');
}

describe('host smoke — install, then run the wired hooks (REQ-THRU-011)', () => {
  it('Claude Code: installed hooks answer Claude payloads in Claude\'s shape (REQ-THRU-011.A1)', claudeTargetSmoke);
  it('Gemini CLI: installed hooks answer Gemini payloads, incl. a strict top-level deny (REQ-THRU-011.A2)', geminiTargetSmoke);
});
