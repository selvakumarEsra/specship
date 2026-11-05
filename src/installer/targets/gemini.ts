/**
 * Google Gemini CLI target — Phase 1 (GEMINI-TARGET-DOC, REQ-GEMINI-002/003).
 *
 * Implements the full `AgentTarget` contract over Gemini CLI's `mcpServers`
 * settings block, GEMINI.md steering (REQ-GEMINI-004), settings hooks
 * (REQ-GEMINI-010/011), the opt-in `--trust` policy (REQ-GEMINI-009) and the
 * slash commands rendered into Gemini TOML from the same
 * `commands/specship/*.md` sources the Claude target copies (REQ-GEMINI-005,
 * see `../gemini-commands.ts` for the verified format + per-command
 * decisions), plus the skills and the explorer subagent when the installed
 * Gemini CLI supports them (REQ-AGENTSWITCH-005). What still has no Gemini
 * equivalent (the status line, the permissions list) is left unwritten and
 * named in `notes` rather than half-installed (REQ-GEMINI-006).
 *
 * The target IS registered in `targets/registry.ts`, but a plain
 * `specship install` stays Claude-only: target selection is opt-in through
 * `--target gemini` (REQ-GEMINI-002.A4).
 *
 * Schema provenance (REQ-GEMINI-001: "MUST NOT be invented from memory"):
 * verified against `@google/gemini-cli` **0.56.0** (npm latest, 2026-08-22;
 * cross-checked against 0.28.0) by reading the shipped
 * `config/settingsSchema.js` and the `MCPServerConfig` class:
 *
 *   - settings key: `mcpServers`, an object of server-name → MCPServerConfig
 *   - stdio fields: `command`, `args`, `env`, `cwd`
 *   - `type` is `'sse' | 'http'` ONLY — a stdio server is identified by
 *     having `command`, so we must NOT copy the Claude entry's
 *     `type: 'stdio'` across (the one place this diverges from the Claude
 *     snippet; command/args/env stay identical by construction because both
 *     come from `shared.ts:getMcpServerConfig`).
 *   - locations: global `~/.gemini/settings.json` (Storage.getGlobalSettingsPath),
 *     project `<cwd>/.gemini/settings.json` (Storage.getWorkspaceSettingsPath).
 */

import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { GEMINI_CLI_TRAITS } from '../../activation/hook-output';
import * as os from 'os';
import * as path from 'path';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  atomicWriteFileSync,
  getMcpServerConfig,
  jsonDeepEqual,
  packageAssetPath,
  pruneEmptySkillDirs,
  readJsonFile,
  removeFileSync,
  removeMarkedSection,
  upsertMarkedSection,
  writeJsonFile,
} from './shared';
import {
  SPECSHIP_GEMINI_RETRIEVAL_END,
  SPECSHIP_GEMINI_RETRIEVAL_START,
  SPECSHIP_SDD_SECTION_END,
  SPECSHIP_SDD_SECTION_START,
  getGeminiRetrievalBlock,
  getSddRuleBlock,
} from '../instructions-template';
import { GOVERNANCE_TIER_COMMANDS, RETRIEVAL_TIER_COMMANDS, SHIPPED_SKILLS, claudeMdPath } from './claude';
import { readAddedContextFiles, setAddedContextFiles } from '../agent-record';
import { noSurfaceNotes } from './feature-parity';
import {
  GEMINI_COMMAND_HEADER_MARKER,
  geminiCommandSet,
  geminiCommandTarget,
} from '../gemini-commands';

/** Gemini CLI's settings file for this location. */
export function settingsPath(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.gemini', 'settings.json')
    : path.join(process.cwd(), '.gemini', 'settings.json');
}

/**
 * Gemini CLI's project / user context file. Global → `~/.gemini/GEMINI.md`
 * (user memory, loaded in every session); local → `<cwd>/GEMINI.md` (project
 * memory, loaded when Gemini CLI starts in this repo). Mirror of the Claude
 * target's `claudeMdPath` for CLAUDE.md.
 */
function geminiMdPath(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.gemini', 'GEMINI.md')
    : path.join(process.cwd(), 'GEMINI.md');
}

/**
 * Write the retrieval-preference block into GEMINI.md (REQ-GEMINI-004).
 * Marker-delimited and idempotent — content outside the markers is never
 * touched, and a byte-identical re-run returns `unchanged`.
 */
export function writeGeminiInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = geminiMdPath(loc);
  const action = upsertMarkedSection(
    file,
    SPECSHIP_GEMINI_RETRIEVAL_START,
    SPECSHIP_GEMINI_RETRIEVAL_END,
    getGeminiRetrievalBlock(),
  );
  return { path: file, action };
}

/** Inverse of `writeGeminiInstructionsEntry`: strip the retrieval block. */
export function removeGeminiInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = geminiMdPath(loc);
  const action = removeMarkedSection(
    file,
    SPECSHIP_GEMINI_RETRIEVAL_START,
    SPECSHIP_GEMINI_RETRIEVAL_END,
  );
  return { path: file, action };
}

/**
 * Write the spec-driven-development steering block into GEMINI.md
 * (REQ-GEMINI-004.A4). Generated from the SAME `getSddRuleBlock` the Claude
 * target writes, so the two surfaces cannot drift byte-wise.
 */
export function writeGeminiSddEntry(loc: Location): WriteResult['files'][number] {
  const file = geminiMdPath(loc);
  const action = upsertMarkedSection(
    file,
    SPECSHIP_SDD_SECTION_START,
    SPECSHIP_SDD_SECTION_END,
    getSddRuleBlock(),
  );
  return { path: file, action };
}

/** Inverse of `writeGeminiSddEntry`: strip the SDD rule block. */
export function removeGeminiSddEntry(loc: Location): WriteResult['files'][number] {
  const file = geminiMdPath(loc);
  const action = removeMarkedSection(
    file,
    SPECSHIP_SDD_SECTION_START,
    SPECSHIP_SDD_SECTION_END,
  );
  return { path: file, action };
}

