/**
 * Google Gemini CLI target — Phase 1 (GEMINI-TARGET-DOC, REQ-GEMINI-002/003).
 *
 * Implements the full `AgentTarget` contract over exactly ONE surface:
 * Gemini CLI's `mcpServers` settings block. Everything the Claude target
 * additionally writes (permissions, auto-sync + steering hooks, slash
 * commands, the `specship-explorer` subagent, the status line) has no Gemini
 * equivalent, so `install` writes none of it and says so in `notes` rather than
 * half-installing it (REQ-GEMINI-006). GEMINI.md steering IS written now
 * (REQ-GEMINI-004) — retrieval preference always, SDD rule by default and
 * opt-out via `--no-sdd`. TOML commands (REQ-GEMINI-005) are still
 * unimplemented — deliberately absent, not faked.
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
  getMcpServerConfig,
  jsonDeepEqual,
  readJsonFile,
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
 * What a Claude install provides that this one does not (REQ-GEMINI-006.A1).
 * One note, naming every still-unsupported surface. As of REQ-GEMINI-010 the
 * prompt / session / tool hooks DO have Gemini equivalents and are installed,
 * so the note no longer lists them; what remains is slash commands (until
 * REQ-GEMINI-005), the specship-explorer subagent, the status line, and the
 * permissions auto-allow list (REQ-GEMINI-009 covers the opt-in policy file).
 */
const CAPABILITY_NOTE =
  'Gemini CLI install wires the MCP server, writes a GEMINI.md steering ' +
  'block, and installs prompt/session/tool hooks. No slash commands, no ' +
  'specship-explorer subagent, and no status line — Gemini CLI has no ' +
  'equivalent surface. The tool playbook itself still lives in the MCP ' +
  'server instructions.';

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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
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

export class GeminiCliTarget implements AgentTarget {
  readonly id = 'gemini' as const;
  readonly displayName = 'Gemini CLI';
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
   * Writes exactly one thing: the MCP entry. `autoAllow`, `sdd` and
   * `installStatusLine` are accepted and IGNORED — Gemini CLI has no
   * permissions, hooks or commands surface to write them to, and faking one
   * would be worse than the note (REQ-GEMINI-006). Nothing under `.claude/`
   * is ever touched (REQ-GEMINI-006.A2).
   */
  install(loc: Location, opts: InstallOptions): WriteResult {
    const integrations: string[] = [
      ...(opts.withJira ? ['jira'] : []),
      ...(opts.withDesigner ? ['designer'] : []),
    ];
    const files: WriteResult['files'] = [writeGeminiMcpEntry(loc, integrations)];
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
    // REQ-GEMINI-009: strictly opt-in. Omitting `--trust` NEVER touches the
    // policy file — a prior `--trust` install is preserved byte-identical
    // (parity with REQ-INTEG-001.A3).
    const notes: string[] = [CAPABILITY_NOTE];
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
    // REQ-GEMINI-009.A4: strip our policy TOML iff it carries our header
    // marker — a user-authored specship.toml of the same name is left
    // byte-identical. Sibling files in the policies directory survive, and
    // the admin policies dir is never written or read.
    const policyCleanup = removeGeminiPolicyEntry();
    if (policyCleanup.action !== 'not-found') files.push(policyCleanup);
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
    return [settingsPath(loc), geminiMdPath(loc)];
  }
}

export const geminiTarget = new GeminiCliTarget();