/**
 * The `mcpServers.specship` entry as Gemini CLI wants it: the Claude entry
 * minus `type`, which Gemini restricts to `'sse' | 'http'` (a stdio server is
 * identified by having `command`). Single source for `install` AND
 * `printConfig`, so the pasted-by-hand snippet and the written entry can't
 * drift.
 */
function geminiEntry(integrations: string[] = []): Record<string, unknown> {
  const { type: _stdioIsImplied, ...server } = getMcpServerConfig(integrations);
  // Host marker (REQ-LOWEND-001): tier auto-detection's Gemini leg only runs
  // when the server was launched by Gemini CLI. This env is that evidence —
  // present in both the written entry and the printable snippet by
  // construction, absent from every Claude Code launch.
  const env = {
    ...(server as { env?: Record<string, string> }).env,
    SPECSHIP_HOST: 'gemini',
  };
  return { ...server, env };
}

/**
 * Write the specship server into Gemini CLI's `mcpServers` block
 * (REQ-GEMINI-003). Same shape as the Claude target's `writeMcpEntry`:
 * sibling servers and unrelated settings keys are preserved, a byte-identical
 * re-run reports `unchanged`, and integrations a PREVIOUS install enabled are
 * unioned in so an upgrade never silently disables an opt-in
 * (REQ-GEMINI-003.A2, parity with REQ-INTEG-001.A3).
 */
export function writeGeminiMcpEntry(
  loc: Location,
  integrations: string[] = [],
): WriteResult['files'][number] {
  const file = settingsPath(loc);
  const existing = readJsonFile(file);
  const before = existing.mcpServers?.specship;

  const prior = typeof before?.env?.SPECSHIP_INTEGRATIONS === 'string'
    ? before.env.SPECSHIP_INTEGRATIONS.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  const after = geminiEntry([...new Set([...prior, ...integrations])]);

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }
  // `created` means the settings FILE did not exist. A pre-existing
  // settings.json holding other servers is `updated` — we added to it.
  const action: 'created' | 'updated' = before
    ? 'updated'
    : (fs.existsSync(file) ? 'updated' : 'created');
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.specship = after;
  writeJsonFile(file, existing);
  return { path: file, action };
}

/**
 * Context file names as Gemini CLI reads them (REQ-AGENTSWITCH-009).
 * Verified against gemini-cli 0.28.0 `settingsSchema` / `getCurrentGeminiMdFilename`:
 * `context.fileName` is a string or a string array; when unset Gemini loads
 * only its default (`GEMINI.md`). The legacy top-level `contextFileName` is
 * the pre-v2 spelling of the same setting — read as the user's list, never
 * written or removed by us.
 */
function contextFileNames(value: unknown): string[] | null {
  if (typeof value === 'string' && value.length > 0) return [value];
  if (Array.isArray(value)) {
    const names = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return names.length > 0 ? names : null;
  }
  return null;
}

/** The scope's project root as the record keys it; absent for global. */
function recordRoot(loc: Location): string | undefined {
  return loc === 'local' ? process.cwd() : undefined;
}

/**
 * Point Gemini CLI at the user's own CLAUDE.md instead of copying it
 * (REQ-AGENTSWITCH-009): add its file name to `context.fileName`, keeping
 * every name the user already listed in their order and keeping Gemini's
 * default (`GEMINI.md`) when the setting was unset. The CLAUDE.md file itself
 * is never opened for writing.
 *
 * Local scope writes nothing — and records nothing — when the project has
 * no CLAUDE.md. Global scope always adds the name: Gemini CLI resolves a
 * bare context file name in `~/.gemini/` and in each project's directories
 * (gemini-cli-core `memoryDiscovery`, verified against 0.28.0), so the
 * user-wide setting is what makes Gemini read every project's own CLAUDE.md.
 * It never reaches `~/.claude/CLAUDE.md` — the capability note says so.
 * Idempotent: a re-run that finds the name already listed reports
 * `unchanged`.
 *
 * Returns the file result (null when there was nothing to point at) and the
 * names this call put into `context.fileName` that were not in it before.
 */
export function writeGeminiContextFilesEntry(
  loc: Location,
): { file: WriteResult['files'][number] | null; added: string[] } {
  const claudeMd = claudeMdPath(loc);
  if (loc === 'local' && !fs.existsSync(claudeMd)) return { file: null, added: [] };
  const wanted = path.basename(claudeMd);
  const geminiDefault = path.basename(geminiMdPath(loc));

  const file = settingsPath(loc);
  const existed = fs.existsSync(file);
  const settings = readJsonFile(file);
  const context = settings.context && typeof settings.context === 'object' && !Array.isArray(settings.context)
    ? settings.context
    : undefined;
  const explicit = contextFileNames(context?.fileName);
  const base = explicit ?? contextFileNames(settings.contextFileName) ?? [geminiDefault];
  const next = base.includes(wanted) ? [...base] : [...base, wanted];

  if (explicit && jsonDeepEqual(explicit, next)) {
    return { file: { path: file, action: 'unchanged' }, added: [] };
  }
  const nextContext = context ? { ...context } : {};
  nextContext.fileName = next;
  settings.context = nextContext;
  writeJsonFile(file, settings);
  const added = next.filter((n) => !(explicit ?? []).includes(n));
  return { file: { path: file, action: existed ? 'updated' : 'created' }, added };
}

/**
 * Inverse of `writeGeminiContextFilesEntry` (REQ-AGENTSWITCH-009.A4): drop
 * only the names SpecShip recorded as added; every name the user listed
 * stays. With no recorded list (record lost or rebuilt) the setting is left
 * untouched — conservative by design. Removing the last name deletes
 * `context.fileName`, and `context` when that leaves it empty.
 */
export function removeGeminiContextFilesEntry(
  loc: Location,
  added: readonly string[] | null,
): WriteResult['files'][number] | null {
  if (!added || added.length === 0) return null;
  const file = settingsPath(loc);
  if (!fs.existsSync(file)) return null;
  const settings = readJsonFile(file);
  const context = settings.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const current = contextFileNames(context.fileName);
  if (!current) return null;
  const remaining = current.filter((n) => !added.includes(n));
  if (remaining.length === current.length) return null;
  if (remaining.length === 0) {
    delete context.fileName;
    if (Object.keys(context).length === 0) delete settings.context;
  } else {
    context.fileName = remaining;
  }
  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

/**
 * What a Claude install provides that this one does not (REQ-GEMINI-006.A1).
 * One note, naming every still-unsupported surface. As of REQ-GEMINI-010 the
 * prompt / session / tool hooks DO have Gemini equivalents and are installed,
 * so the note no longer lists them; nor slash commands, which REQ-GEMINI-005
 * renders as Gemini TOML; nor skills and the explorer subagent, which
 * REQ-AGENTSWITCH-005 installs when the Gemini version supports them (with its
 * own skip / experimental notes). Auto-allow is the policy file
 * (REQ-GEMINI-009). Surfaces Gemini has no equivalent for (the status line)
 * each get their own line from `noSurfaceNotes()` (REQ-AGENTSWITCH-010.A4).
 * A command the renderer had to exclude gets its own note from
 * `writeGeminiCommandsEntries`.
 */
const CAPABILITY_NOTE =
  'Gemini CLI install wires the MCP server, writes a GEMINI.md steering ' +
  'block, installs prompt/session/tool hooks, renders the /specship:* ' +
  'slash commands as Gemini TOML, and adds CLAUDE.md to Gemini\'s context ' +
  'files so Gemini reads each project\'s CLAUDE.md in place (a project install ' +
  'does this only when the project has one). Gemini never reads ' +
  '~/.claude/CLAUDE.md — copy anything you need from it into ~/.gemini/GEMINI.md. ' +
  'Skills and the specship-explorer subagent are installed when the Gemini ' +
  'CLI version supports them (see the notes below). The tool playbook ' +
  'itself still lives in the MCP server instructions.';

/**
 * Gemini CLI's custom-commands dir for this location (verified against
 * gemini-cli 0.28.0 `Storage.getUserCommandsDir` / `getProjectCommandsDir`):
 * global `~/.gemini/commands`, local `<cwd>/.gemini/commands`. Same scope as
 * the MCP entry written by `settingsPath`.
 */
export function geminiCommandsDir(loc: Location): string {
  return path.join(path.dirname(settingsPath(loc)), 'commands');
}

/**
 * Every command the Claude installer ships, both tiers — the Gemini set is
 * derived from the same list so the surfaces can't diverge (REQ-GEMINI-005).
 */
const ALL_COMMAND_SOURCES: readonly string[] = [
  ...RETRIEVAL_TIER_COMMANDS,
  ...GOVERNANCE_TIER_COMMANDS,
];

/** True when `file` is a TOML a SpecShip install wrote (carries our header). */
function isOurCommandFile(file: string): boolean {
  try {
    return fs.readFileSync(file, 'utf-8').startsWith(GEMINI_COMMAND_HEADER_MARKER);
  } catch {
    return false;
  }
}

/**
 * Render and write the slash commands (REQ-GEMINI-005). Same tiering as the
 * Claude target: the retrieval door always, the governance doors unless
 * `--no-sdd`. Per-file idempotent (byte-equal → `unchanged`); a user-authored
 * file at one of our paths (no header marker) is never overwritten (`kept`).
 * A command the renderer excluded is NOT written, a stale copy an earlier
 * install wrote is removed, and the exclusion is returned as a note.
 *
 * `commandsSourceDir` defaults to the packaged `commands/` dir — the same
 * one the Claude target copies from.
 */
export function writeGeminiCommandsEntries(
  loc: Location,
  includeGovernance = true,
  commandsSourceDir: string = packageAssetPath('commands'),
): { files: WriteResult['files']; notes: string[] } {
  const names = includeGovernance ? ALL_COMMAND_SOURCES : [...RETRIEVAL_TIER_COMMANDS];
  const dir = geminiCommandsDir(loc);
  const files: WriteResult['files'] = [];
  const notes: string[] = [];
  for (const cmd of geminiCommandSet(commandsSourceDir, names)) {
    const dest = path.join(dir, cmd.target);
    if (cmd.toml === undefined) {
      notes.push(`Gemini CLI: skipped /${cmd.target.replace(/\.toml$/, '').replace(/\//g, ':')} — ${cmd.excluded}.`);
      if (isOurCommandFile(dest)) {
        removeFileSync(dest);
        files.push({ path: dest, action: 'removed' });
      }
      continue;
    }
    const existed = fs.existsSync(dest);
    if (existed) {
      const current = fs.readFileSync(dest, 'utf-8');
      if (current === cmd.toml) {
        files.push({ path: dest, action: 'unchanged' });
        continue;
      }
      if (!current.startsWith(GEMINI_COMMAND_HEADER_MARKER)) {
        files.push({ path: dest, action: 'kept' });
        continue;
      }
    }
    atomicWriteFileSync(dest, cmd.toml);
    files.push({ path: dest, action: existed ? 'updated' : 'created' });
  }
  return { files, notes };
}

/**
 * Inverse of `writeGeminiCommandsEntries` (REQ-GEMINI-005.A2). Removes only
 * files at our command paths that carry our header marker — user-authored
 * commands, in the same `specship/` subdir or anywhere else in the commands
 * dir, survive byte-identical. The `specship/` subdir is dropped only when
 * that leaves it empty.
 */
export function removeGeminiCommandsEntries(loc: Location): WriteResult['files'] {
  const dir = geminiCommandsDir(loc);
  const files: WriteResult['files'] = [];
  for (const source of ALL_COMMAND_SOURCES) {
    const dest = path.join(dir, geminiCommandTarget(source));
    if (!fs.existsSync(dest)) continue;
    if (!isOurCommandFile(dest)) {
      files.push({ path: dest, action: 'kept' });
      continue;
    }
    fs.unlinkSync(dest);
    files.push({ path: dest, action: 'removed' });
  }
  const parents = new Set(ALL_COMMAND_SOURCES.map((s) => path.dirname(path.join(dir, s))));
  for (const parent of parents) {
    try {
      if (parent !== dir && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
        fs.rmdirSync(parent);
      }
    } catch {
      // Leave the directory in place if it can't be removed — never fatal.
    }
  }
  return files;
}

/**
 * Opt-in `--trust` only (REQ-GEMINI-009.A5): shown alongside the policy
 * writer so a user who opted in knows the limits of what the file does.
 */
const TRUST_POLICY_NOTE =
  'Wrote ~/.gemini/policies/specship.toml allowing SpecShip\'s read-only ' +
  'tools. An administrator policy still overrides this file, and ' +
  'run_shell_command confirmations are unaffected.';

/**
 * Gemini's project-level hooks only run when the user has marked the folder
 * as trusted — a local install points the user at that gate so hooks silently
 * failing to run isn't the first evidence something's off.
 */
const LOCAL_TRUST_NOTE =
  'Gemini CLI runs project-level hooks only in folders you have marked as ' +
  'trusted. If the SpecShip hooks seem inert in this project, open it once in ' +
  'Gemini CLI and accept the trust prompt.';

/**
 * SpecShip's prompt / session hooks for Gemini CLI (REQ-GEMINI-010). The
 * schema mirrors Claude's `settings.hooks[event]`: an array of
 * `{ matcher, hooks: [{ type:'command', command }] }` groups. Verified
 * against Gemini CLI 0.28.0 `HookEventName` (BeforeAgent / SessionStart /
 * AfterTool). The commands are byte-identical to the Claude installs — the
 * handlers echo the payload's `hook_event_name` back on their output so one
 * binary serves both hosts.
 */
type GeminiHookSpec = ReadonlyArray<{
  event: string;
  matcher: string;
  hook: { type: 'command'; command: string };
}>;

const GEMINI_HOOKS: GeminiHookSpec = [
  // Prompt-level retrieval nudge — mirror of Claude's UserPromptSubmit.
  {
    event: 'BeforeAgent',
    matcher: '',
    hook: { type: 'command', command: 'specship steer-nudge' },
  },
  // SessionStart cheat-sheet (human-facing, systemMessage).
  {
    event: 'SessionStart',
    matcher: '',
    hook: { type: 'command', command: 'specship cheatsheet' },
  },
  // SessionStart sync + drift summary — one-shot catch-up at session start.
  {
    event: 'SessionStart',
    matcher: '',
    hook: { type: 'command', command: 'specship sync --quiet --drift-summary' },
  },
  // Post-edit sync — Gemini's `write_file` / `replace` tools are the write
  // surface, so matcher is scoped there (parity with Claude's Edit|Write).
  {
    event: 'AfterTool',
    matcher: 'write_file|replace',
    hook: { type: 'command', command: 'specship sync --quiet' },
  },
  // Search-intercept — REQ-GEMINI-011. Advisory redirect on built-in
  // grep_search / glob, plus run_shell_command (which gets classified
  // search-vs-other at hook time; non-search shell commands pass through
  // silently). In strict mode (`SPECSHIP_GEMINI_STRICT=1`) grep_search and
  // glob are denied; run_shell_command NEVER denies.
  {
    event: 'BeforeTool',
    matcher: 'grep_search',
    hook: { type: 'command', command: 'specship search-intercept' },
  },
  {
    event: 'BeforeTool',
    matcher: 'glob',
    hook: { type: 'command', command: 'specship search-intercept' },
  },
  {
    event: 'BeforeTool',
    matcher: 'run_shell_command',
    hook: { type: 'command', command: 'specship search-intercept' },
  },
];

/** SDD governance tier — opt-out via `--no-sdd`, matching the Claude install. */
const GEMINI_SDD_HOOKS: GeminiHookSpec = [
  {
    event: 'BeforeAgent',
    matcher: '',
    hook: { type: 'command', command: 'specship spec-nudge' },
  },
];

/**
 * Idempotently merge Gemini hook entries into `settings.hooks`. Mirrors the
 * Claude target's `writeHooksFor`: a matcher group sharing our exact matcher
 * string is reused, sibling matchers / events are untouched, a byte-equal
 * command is skipped. Returns `unchanged` when nothing was added.
 */
function writeGeminiHooksFor(
  loc: Location,
  hooks: GeminiHookSpec,
): WriteResult['files'][number] {
  const file = settingsPath(loc);
  const created = !fs.existsSync(file);
  const settings = readJsonFile(file);
  const beforeJson = JSON.stringify(settings);

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  for (const { event, matcher, hook } of hooks) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    let group = settings.hooks[event].find((g: any) => g && g.matcher === matcher);
    if (!group) {
      group = { matcher, hooks: [] };
      settings.hooks[event].push(group);
    }
    if (!Array.isArray(group.hooks)) group.hooks = [];
    if (!group.hooks.some((h: any) => h && h.command === hook.command)) {
      group.hooks.push({ ...hook });
    }
  }

  const afterJson = JSON.stringify(settings);
  if (beforeJson === afterJson && !created) {
    return { path: file, action: 'unchanged' };
  }
  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

/**
 * Surgically remove a predicate-matched set of commands from `settings.hooks`,
 * then prune empty matcher groups / events / the top-level `hooks` map.
 * Mirrors Claude's `stripHooksMatching` so sibling user-written hooks survive
 * byte-identical.
 */
function stripGeminiHooksMatching(
  loc: Location,
  predicate: (command: unknown) => boolean,
): WriteResult['files'][number] {
  const file = settingsPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

  const settings = readJsonFile(file);
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { path: file, action: 'unchanged' };
  }

  let removedAny = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((h: any) => !predicate(h?.command));
      if (group.hooks.length !== before) removedAny = true;
    }
  }

  if (!removedAny) return { path: file, action: 'unchanged' };

  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.filter(
      (g: any) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0),
    );
    if (hooks[event].length === 0) delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

/** Write the default (retrieval + sync + cheatsheet) hook set. */
export function writeGeminiHooksEntry(loc: Location): WriteResult['files'][number] {
  return writeGeminiHooksFor(loc, GEMINI_HOOKS);
}

/** Write the governance-tier SDD nudge hook. */
export function writeGeminiSddHooksEntry(loc: Location): WriteResult['files'][number] {
  return writeGeminiHooksFor(loc, GEMINI_SDD_HOOKS);
}

function isGeminiHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return GEMINI_HOOKS.some(({ hook }) => command === hook.command);
}

function isGeminiSddHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return GEMINI_SDD_HOOKS.some(({ hook }) => command === hook.command);
}

/** Inverse of `writeGeminiHooksEntry`. */
export function removeGeminiHooksEntry(loc: Location): WriteResult['files'][number] {
  return stripGeminiHooksMatching(loc, isGeminiHookCommand);
}

/** Inverse of `writeGeminiSddHooksEntry`. */
export function removeGeminiSddHooksEntry(loc: Location): WriteResult['files'][number] {
  return stripGeminiHooksMatching(loc, isGeminiSddHookCommand);
}

/**
 * Policy TOML (REQ-GEMINI-009): auto-allow Gemini's per-tool confirmation
 * for SpecShip's READ-ONLY MCP tools only. User tier by construction — we
 * never write to the admin policies directory, and an admin rule still wins
 * over this one (that is the intended outcome). `run_shell_command` is out
 * of scope: this file removes prompts only for SpecShip's own tools.
 *
 * Verified against Gemini CLI 0.28.0 `loadPoliciesFromToml`: the loader
 * composes `specship__<toolName>` from `mcpName` itself, so every entry here
 * is the BARE server tool name — a prefixed name would match nothing.
 */
function geminiPolicyPath(): string {
  return path.join(os.homedir(), '.gemini', 'policies', 'specship.toml');
}
const GEMINI_POLICY_HEADER_MARKER =
  '# Written by specship install --trust — REQ-GEMINI-009';
const READONLY_TOOLS: readonly string[] = Object.freeze([
  'specship_explore',
  'specship_search',
  'specship_node',
  'specship_callers',
  'specship_callees',
  'specship_impact',
  'specship_files',
  'specship_status',
  'specship_health',
  'specship_spec',
  'specship_drifted',
]);
/** Mid of Gemini's 0–999 priority range: well below admin tiers. */
const POLICY_PRIORITY = 100;

/**
 * Pure string builder for `specship.toml`. Single source for the writer so
 * the on-disk content and any future `printConfig` surface cannot drift.
 */
export function renderGeminiPolicyToml(): string {
  const toolList = READONLY_TOOLS.map((t) => `"${t}"`).join(', ');
  return [
    GEMINI_POLICY_HEADER_MARKER,
    '# User-tier policy auto-allowing SpecShip\'s read-only MCP tools.',
    '# An administrator policy overrides this file. Shell-command',
    '# confirmations (run_shell_command) are not affected.',
    '',
    // Gemini's loader reads `[[rule]]` tables (0.28.0 PolicyFileSchema.rule);
    // any other table name is silently ignored and the policy does nothing.
    '[[rule]]',
    'mcpName = "specship"',
    `toolName = [${toolList}]`,
    'decision = "allow"',
    `priority = ${POLICY_PRIORITY}`,
    '',
  ].join('\n');
}

/**
 * Write `~/.gemini/policies/specship.toml`. Idempotent — byte-identical
 * contents report `unchanged`. Never touches the admin policies directory.
 */
export function writeGeminiPolicyEntry(): WriteResult['files'][number] {
  const file = geminiPolicyPath();
  const content = renderGeminiPolicyToml();
  const existed = fs.existsSync(file);
  if (existed) {
    const current = fs.readFileSync(file, 'utf-8');
    if (current === content) return { path: file, action: 'unchanged' };
    // Never overwrite a user-authored file of the same name — only one that
    // an earlier `--trust` install wrote (it carries our header marker).
    if (!current.startsWith(GEMINI_POLICY_HEADER_MARKER)) return { path: file, action: 'kept' };
  }
  atomicWriteFileSync(file, content);
  return { path: file, action: existed ? 'updated' : 'created' };
}

/**
 * Inverse of `writeGeminiPolicyEntry`. Removes `specship.toml` ONLY if its
 * contents carry our header marker — a user-authored file of the same name
 * is left byte-identical. Sibling files in the policies directory are
 * untouched; the admin policies dir is never written or read.
 */
export function removeGeminiPolicyEntry(): WriteResult['files'][number] {
  const file = geminiPolicyPath();
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };
  const current = fs.readFileSync(file, 'utf-8');
  if (!current.startsWith(GEMINI_POLICY_HEADER_MARKER)) {
    return { path: file, action: 'kept' };
  }
  fs.unlinkSync(file);
  return { path: file, action: 'removed' };
}

// ---------------------------------------------------------------------------
// Skills + explorer subagent (AGENTSWITCH-DOC, REQ-AGENTSWITCH-005)
//
// Verified against gemini-cli 0.28.0 source (not memory):
//   - Skills: `Storage.getUserSkillsDir()` = `~/.gemini/skills`,
//     `getProjectSkillsDir()` = `<project>/.gemini/skills`; the skill loader
//     globs `SKILL.md` and `*/SKILL.md` — the same SKILL.md format Claude Code
//     reads. `skills.enabled` defaults to true.
//   - Subagents: `getUserAgentsDir()` = `~/.gemini/agents`,
//     `getProjectAgentsDir()` = `<project>/.gemini/agents`, one `*.md` with
//     YAML frontmatter validated by a STRICT zod schema (agents/agentLoader):
//     only kind, name, description, display_name, tools (an ARRAY of
//     strings), model, temperature, max_turns, timeout_mins — any other key
//     rejects the file. `tools` entries must pass `isValidToolName`: a
//     built-in, or an MCP `server__tool` name — so `specship__specship_explore`,
//     never the bare `specship_explore` (rejected) nor Claude's
//     `mcp__specship__…` form.
//   - Subagents are OFF by default (`experimental.enableAgents` = false,
//     labelled experimental). We install the file but never flip the setting;
//     the install names the setting in a note instead.
// ---------------------------------------------------------------------------

/** The Gemini CLI version these surfaces were verified against. */
export const GEMINI_MIN_SKILLS = '0.28.0';
export const GEMINI_MIN_AGENTS = '0.28.0';

/**
 * Probe the installed Gemini CLI's version (`gemini --version`). Returns
 * `null` when Gemini is not on PATH or prints no version. `SPECSHIP_GEMINI_VERSION`
 * overrides the probe (tests, and users whose `gemini` is not on PATH);
 * `none` or an empty value means "not found". The real probe is memoised per
 * process — it costs about a second.
 */
let probedGeminiVersion: string | null | undefined;
export function probeGeminiVersion(): string | null {
  const override = process.env.SPECSHIP_GEMINI_VERSION;
  if (override !== undefined) {
    const v = override.trim();
    return v === '' || v.toLowerCase() === 'none' ? null : v;
  }
  if (probedGeminiVersion !== undefined) return probedGeminiVersion;
  let found: string | null = null;
  try {
    const res = spawnSync('gemini', ['--version'], {
      encoding: 'utf-8',
      windowsHide: true,
      // Short: this also runs inside automatic agent set-up (MCP sessions, git hooks).
      timeout: 3000,
      shell: process.platform === 'win32',
    });
    if (res.status === 0) {
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(res.stdout ?? ''));
      if (m) found = m[0];
    }
  } catch {
    found = null;
  }
  probedGeminiVersion = found;
  return found;
}

/** True when `version` (x.y.z, any suffix ignored) is at least `min`. */
export function geminiVersionSupports(version: string | null, min: string): boolean {
  if (!version) return false;
  const parse = (v: string): number[] | null => {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
}

/** Gemini CLI's skills dir for this location (same scope as `settingsPath`). */
export function geminiSkillsDir(loc: Location): string {
  return path.join(path.dirname(settingsPath(loc)), 'skills');
}

/** Gemini CLI's subagents dir for this location. */
export function geminiAgentsDir(loc: Location): string {
  return path.join(path.dirname(settingsPath(loc)), 'agents');
}

/**
 * Rewrite Claude Code's `mcp__specship__<tool>` names in prose to the bare
 * name the Gemini model is shown (DOM-SPECSHIP-007), so the skill and agent
 * bodies name tools the way Gemini does.
 */
function toGeminiToolProse(text: string): string {
  return text.replace(/mcp__specship__/g, '');
}

/** Render one shipped skill file for Gemini (SKILL.md format is shared). */
function renderGeminiSkillFile(name: string): string {
  return toGeminiToolProse(fs.readFileSync(packageAssetPath('skills', name), 'utf-8'));
}

/** Write `content` to `dest` with the installer's idempotency contract. */
function writeIfChanged(dest: string, content: string): WriteResult['files'][number] {
  const existed = fs.existsSync(dest);
  if (existed && fs.readFileSync(dest, 'utf-8') === content) return { path: dest, action: 'unchanged' };
  atomicWriteFileSync(dest, content);
  return { path: dest, action: existed ? 'updated' : 'created' };
}

/**
 * Write SpecShip's skills (`spec-author`, `design-md`) under Gemini's skills
 * dir (REQ-AGENTSWITCH-005.A1). Same file list as the Claude target, so the
 * two installs cannot diverge. Sibling user skills are never touched.
 */
/** Marks a skill directory as written by SpecShip, so install and uninstall touch only their own. */
export const GEMINI_SKILL_MARKER_FILE = '.specship-installed';

/** The top-level skill directories we ship (`spec-author`, `design-md`). */
function shippedSkillRoots(): string[] {
  return [...new Set(SHIPPED_SKILLS.map((f) => f.split('/')[0]!))];
}

/**
 * A skill directory is SpecShip's to write when it does not exist yet, already
 * carries our marker, or holds no SKILL.md (an empty leftover). A directory a
 * user authored — a SKILL.md and no marker — is theirs and is never touched.
 */
function ownsSkillDir(skillDir: string): boolean {
  if (!fs.existsSync(skillDir)) return true;
  if (fs.existsSync(path.join(skillDir, GEMINI_SKILL_MARKER_FILE))) return true;
  return !fs.existsSync(path.join(skillDir, 'SKILL.md'));
}

export function writeGeminiSkillsEntries(loc: Location): WriteResult['files'] {
  const dir = geminiSkillsDir(loc);
  const files: WriteResult['files'] = [];
  for (const root of shippedSkillRoots()) {
    const skillDir = path.join(dir, root);
    const ours = SHIPPED_SKILLS.filter((f) => f.startsWith(root + '/'));
    if (!ownsSkillDir(skillDir)) {
      for (const f of ours) files.push({ path: path.join(dir, f), action: 'kept' });
      continue;
    }
    for (const f of ours) files.push(writeIfChanged(path.join(dir, f), renderGeminiSkillFile(f)));
    writeIfChanged(path.join(skillDir, GEMINI_SKILL_MARKER_FILE), 'Written by specship install (REQ-AGENTSWITCH-005).\n');
  }
  return files;
}

/**
 * Inverse of `writeGeminiSkillsEntries`: delete exactly the files we ship,
 * then prune the per-skill directories left empty. A user skill — or a user
 * file inside one of our skill dirs — survives.
 */
export function removeGeminiSkillsEntries(loc: Location): WriteResult['files'] {
  const dir = geminiSkillsDir(loc);
  const files: WriteResult['files'] = [];
  for (const root of shippedSkillRoots()) {
    const skillDir = path.join(dir, root);
    const marker = path.join(skillDir, GEMINI_SKILL_MARKER_FILE);
    const ours = SHIPPED_SKILLS.filter((f) => f.startsWith(root + '/'));
    // Only a directory SpecShip marked is removed; a user's own skill stays.
    if (!fs.existsSync(marker)) {
      for (const f of ours) {
        const dest = path.join(dir, f);
        files.push({ path: dest, action: fs.existsSync(dest) ? 'kept' : 'not-found' });
      }
      continue;
    }
    for (const f of ours) {
      const dest = path.join(dir, f);
      if (!fs.existsSync(dest)) { files.push({ path: dest, action: 'not-found' }); continue; }
      removeFileSync(dest);
      files.push({ path: dest, action: 'removed' });
    }
    removeFileSync(marker);
  }
  pruneEmptySkillDirs(dir, SHIPPED_SKILLS);
  return files;
}

/** Body marker identifying an agent file a SpecShip install wrote. */
export const GEMINI_AGENT_MARKER = '<!-- Written by specship install — REQ-AGENTSWITCH-005 -->';
const GEMINI_AGENT_FILE = 'specship-explorer.md';

/**
 * Render the shipped `agents/specship-explorer.md` as a Gemini subagent
 * (REQ-AGENTSWITCH-005.A2). Frontmatter is rebuilt with only keys Gemini's
 * strict schema accepts — `model: inherit` is dropped (Gemini would read it as
 * a model id) — and `tools` becomes a YAML array of `specship__<tool>` names.
 * The body names tools by their bare Gemini name. No `mcp__specship__` survives.
 */
export function renderGeminiExplorerAgent(source?: string): string {
  const raw = source ?? fs.readFileSync(packageAssetPath('agents', GEMINI_AGENT_FILE), 'utf-8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error('specship-explorer agent asset has no frontmatter');
  const front = m[1]!;
  const body = m[2]!;
  const field = (key: string): string | undefined => {
    const line = front.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    return line?.slice(key.length + 1).trim();
  };
  const name = field('name') ?? 'specship-explorer';
  const description = field('description') ?? '';
  const tools = (field('tools') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `specship__${t.replace(/^mcp__specship__/, '')}`);
  return [
    '---',
    `name: ${name}`,
    // JSON string = valid YAML double-quoted scalar; the description carries
    // quotes and dashes a plain scalar would mis-parse.
    `description: ${JSON.stringify(description)}`,
    'tools:',
    ...tools.map((t) => `  - ${t}`),
    '---',
    GEMINI_AGENT_MARKER,
    '',
    toGeminiToolProse(body).replace(/^\s+/, ''),
  ].join('\n');
}

/** Write the explorer subagent under Gemini's agents dir. Never overwrites a user file. */
export function writeGeminiAgentsEntry(loc: Location): WriteResult['files'][number] {
  const dest = path.join(geminiAgentsDir(loc), GEMINI_AGENT_FILE);
  const content = renderGeminiExplorerAgent();
  if (fs.existsSync(dest)) {
    const current = fs.readFileSync(dest, 'utf-8');
    if (current === content) return { path: dest, action: 'unchanged' };
    if (!current.includes(GEMINI_AGENT_MARKER)) return { path: dest, action: 'kept' };
    atomicWriteFileSync(dest, content);
    return { path: dest, action: 'updated' };
  }
  atomicWriteFileSync(dest, content);
  return { path: dest, action: 'created' };
}

/** Inverse of `writeGeminiAgentsEntry`: removes the file only if it carries our marker. */
export function removeGeminiAgentsEntry(loc: Location): WriteResult['files'][number] {
  const dest = path.join(geminiAgentsDir(loc), GEMINI_AGENT_FILE);
  if (!fs.existsSync(dest)) return { path: dest, action: 'not-found' };
  if (!fs.readFileSync(dest, 'utf-8').includes(GEMINI_AGENT_MARKER)) return { path: dest, action: 'kept' };
  removeFileSync(dest);
  return { path: dest, action: 'removed' };
}

const AGENTS_EXPERIMENTAL_NOTE =
  'Gemini CLI: installed the specship-explorer subagent, but Gemini subagents are ' +
  'experimental and off by default — set experimental.enableAgents to true in ' +
  'Gemini settings to use it (SpecShip does not change that setting).';

function foundLabel(version: string | null): string {
  return version ? `found ${version}` : 'Gemini CLI version not found';
}

export class GeminiCliTarget implements AgentTarget {
  readonly id = 'gemini' as const;
  readonly traits = GEMINI_CLI_TRAITS;
  readonly displayName = GEMINI_CLI_TRAITS.displayName;
  readonly docsUrl = 'https://google-gemini.github.io/gemini-cli/docs/cli/configuration.html';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  /**
   * REQ-GEMINI-002.A1. `installed` is the same cheap heuristic the Claude
   * target uses — the config dir (or the settings file) being present — rather
   * than shelling out to `gemini --version`.
   */
  detect(loc: Location): DetectionResult {
    const file = settingsPath(loc);
    const config = readJsonFile(file);
    return {
      installed: fs.existsSync(path.dirname(file)) || fs.existsSync(file),
      alreadyConfigured: !!config.mcpServers?.specship,
      configPath: file,
    };
  }

  /**
   * Writes the MCP entry, GEMINI.md steering, hooks, the rendered slash
   * commands and (with `trust`) the policy TOML. `autoAllow` and
   * `installStatusLine` are accepted and IGNORED — Gemini CLI has no
   * permissions list or status line to write them to; auto-allow arrives as
   * `trust` (from `--trust`, or a switch carrying a Claude install's
   * auto-allow over, REQ-AGENTSWITCH-010.A3), and the status line is named
   * as unavailable in the notes (REQ-GEMINI-006, REQ-AGENTSWITCH-010.A4).
   * Nothing under `.claude/` is ever touched (REQ-GEMINI-006.A2).
   */
  install(loc: Location, opts: InstallOptions): WriteResult {
    const integrations: string[] = [
      ...(opts.withJira ? ['jira'] : []),
      ...(opts.withDesigner ? ['designer'] : []),
    ];
    const files: WriteResult['files'] = [writeGeminiMcpEntry(loc, integrations)];
    // REQ-AGENTSWITCH-009: Gemini reads the user's CLAUDE.md in place (never
    // copied). Remember the names we added so uninstall removes only those;
    // names an earlier install added stay remembered across a re-run.
    const contextFiles = writeGeminiContextFilesEntry(loc);
    if (contextFiles.file) files.push(contextFiles.file);
    if (contextFiles.added.length > 0) {
      const prior = readAddedContextFiles(this.id, loc, recordRoot(loc)) ?? [];
      setAddedContextFiles(this.id, loc, recordRoot(loc), [...new Set([...prior, ...contextFiles.added])]);
    }
    // GEMINI.md retrieval preference — always written (REQ-GEMINI-004).
    files.push(writeGeminiInstructionsEntry(loc));
    // SDD rule — default-on, matching the Claude target's governance tier.
    // `--no-sdd` (opts.sdd === false) self-heals by stripping an earlier
    // governance install.
    const includeGovernance = opts.sdd !== false;
    files.push(includeGovernance ? writeGeminiSddEntry(loc) : removeGeminiSddEntry(loc));
    // Prompt / session / tool hooks (REQ-GEMINI-010). Default retrieval tier
    // is always written; the governance SDD nudge rides `--sdd` and
    // self-heals (strip on `--no-sdd`).
    files.push(writeGeminiHooksEntry(loc));
    files.push(includeGovernance ? writeGeminiSddHooksEntry(loc) : removeGeminiSddHooksEntry(loc));
    // Slash commands (REQ-GEMINI-005), rendered from the Claude sources.
    // Same tiering as the Claude target: governance doors ride `--sdd`.
    const commands = writeGeminiCommandsEntries(loc, includeGovernance);
    files.push(...commands.files);
    // REQ-GEMINI-009: strictly opt-in. Omitting `--trust` NEVER touches the
    // policy file — a prior `--trust` install is preserved byte-identical
    // (parity with REQ-INTEG-001.A3).
    // REQ-AGENTSWITCH-010.A4: every feature Gemini has no surface for is
    // named on its own line (from GEMINI_PARITY), never dropped silently.
    const notes: string[] = [CAPABILITY_NOTE, ...noSurfaceNotes(), ...commands.notes];
    // Skills + explorer subagent (REQ-AGENTSWITCH-005), gated on the installed
    // Gemini CLI version. An unknown or older version is skipped WITH a note —
    // never guessed, never fatal (the install still exits 0).
    const version = probeGeminiVersion();
    if (geminiVersionSupports(version, GEMINI_MIN_SKILLS)) {
      files.push(...writeGeminiSkillsEntries(loc));
    } else {
      notes.push(
        `Gemini CLI: skipped skills spec-author, design-md — needs Gemini CLI >= ${GEMINI_MIN_SKILLS} (${foundLabel(version)}).`,
      );
    }
    if (geminiVersionSupports(version, GEMINI_MIN_AGENTS)) {
      files.push(writeGeminiAgentsEntry(loc));
      notes.push(AGENTS_EXPERIMENTAL_NOTE);
    } else {
      notes.push(
        `Gemini CLI: skipped subagent specship-explorer — needs Gemini CLI >= ${GEMINI_MIN_AGENTS} (${foundLabel(version)}).`,
      );
    }
    if (opts.trust === true) {
      files.push(writeGeminiPolicyEntry());
      notes.push(TRUST_POLICY_NOTE);
    }
    if (loc === 'local') notes.push(LOCAL_TRUST_NOTE);
    return { files, notes };
  }

  /**
   * Removes only the `mcpServers.specship` key (REQ-GEMINI-002.A2): sibling
   * servers and every unrelated settings key survive byte-identical, and
   * uninstalling a location that was never installed reports `not-found`
   * rather than throwing.
   */
  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    const file = settingsPath(loc);
    const config = readJsonFile(file);
    if (!config.mcpServers?.specship) {
      files.push({ path: file, action: 'not-found' });
    } else {
      delete config.mcpServers.specship;
      if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
      writeJsonFile(file, config);
      files.push({ path: file, action: 'removed' });
    }
    // REQ-AGENTSWITCH-009.A4: drop only the context file names we added.
    const contextCleanup = removeGeminiContextFilesEntry(
      loc,
      readAddedContextFiles(this.id, loc, recordRoot(loc)),
    );
    if (contextCleanup) files.push(contextCleanup);
    // Hooks (REQ-GEMINI-010.A4) — strip both tiers so uninstall reverses
    // either install path. Each helper is surgical: user-written sibling
    // hooks survive byte-identical.
    const hookCleanup = removeGeminiHooksEntry(loc);
    if (hookCleanup.action === 'removed') files.push(hookCleanup);
    const sddHookCleanup = removeGeminiSddHooksEntry(loc);
    if (sddHookCleanup.action === 'removed') files.push(sddHookCleanup);
    // Strip both GEMINI.md blocks regardless of which tier was selected on
    // install, so uninstall fully reverses either install path
    // (REQ-GEMINI-004.A2). `removeMarkedSection` deletes the file iff
    // removal leaves it empty, so a user-authored GEMINI.md is preserved.
    files.push(removeGeminiInstructionsEntry(loc));
    files.push(removeGeminiSddEntry(loc));
    // Slash commands (REQ-GEMINI-005.A2) — only our marked TOMLs go.
    files.push(...removeGeminiCommandsEntries(loc));
    // REQ-GEMINI-009.A4: strip our policy TOML iff it carries our header
    // marker — a user-authored specship.toml of the same name is left
    // byte-identical. Sibling files in the policies directory survive, and
    // the admin policies dir is never written or read.
    const policyCleanup = removeGeminiPolicyEntry();
    if (policyCleanup.action !== 'not-found') files.push(policyCleanup);
    // REQ-AGENTSWITCH-005: always strip skills + subagent, whatever version is
    // installed now, so uninstall reverses any earlier install.
    files.push(...removeGeminiSkillsEntries(loc).filter((f) => f.action === 'removed'));
    const agentCleanup = removeGeminiAgentsEntry(loc);
    if (agentCleanup.action !== 'not-found') files.push(agentCleanup);
    return { files };
  }

  /**
   * The snippet, verbatim-pasteable into `mcpServers`. Pure string building —
   * touches nothing on disk (REQ-GEMINI-001.A1).
   */
  printConfig(loc: Location): string {
    const snippet = JSON.stringify({ mcpServers: { specship: geminiEntry() } }, null, 2);
    return `# Add to ${settingsPath(loc)}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [settingsPath(loc), geminiMdPath(loc), geminiCommandsDir(loc)];
  }
}

export const geminiTarget = new GeminiCliTarget();
