/**
 * Claude Code target. Writes:
 *
 *   - MCP server entry to `~/.claude.json` (global = user scope, loads
 *     in every project) or `./.mcp.json` (local = project scope, the
 *     file Claude Code actually reads for a single project). See the
 *     scope table at https://code.claude.com/docs/en/mcp.
 *   - Permissions to `~/.claude/settings.json` (global) or
 *     `./.claude/settings.json` (local), gated on `autoAllow`.
 *   - Instructions to `~/.claude/CLAUDE.md` (global) or
 *     `./.claude/CLAUDE.md` (local).
 *
 * Earlier versions wrote the local MCP entry to `./.claude.json` — a
 * file Claude Code never reads — so the server silently never loaded
 * until the user manually renamed it to `.mcp.json` (issue #207). We
 * now write `./.mcp.json` and migrate any stale `./.claude.json` entry
 * out of the way on install and uninstall.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  getSpecShipPermissions,
  getMcpServerConfig,
  jsonDeepEqual,
  readJsonFile,
  removeMarkedSection,
  upsertMarkedSection,
  writeJsonFile,
} from './shared';
import {
  SPECSHIP_SECTION_END,
  SPECSHIP_SECTION_START,
  SPECSHIP_SDD_SECTION_END,
  SPECSHIP_SDD_SECTION_START,
  getSddRuleBlock,
} from '../instructions-template';

function configDir(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.claude')
    : path.join(process.cwd(), '.claude');
}
function mcpJsonPath(loc: Location): string {
  // global → ~/.claude.json (user scope: visible in every project).
  // local  → ./.mcp.json (project scope: the ONLY project-level MCP
  // file Claude Code reads — NOT ./.claude.json, which it ignores).
  return loc === 'global'
    ? path.join(os.homedir(), '.claude.json')
    : path.join(process.cwd(), '.mcp.json');
}
/**
 * Where pre-#207 installers wrote the local MCP entry. Claude Code
 * never reads a project-level `./.claude.json`, so we migrate the
 * specship entry out of it on install and strip it on uninstall.
 * Only the project-local path is legacy — global `~/.claude.json` is
 * the correct user-scope location and is left untouched.
 */
function legacyLocalMcpPath(): string {
  return path.join(process.cwd(), '.claude.json');
}
function settingsJsonPath(loc: Location): string {
  return path.join(configDir(loc), 'settings.json');
}
function instructionsPath(loc: Location): string {
  return path.join(configDir(loc), 'CLAUDE.md');
}
/**
 * The CLAUDE.md Claude Code actually LOADS as memory — distinct from
 * `instructionsPath` (the legacy `.claude/CLAUDE.md`, which the #529 block
 * used). Project memory is the repo-root `./CLAUDE.md`; user memory is
 * `~/.claude/CLAUDE.md`. The spec-driven-development steering rule goes here so
 * the agent actually reads it.
 */
function claudeMdPath(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.claude', 'CLAUDE.md')
    : path.join(process.cwd(), 'CLAUDE.md');
}
function commandsDir(loc: Location): string {
  return path.join(configDir(loc), 'commands');
}
function agentsDir(loc: Location): string {
  return path.join(configDir(loc), 'agents');
}

/**
 * Resolve a plugin-asset path (`commands/`, `agents/`, …) the installer copies.
 *
 * In the **bundled** distribution only `dist/` ships, so `copy-assets` stages
 * the asset dirs under `dist/` and we resolve `dist/<seg>` first — `__dirname`
 * is `dist/installer/targets/` in the installed package, so `../../<seg>` →
 * `dist/<seg>`. We fall back to the package/repo **root** (`../../../<seg>`) for
 * the non-bundled package and for dev/test runs, where this file executes from
 * `src/installer/targets/` and the assets live at the repo root. Without the
 * dist-first lookup, a bundled install hits `ENOENT … /commands/ss-explore.md`
 * (INSTALL-BUNDLE-ASSETS-DOC).
 */
function packageAssetPath(...segments: string[]): string {
  const fromDist = path.join(__dirname, '..', '..', ...segments);
  const fromRoot = path.join(__dirname, '..', '..', '..', ...segments);
  return fs.existsSync(fromDist) ? fromDist : fromRoot;
}

// Slash commands are a small set of progressive DOORS (WORKFLOW-DOORS-DOC),
// split into two TIERS (INSTALL-WEDGE-DOC, REQ-WEDGE-001.A3). The retrieval door
// is the adoption wedge — it ships on a default install with zero workflow
// change. The governance doors (the spec lifecycle + the gate) are the deliberate
// deep end and ship ONLY on an explicit opt-in (`--sdd`). Each door dispatches its
// sub-actions internally, so a newcomer meets one obvious entry per phase instead
// of a long flat list.

// Commands ship from a `specship/` subdirectory of the commands dir so Claude
// Code surfaces them under the `/specship:` colon namespace (CMD-NS-DOC,
// REQ-CMD-NS-001) — `specship/explore.md` → `/specship:explore`, etc. The names
// below are relative to the commands dir; `copyAsset` creates the `specship/`
// parent directory on write.

/** Retrieval tier — the reads door. Shipped on every install. */
const RETRIEVAL_TIER_COMMANDS = [
  'specship/explore.md', // reads: explore / trace / impact → /specship:explore
] as const;

/** Governance tier — the intent + gate doors. Opt-in (`--sdd`). */
const GOVERNANCE_TIER_COMMANDS = [
  'specship/spec.md',  // intent loop: view / new / fast / design / implement / review / triage / behaviour / domain
  'specship/check.md', // gate & health: check / drifted / fix / relink / health
  'specship/learn.md', // capture door: crystallize this session's workflow as a skill proposal (LEARN-DOC)
  // The design→code flows (design-implement / design-loop) folded into the
  // intent door's `design` sub-route (WORKFLOW-DOORS-DOC, REQ-DOORS-004); their
  // standalone command files are retired via LEGACY_SHIPPED_COMMANDS below.
] as const;

/**
 * Every command SpecShip ships, both tiers. Used by uninstall (which removes
 * the whole surface regardless of which tier was installed) and the dry-run
 * file list.
 */
const SHIPPED_COMMANDS = [...RETRIEVAL_TIER_COMMANDS, ...GOVERNANCE_TIER_COMMANDS] as const;

/**
 * Slash commands the installer used to ship but no longer does, so install can
 * self-heal on upgrade (it removes any an earlier installer wrote, so the user's
 * autocomplete doesn't carry stale duplicates) and uninstall strips them too.
 * Three generations:
 *   - the pre-v0.2 `cg-` prefix (from when SpecShip was "code graph");
 *   - the flat per-action `ss-*` commands collapsed into the explore/spec/check
 *     doors by WORKFLOW-DOORS-DOC (REQ-DOORS-003.A1);
 *   - the flat door commands themselves (`ss-explore`/`ss-spec`/`ss-check` and the
 *     two design commands), retired when the doors moved into the `specship/`
 *     subdirectory / `/specship:` namespace (CMD-NS-DOC, REQ-CMD-NS-003). Listing
 *     them here is what dedupes an upgrading user off the old flat form so they
 *     don't end up with both `/ss-spec` and `/specship:spec` in autocomplete.
 */
const LEGACY_SHIPPED_COMMANDS = [
  // pre-v0.2 `cg-` prefix
  'cg-sync.md',
  'cg-trace.md',
  'cg-explore.md',
  'cg-impact.md',
  'cg-spec.md',
  'cg-implement.md',
  'cg-drifted.md',
  'cg-fix.md',
  'cg-relink.md',
  'cg-spec-author.md',
  'cg-spec-review.md',
  // per-action ss-* commands folded into the doors (WORKFLOW-DOORS-DOC)
  'ss-sync.md',
  'ss-trace.md',
  'ss-impact.md',
  'ss-implement.md',
  'ss-spec-author.md',
  'ss-spec-review.md',
  'ss-brainstorm.md',
  'ss-domain.md',
  'ss-triage.md',
  'ss-behaviour.md',
  'ss-drifted.md',
  'ss-fix.md',
  'ss-relink.md',
  // flat door commands, superseded by the `specship/` subdir (CMD-NS-DOC)
  'ss-explore.md',
  'ss-spec.md',
  'ss-check.md',
  'ss-design-implement.md',
  'ss-design-loop.md',
  // namespaced design→code commands, folded into the intent door's `design`
  // sub-route (WORKFLOW-DOORS-DOC, REQ-DOORS-004). Listed here so an upgrade
  // deletes the files a prior `--sdd` install wrote under `specship/`, leaving
  // no dangling `/specship:design-implement` / `/specship:design-loop` entries.
  'specship/design-implement.md',
  'specship/design-loop.md',
] as const;

/**
 * The flat door filenames whose removal means we just migrated an existing user
 * off the pre-namespace `/ss-*` commands — the trigger for the one-time rename
 * notice (CMD-NS-DOC, REQ-CMD-NS-004). A subset of LEGACY_SHIPPED_COMMANDS: the
 * older folded per-action `ss-*` / `cg-*` files don't warrant the notice, only
 * the door rename does.
 */
const RENAMED_FLAT_DOOR_COMMANDS: readonly string[] = [
  'ss-explore.md',
  'ss-spec.md',
  'ss-check.md',
  'ss-design-implement.md',
  'ss-design-loop.md',
];

/** Subagents the installer copies into Claude's agents dir. */
const SHIPPED_AGENTS = ['specship-explorer.md'] as const;

/** The PostToolUse + SessionStart hooks the installer writes. */
const SPECSHIP_HOOKS = [
  {
    event: 'PostToolUse',
    matcher: 'Edit|Write|MultiEdit',
    hook: { type: 'command', command: 'specship sync --quiet', async: true },
  },
  {
    event: 'SessionStart',
    matcher: 'startup|resume',
    // --drift-summary: one-line drifted-link count at session start, printed
    // only when the queue is non-empty (DRIFT-PUSH-DOC, REQ-DRIFT-PUSH-002).
    hook: { type: 'command', command: 'specship sync --quiet --drift-summary' },
  },
  {
    event: 'SessionStart',
    // `startup` only (not `startup|resume`): the cheat-sheet is a fixed
    // capability map, so it prints once when a session begins and never on
    // resume (CHEATSHEET-DOC, REQ-CHEAT-003). Distinct matcher → its own
    // SessionStart group beside the sync hook above.
    matcher: 'startup',
    hook: { type: 'command', command: 'specship cheatsheet' },
  },
] as const;

/**
 * The spec-driven-development steering hook (SDD-INSTALL-DOC, REQ-SDD-002).
 * A `UserPromptSubmit` hook executed by the harness; `specship spec-nudge`
 * reads the prompt and, on feature/bug-shaped intent, injects a non-blocking
 * reminder to author the spec via spec-author first. UserPromptSubmit has no
 * tool matcher, so the matcher is empty (runs on every prompt; the nudge
 * command does the conservative intent filtering itself).
 */
const SPECSHIP_SDD_HOOKS = [
  {
    event: 'UserPromptSubmit',
    matcher: '',
    hook: { type: 'command', command: 'specship spec-nudge' },
  },
] as const;

/**
 * Retrieval-steering nudge hook (STEER-HOOK-DOC, REQ-STEER-001) — part of the
 * DEFAULT retrieval tier, unlike the opt-in SDD governance hook above. The
 * command is silent when the project has no `.specship/` index or when
 * `SPECSHIP_NO_STEERING=1` is set (REQ-STEER-002), so uninitialized projects
 * get zero prompt noise.
 */
const SPECSHIP_STEER_HOOKS = [
  {
    event: 'UserPromptSubmit',
    matcher: '',
    hook: { type: 'command', command: 'specship steer-nudge' },
  },
] as const;

/**
 * The status-line entry the installer writes into `settings.json`
 * (SHIP-STATUSLINE-DOC). `command` mirrors the MCP launcher (`specship` on
 * PATH); Claude Code pipes the status-line JSON to it on stdin and renders its
 * stdout. The `_specship` marker is how uninstall knows we own this entry — a
 * status line the user authored has no marker and is never touched.
 */
const SPECSHIP_STATUSLINE = {
  type: 'command',
  command: 'specship statusline',
  _specship: true,
} as const;

/** True when a `statusLine` object is one SpecShip wrote (carries our marker). */
function isOurStatusLine(sl: unknown): boolean {
  return !!sl && typeof sl === 'object' && (sl as { _specship?: unknown })._specship === true;
}

class ClaudeCodeTarget implements AgentTarget {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly docsUrl = 'https://docs.claude.com/en/docs/claude-code';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(loc: Location): DetectionResult {
    const mcpPath = mcpJsonPath(loc);
    const config = readJsonFile(mcpPath);
    const alreadyConfigured = !!config.mcpServers?.specship;
    // For "installed" we infer from the existence of either the dir
    // (global) or the project marker file (local). Cheap and avoids
    // shelling out to `claude --version`.
    const installed = loc === 'global'
      ? fs.existsSync(configDir(loc)) || fs.existsSync(mcpPath)
      : fs.existsSync(mcpPath) || fs.existsSync(configDir(loc));
    return { installed, alreadyConfigured, configPath: mcpPath };
  }

  install(loc: Location, opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];

    // Integrations opt-in (INTEG-TIER-DOC, REQ-INTEG-001): the tools that
    // talk to external services ship disabled; these flags enable them via
    // the MCP entry's env. writeMcpEntry unions with a prior install's
    // integrations so upgrades preserve an earlier opt-in.
    const integrations: string[] = [
      ...(opts.withJira ? ['jira'] : []),
      ...(opts.withDesigner ? ['designer'] : []),
    ];

    // 1. MCP server entry
    files.push(writeMcpEntry(loc, integrations));

    // 1b. Migrate away any stale ./.claude.json left by a pre-#207
    // local install, so the project isn't left with two competing
    // (one dead) MCP configs.
    if (loc === 'local') {
      const migrated = cleanupLegacyLocalMcp();
      if (migrated) files.push(migrated);
    }

    // 2. Permissions (only when autoAllow). Designer permissions ride the
    // opt-in; a plain install auto-allows only the local-only core.
    if (opts.autoAllow) {
      files.push(writePermissionsEntry(loc, integrations));
    }

    // 2b. Strip stale auto-sync hooks left by a pre-0.8 install. Those
    // versions wrote `specship mark-dirty` / `sync-if-dirty` hooks to
    // settings.json; both subcommands are gone from the CLI, so the
    // Stop hook now fails every turn with "unknown command
    // 'sync-if-dirty'". Cleaning up on install makes an upgrade
    // self-healing. Only surfaced when something was actually removed.
    const hookCleanup = cleanupLegacyHooks(loc);
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 2b'. Strip the pre-drift-summary SessionStart sync hook so an upgrade
    // doesn't leave it double-syncing beside the new --drift-summary form.
    const sessionHookCleanup = cleanupStaleSessionStartSyncHook(loc);
    if (sessionHookCleanup.action === 'removed') files.push(sessionHookCleanup);

    // 2c. Write the current auto-sync hooks (PostToolUse + SessionStart
    // running `specship sync --quiet`). Gated on autoAllow — same
    // posture as the permissions list since both auto-execute commands
    // without prompting. Idempotent: re-running with identical hooks
    // already in settings.json returns 'unchanged'.
    if (opts.autoAllow) {
      files.push(writeHooksEntry(loc));
    }

    // 3. CLAUDE.md instructions — no longer written. The specship
    // usage guidance now ships solely in the MCP server's `initialize`
    // response (see `mcp/server-instructions.ts`), which Claude Code
    // surfaces in the system prompt automatically. Writing it into
    // CLAUDE.md as well meant the agent read the same playbook twice
    // every turn (issue #529). Strip any block a previous install left
    // behind so an upgrade self-heals — same idiom as the hook cleanup.
    const instrCleanup = removeInstructionsEntry(loc);
    if (instrCleanup.action === 'removed') files.push(instrCleanup);

    // 4. Slash commands + the specship-explorer subagent. NOT gated on
    // autoAllow — these only execute when the user / agent invokes them
    // explicitly. Copies the same .md files that ship for the plugin
    // install path, so the two flows can't drift apart.
    //
    // 4a. Strip any legacy slash commands a prior installer wrote — the pre-v0.2
    // `cg-*` prefix, the folded per-action `ss-*` commands, and (CMD-NS-DOC) the
    // flat door commands superseded by the `specship/` subdir. Self-heals on
    // upgrade so the user's autocomplete doesn't carry stale duplicates.
    // Governance ships BY DEFAULT (INSTALL-WEDGE-DOC v2, REQ-WEDGE-001): the
    // spec / authoring / review / design commands AND the SDD steering are
    // part of a plain install; `--no-sdd` (opts.sdd === false) is the explicit
    // opt-out that yields the old retrieval-only surface.
    const includeGovernance = opts.sdd !== false;
    const legacyRemoved = cleanupLegacyCommandsEntries(loc);
    for (const f of legacyRemoved) files.push(f);
    for (const f of writeCommandsEntries(loc, includeGovernance)) files.push(f);
    for (const f of writeAgentsEntries(loc)) files.push(f);
    // Did we just migrate an existing user off the flat `/ss-*` door commands?
    // (CMD-NS-DOC, REQ-CMD-NS-004) — drives the one-time rename notice below.
    const migratedFlatDoors = legacyRemoved.some((f) =>
      RENAMED_FLAT_DOOR_COMMANDS.includes(path.basename(f.path)),
    );

    // 5. Spec-driven-development steering (SDD-INSTALL-DOC, as superseded by
    // INSTALL-WEDGE-DOC). Part of the governance tier — opt-in via `--sdd`.
    // Writes a marker-delimited "invoke spec-author first" rule into the project
    // CLAUDE.md and a UserPromptSubmit nudge hook. NOT gated on autoAllow — the
    // CLAUDE.md rule executes nothing and the nudge hook only prints guidance.
    if (includeGovernance) {
      files.push(writeSddInstructionsEntry(loc));
      files.push(writeSddHookEntry(loc));
    }

    // 5b. Retrieval-steering nudge hook (STEER-HOOK-DOC, REQ-STEER-001) —
    // DEFAULT tier, always written. High-salience per-prompt steering is the
    // only channel that measurably fixed specship-tool adoption; the hook's
    // command is silent without a project index and honors
    // SPECSHIP_NO_STEERING=1 (REQ-STEER-002), so it adds zero noise where it
    // can't help.
    files.push(writeSteerHookEntry(loc));

    // 6. Status-line segment (SHIP-STATUSLINE-DOC, REQ-STATUSLINE-006).
    // Strictly opt-in — only when the caller set installStatusLine (the
    // interactive prompt, or `--statusline`). Never clobbers a user's existing
    // status line: writeStatusLineEntry returns 'kept' and we surface the
    // composable snippet as a note so the user can wire it in themselves.
    const notes: string[] = [];
    // One-time rename notice (CMD-NS-DOC, REQ-CMD-NS-004): only when this install
    // just removed a flat `/ss-*` door command, so a fresh install stays quiet.
    if (migratedFlatDoors) {
      notes.push(
        'SpecShip slash commands moved from `/ss-*` to the `/specship:*` namespace ' +
        '(e.g. `/ss-spec` → `/specship:spec`, `/ss-explore` → `/specship:explore`). ' +
        'The old commands were removed from your commands directory.',
      );
    }
    // Experimental caveat (INTEG-TIER-DOC, REQ-INTEG-002.A1): Designer drives
    // claude.ai through a debug-Chrome session — an unofficial interface that
    // can break without notice. Say so at the moment of opt-in.
    if (opts.withDesigner) {
      notes.push(
        'Designer integration enabled — EXPERIMENTAL. It drives claude.ai/design through a ' +
        'debug Chrome session (an unofficial interface) and may break without notice when ' +
        'claude.ai changes. Set up the browser side once with `designer setup`.',
      );
    }
    if (opts.withJira) {
      notes.push(
        'JIRA integration enabled. It talks to your Atlassian instance; credentials are stored ' +
        'under ~/.specship (removed by `specship uninstall`). JIRA tools are not auto-allowed — ' +
        'Claude Code will prompt per call.',
      );
    }
    if (opts.installStatusLine) {
      const sl = writeStatusLineEntry(loc);
      files.push(sl);
      if (sl.action === 'kept') {
        notes.push(
          'A status line is already configured — left untouched. Add the SpecShip ' +
          `segment to your own status-line script:\n    ${getStatusLineSnippet()}`,
        );
      }
    }

    return notes.length ? { files, notes } : { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];

    // 1. MCP server entry
    const mcpPath = mcpJsonPath(loc);
    const config = readJsonFile(mcpPath);
    if (config.mcpServers?.specship) {
      delete config.mcpServers.specship;
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      writeJsonFile(mcpPath, config);
      files.push({ path: mcpPath, action: 'removed' });
    } else {
      files.push({ path: mcpPath, action: 'not-found' });
    }

    // 1b. Also strip the specship entry from a legacy ./.claude.json
    // so uninstall fully reverses a pre-#207 local install.
    if (loc === 'local') {
      const migrated = cleanupLegacyLocalMcp();
      if (migrated) files.push(migrated);
    }

    // 2. Permissions
    const settingsPath = settingsJsonPath(loc);
    const settings = readJsonFile(settingsPath);
    if (Array.isArray(settings.permissions?.allow)) {
      const before = settings.permissions.allow.length;
      settings.permissions.allow = settings.permissions.allow.filter(
        (p: string) => !p.startsWith('mcp__specship__'),
      );
      if (settings.permissions.allow.length !== before) {
        if (settings.permissions.allow.length === 0) {
          delete settings.permissions.allow;
        }
        if (Object.keys(settings.permissions).length === 0) {
          delete settings.permissions;
        }
        writeJsonFile(settingsPath, settings);
        files.push({ path: settingsPath, action: 'removed' });
      } else {
        files.push({ path: settingsPath, action: 'not-found' });
      }
    } else {
      files.push({ path: settingsPath, action: 'not-found' });
    }

    // 2b. Strip auto-sync hooks the installer wrote — both the
    // current `specship sync --quiet` form (writeHooksEntry) and the
    // legacy `mark-dirty`/`sync-if-dirty` forms (pre-0.8). Two passes
    // so each predicate stays narrow and we never accidentally strip a
    // user-written hook.
    const currentCleanup = cleanupCurrentHooks(loc);
    if (currentCleanup.action === 'removed') files.push(currentCleanup);
    const legacyCleanup = cleanupLegacyHooks(loc);
    if (legacyCleanup.action === 'removed') files.push(legacyCleanup);

    // 3. Instructions — strip the legacy SpecShip block if present.
    files.push(removeInstructionsEntry(loc));

    // 4. Slash commands + subagent — remove our shipped files; sibling
    // user-written .md files in the same dir are left untouched.
    // Includes legacy `cg-*.md` from pre-v0.2 installers so uninstall
    // leaves the commands dir clean regardless of which prefix was
    // installed.
    for (const f of cleanupLegacyCommandsEntries(loc)) files.push(f);
    for (const f of removeCommandsEntries(loc)) files.push(f);
    for (const f of removeAgentsEntries(loc)) files.push(f);

    // 5. Spec-driven-development steering — strip the CLAUDE.md rule block
    // and the nudge hook (no-op when absent). Always runs so uninstall fully
    // reverses install regardless of whether --no-sdd was used.
    files.push(removeSddInstructionsEntry(loc));
    const sddHookCleanup = cleanupSddHooks(loc);
    if (sddHookCleanup.action === 'removed') files.push(sddHookCleanup);

    // 5b. Retrieval-steering hook — reverse of install step 5b.
    const steerHookCleanup = cleanupSteerHooks(loc);
    if (steerHookCleanup.action === 'removed') files.push(steerHookCleanup);

    // 6. Status-line segment — remove only the marked entry we wrote
    // (REQ-STATUSLINE-007). A user-authored status line has no marker and is
    // left untouched; absent entry is a no-op. Always runs so uninstall fully
    // reverses an opt-in status-line install.
    const slCleanup = removeStatusLineEntry(loc);
    if (slCleanup.action === 'removed') files.push(slCleanup);

    return { files };
  }

  printConfig(loc: Location): string {
    const target = mcpJsonPath(loc);
    const snippet = JSON.stringify({ mcpServers: { specship: getMcpServerConfig() } }, null, 2);
    return `# Add to ${target}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [
      mcpJsonPath(loc),
      settingsJsonPath(loc),
      instructionsPath(loc),
      ...SHIPPED_COMMANDS.map((f) => path.join(commandsDir(loc), f)),
      ...SHIPPED_AGENTS.map((f) => path.join(agentsDir(loc), f)),
    ];
  }
}

/**
 * Per-file write helpers, exported so the legacy `config-writer.ts`
 * shim can call only the named operation (writeMcpConfig writes ONLY
 * the MCP entry, etc.) instead of `claudeTarget.install()` which
 * writes all three files. Without this split the shims silently
 * cause side effects callers don't expect.
 */
export function writeMcpEntry(loc: Location, integrations: string[] = []): WriteResult['files'][number] {
  const file = mcpJsonPath(loc);
  const existing = readJsonFile(file);
  const before = existing.mcpServers?.specship;
  // Integrations a previous install enabled are PRESERVED on upgrade
  // (INTEG-TIER-DOC, REQ-INTEG-001.A3): union the existing entry's
  // SPECSHIP_INTEGRATIONS with what this run requested — a plain re-install
  // never silently disables an opted-in integration.
  const prior = typeof before?.env?.SPECSHIP_INTEGRATIONS === 'string'
    ? before.env.SPECSHIP_INTEGRATIONS.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  const merged = [...new Set([...prior, ...integrations])];
  const after = getMcpServerConfig(merged);

  if (jsonDeepEqual(before, after)) {
    // Already exactly what we'd write — preserve byte-identical file.
    return { path: file, action: 'unchanged' };
  }
  // 'created' here means: the file itself did not exist before this
  // write. A pre-existing MCP JSON file (`~/.claude.json` globally,
  // `./.mcp.json` locally) containing other MCP servers (no
  // `specship` key) is 'updated', not 'created' — we're adding an
  // entry to a file that was already there. Codex uses a different
  // idiom (empty-content => 'created') because its config.toml is
  // ours alone to manage.
  const action: 'created' | 'updated' = before ? 'updated' : (fs.existsSync(file) ? 'updated' : 'created');
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.specship = after;
  writeJsonFile(file, existing);
  return { path: file, action };
}

/**
 * Strip the specship entry from a legacy project-local
 * `./.claude.json` (written by pre-#207 installers, which Claude Code
 * never read). Surgical: only our `specship` key is removed; sibling
 * MCP servers and any unrelated keys are preserved, and the file is
 * deleted only when removal leaves it completely empty. Returns the
 * file action for reporting, or `null` when there's nothing to migrate.
 */
function cleanupLegacyLocalMcp(): WriteResult['files'][number] | null {
  const file = legacyLocalMcpPath();
  if (!fs.existsSync(file)) return null;
  const config = readJsonFile(file);
  if (!config.mcpServers?.specship) return null;
  delete config.mcpServers.specship;
  if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
  if (Object.keys(config).length === 0) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  } else {
    writeJsonFile(file, config);
  }
  return { path: file, action: 'removed' };
}

/**
 * True when a Claude Code hook `command` is one of the **pre-0.8**
 * specship auto-sync hooks: `specship mark-dirty` (PostToolUse) /
 * `specship sync-if-dirty` (Stop). Both subcommands have since been
 * removed from the CLI, so the Stop hook fails every turn with
 * "unknown command 'sync-if-dirty'" — stripping them on install
 * (self-heal on upgrade) is what keeps the upgrade quiet. Local builds
 * also wrote the npx form, which still contains the `specship
 * <subcommand>` substring; the substring match covers both. Sibling
 * user hooks (e.g. GitKraken's `gk ai hook run`) match nothing here.
 *
 * The **current** auto-sync hook form (`specship sync --quiet`) is
 * NOT matched here — install writes those and would re-strip its own
 * work if this predicate covered them. The uninstall flow uses
 * `isCurrentSpecshipHookCommand` for those, on top of this one.
 */
function isLegacySpecshipHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return (
    command.includes('specship mark-dirty') ||
    command.includes('specship sync-if-dirty')
  );
}

/**
 * True when a hook `command` is one of the auto-sync hooks
 * `writeHooksEntry` writes in this release (`specship sync --quiet`).
 * Uninstall-only — install must NOT match these or it would destroy
 * the entries it just wrote.
 */
function isCurrentSpecshipHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return SPECSHIP_HOOKS.some(({ hook }) => command === hook.command);
}

/**
 * Strip specship hook commands matched by `predicate` from Claude
 * `settings.json`. Surgical at the individual-command level: only
 * matched entries are dropped, so a sibling hook sharing a matcher
 * group (or the Stop event) survives. Matcher groups are pruned only
 * once their `hooks` array is empty, events only once they have no
 * groups left, and `hooks` itself only once every event is gone — and
 * none of that runs unless we actually removed a command, so a
 * settings.json with no matching hooks is left byte-for-byte untouched
 * and reported `unchanged`.
 */
function stripHooksMatching(
  loc: Location,
  predicate: (command: unknown, event?: string) => boolean,
): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
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
      group.hooks = group.hooks.filter((h: any) => !predicate(h?.command, event));
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

/**
 * Remove stale **pre-0.8** specship auto-sync hooks
 * (`specship mark-dirty` / `specship sync-if-dirty`) from Claude
 * `settings.json`. Safe to call from both `install` (self-heal on
 * upgrade) and `uninstall`. Exported so it can be unit-tested directly.
 */
export function cleanupLegacyHooks(loc: Location): WriteResult['files'][number] {
  return stripHooksMatching(loc, isLegacySpecshipHookCommand);
}

/**
 * Remove the pre-drift-summary SessionStart auto-sync hook
 * (`specship sync --quiet` on SessionStart). The current SessionStart form
 * carries `--drift-summary` (REQ-DRIFT-PUSH-002); the plain form on that
 * event is a leftover from an earlier install that would otherwise sit
 * beside the new one, double-syncing at session start. Event-scoped so the
 * PostToolUse hook — whose current command is exactly `specship sync
 * --quiet` — is untouched. Install-safe: runs before `writeHooksEntry`.
 */
export function cleanupStaleSessionStartSyncHook(loc: Location): WriteResult['files'][number] {
  return stripHooksMatching(
    loc,
    (command, event) => event === 'SessionStart' && command === 'specship sync --quiet',
  );
}

/**
 * Remove the current-release auto-sync hooks (`specship sync --quiet`)
 * written by `writeHooksEntry`. Uninstall-only — install would
 * destroy its own write if this ran there.
 */
export function cleanupCurrentHooks(loc: Location): WriteResult['files'][number] {
  return stripHooksMatching(loc, isCurrentSpecshipHookCommand);
}

export function writePermissionsEntry(loc: Location, integrations: string[] = []): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const settings = readJsonFile(file);
  const created = !fs.existsSync(file);

  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

  const want = getSpecShipPermissions(integrations);
  const before = [...settings.permissions.allow];
  for (const perm of want) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }
  if (jsonDeepEqual(before, settings.permissions.allow) && !created) {
    return { path: file, action: 'unchanged' };
  }
  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

/**
 * What status line is configured at this location, from SpecShip's point of
 * view (REQ-STATUSLINE-006): `none` (free to write), `ours` (a marked entry we
 * wrote — safe to re-assert), or `foreign` (a status line the user owns — must
 * never be clobbered). Drives the installer's offer-vs-snippet decision.
 */
export function statusLineState(loc: Location): 'none' | 'ours' | 'foreign' {
  const settings = readJsonFile(settingsJsonPath(loc));
  if (!settings.statusLine) return 'none';
  return isOurStatusLine(settings.statusLine) ? 'ours' : 'foreign';
}

/** The one-line snippet a user composes into their own status-line script. */
export function getStatusLineSnippet(): string {
  return 'specship statusline   # pipe Claude\'s status-line JSON in; append its output to your line';
}

/**
 * Write SpecShip's status-line entry into `settings.json`
 * (REQ-STATUSLINE-006). Refuses to overwrite a status line the user already
 * configured: returns `kept` when a foreign `statusLine` is present, so the
 * caller can surface the composable snippet instead. Idempotent — re-asserting
 * our own marked entry byte-for-byte returns `unchanged`.
 */
export function writeStatusLineEntry(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const settings = readJsonFile(file);
  const existing = settings.statusLine;

  // Never clobber a user-authored status line.
  if (existing && !isOurStatusLine(existing)) {
    return { path: file, action: 'kept' };
  }
  if (isOurStatusLine(existing) && jsonDeepEqual(existing, SPECSHIP_STATUSLINE)) {
    return { path: file, action: 'unchanged' };
  }
  const created = !fs.existsSync(file);
  settings.statusLine = { ...SPECSHIP_STATUSLINE };
  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

/**
 * Inverse of `writeStatusLineEntry`: remove the `statusLine` entry ONLY when
 * it is the marked one we wrote (REQ-STATUSLINE-007). A user-authored status
 * line (no marker) is left exactly as-is; an absent entry is a no-op.
 */
export function removeStatusLineEntry(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };
  const settings = readJsonFile(file);
  if (!isOurStatusLine(settings.statusLine)) {
    // Either nothing there, or a user-owned status line — never touch it.
    return { path: file, action: settings.statusLine ? 'kept' : 'not-found' };
  }
  delete settings.statusLine;
  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

/**
 * Strip the marker-delimited SpecShip block from CLAUDE.md if a prior
 * install wrote one. Specship no longer maintains an instructions file
 * (issue #529) — the MCP server's `initialize` instructions are the
 * single source of truth — so both install (self-heal on upgrade) and
 * uninstall call this. `removeMarkedSection` returns `not-found`/`kept`
 * when there's nothing to strip; the install caller drops those from
 * the report so a fresh install stays quiet.
 */
export function removeInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = instructionsPath(loc);
  const action = removeMarkedSection(file, SPECSHIP_SECTION_START, SPECSHIP_SECTION_END);
  return { path: file, action };
}

/**
 * Write specship's auto-sync hooks into Claude `settings.json`. Merges
 * idempotently into any user-defined hooks: a matcher group sharing our
 * exact matcher string is reused; sibling matchers / events / events are
 * untouched. Returns `unchanged` when our two hook commands are already
 * present byte-for-byte in the right places.
 *
 * Gated by `install()` on `autoAllow` — same posture as the permissions
 * list. The matching uninstall lives in `cleanupLegacyHooks` (whose
 * matcher predicate covers BOTH the new `specship sync --quiet` form
 * and the legacy `specship mark-dirty`/`sync-if-dirty` forms).
 */
export function writeHooksEntry(loc: Location): WriteResult['files'][number] {
  return writeHooksFor(loc, SPECSHIP_HOOKS);
}

/**
 * Write the spec-driven-development UserPromptSubmit nudge hook into
 * `settings.json` (SDD-INSTALL-DOC, REQ-SDD-002). Same idempotent merge as
 * the auto-sync hooks; gated by `install()` on `opts.sdd` rather than
 * `autoAllow`, since it's part of the SDD steering feature.
 */
export function writeSddHookEntry(loc: Location): WriteResult['files'][number] {
  return writeHooksFor(loc, SPECSHIP_SDD_HOOKS);
}

/**
 * Write the retrieval-steering UserPromptSubmit hook into `settings.json`
 * (STEER-HOOK-DOC, REQ-STEER-001). Same idempotent merge as the other hooks;
 * part of the default retrieval tier — NOT gated on `--sdd` or autoAllow
 * (the hook only prints guidance and is silent without an index).
 */
export function writeSteerHookEntry(loc: Location): WriteResult['files'][number] {
  return writeHooksFor(loc, SPECSHIP_STEER_HOOKS);
}

type HookSpec = ReadonlyArray<{
  event: string;
  matcher: string;
  hook: { type: string; command: string; async?: boolean };
}>;

/**
 * Idempotently merge a set of hooks into Claude `settings.json`. A matcher
 * group sharing our exact matcher string is reused; sibling matchers / events
 * are untouched; a command already present byte-for-byte is skipped. Returns
 * `unchanged` when nothing was added.
 */
function writeHooksFor(loc: Location, hooks: HookSpec): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const created = !fs.existsSync(file);
  const settings = readJsonFile(file);
  const beforeJson = JSON.stringify(settings);

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  for (const { event, matcher, hook } of hooks) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    let group = settings.hooks[event].find(
      (g: any) => g && g.matcher === matcher,
    );
    if (!group) {
      group = { matcher, hooks: [] };
      settings.hooks[event].push(group);
    }
    if (!Array.isArray(group.hooks)) group.hooks = [];
    // Idempotent: skip if a command-equal entry is already there.
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

/** True when a hook command is the SDD nudge (`specship spec-nudge`). Uninstall-only. */
function isSddHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return SPECSHIP_SDD_HOOKS.some(({ hook }) => command === hook.command);
}

/** Remove the SDD nudge hook written by `writeSddHookEntry`. Uninstall-only. */
export function cleanupSddHooks(loc: Location): WriteResult['files'][number] {
  return stripHooksMatching(loc, isSddHookCommand);
}

/** True when a hook command is the retrieval-steering nudge. Uninstall-only. */
function isSteerHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return SPECSHIP_STEER_HOOKS.some(({ hook }) => command === hook.command);
}

/** Remove the steering hook written by `writeSteerHookEntry`. Uninstall-only. */
export function cleanupSteerHooks(loc: Location): WriteResult['files'][number] {
  return stripHooksMatching(loc, isSteerHookCommand);
}

/**
 * Write the spec-driven-development steering rule into the project CLAUDE.md
 * (SDD-INSTALL-DOC, REQ-SDD-001). Idempotent + marker-delimited so the user's
 * surrounding content is untouched and a re-run reports `unchanged`. Distinct
 * markers from the legacy #529 block — this is the ordering rule, not the MCP
 * playbook.
 */
export function writeSddInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = claudeMdPath(loc);
  const action = upsertMarkedSection(file, SPECSHIP_SDD_SECTION_START, SPECSHIP_SDD_SECTION_END, getSddRuleBlock());
  return { path: file, action };
}

/** Inverse of `writeSddInstructionsEntry`: strip the SDD rule block. */
export function removeSddInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = claudeMdPath(loc);
  const action = removeMarkedSection(file, SPECSHIP_SDD_SECTION_START, SPECSHIP_SDD_SECTION_END);
  return { path: file, action };
}

/**
 * Copy our shipped slash commands (commands/ss-*.md) into the user's
 * commands dir (~/.claude/commands/ globally, ./.claude/commands/
 * locally). Per-file idempotent: a destination with identical bytes is
 * reported `unchanged`. Sibling user-written .md files in the same dir
 * are never touched.
 *
 * The retrieval tier is always written; the governance tier is written only
 * when `includeGovernance` is set (INSTALL-WEDGE-DOC, REQ-WEDGE-001/002). A
 * default install never touches the governance commands — neither writing them
 * nor (since this only ever writes) removing any a prior opt-in left behind, so
 * an existing governance install is preserved on upgrade (REQ-WEDGE-002.A4).
 */
export function writeCommandsEntries(loc: Location, includeGovernance = false): WriteResult['files'] {
  const cmds = includeGovernance ? SHIPPED_COMMANDS : RETRIEVAL_TIER_COMMANDS;
  return cmds.map((name) => copyAsset(packageAssetPath('commands', name), path.join(commandsDir(loc), name)));
}

/**
 * Remove legacy `cg-*.md` slash commands left behind by a pre-v0.2
 * installer. Called from `install()` so an upgrade self-heals (the user
 * doesn't end up with both prefixes side-by-side cluttering their
 * autocomplete) and from `uninstall()` so the legacy files don't
 * persist after specship is removed. Sibling user-written .md files
 * in the same dir are never touched — only the exact filenames in
 * LEGACY_SHIPPED_COMMANDS are candidates.
 */
export function cleanupLegacyCommandsEntries(loc: Location): WriteResult['files'] {
  return LEGACY_SHIPPED_COMMANDS
    .map((name) => removeFile(path.join(commandsDir(loc), name)))
    // Only surface files that actually existed and got removed — keeps
    // the install/uninstall log quiet for users who never had the
    // legacy `cg-*` prefix on disk.
    .filter((entry) => entry.action === 'removed');
}

/**
 * Copy our shipped subagent (agents/specship-explorer.md) into the
 * user's agents dir. Same idempotency contract as writeCommandsEntries.
 */
export function writeAgentsEntries(loc: Location): WriteResult['files'] {
  return SHIPPED_AGENTS.map((name) => copyAsset(packageAssetPath('agents', name), path.join(agentsDir(loc), name)));
}

/**
 * Inverse of writeCommandsEntries: delete each command we shipped under the
 * `specship/` subdir, if present. A file the user replaced with their own
 * content is still removed — match the existing uninstall posture for files
 * specship owns (the user can re-add their version after). The now-empty
 * `specship/` subdir is dropped too (best-effort, only when empty), so a
 * user-authored file placed inside it is preserved (CMD-NS-DOC, REQ-CMD-NS-002).
 */
export function removeCommandsEntries(loc: Location): WriteResult['files'] {
  const removed = SHIPPED_COMMANDS.map((name) => removeFile(path.join(commandsDir(loc), name)));
  const nsDir = path.join(commandsDir(loc), 'specship');
  try {
    if (fs.existsSync(nsDir) && fs.readdirSync(nsDir).length === 0) fs.rmdirSync(nsDir);
  } catch {
    // Leave the directory in place if it can't be removed — never fatal.
  }
  return removed;
}

/** Inverse of writeAgentsEntries. */
export function removeAgentsEntries(loc: Location): WriteResult['files'] {
  return SHIPPED_AGENTS.map((name) => removeFile(path.join(agentsDir(loc), name)));
}

function copyAsset(src: string, dest: string): WriteResult['files'][number] {
  const body = fs.readFileSync(src, 'utf-8');
  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest, 'utf-8');
    if (existing === body) return { path: dest, action: 'unchanged' };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    return { path: dest, action: 'updated' };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  return { path: dest, action: 'created' };
}

function removeFile(p: string): WriteResult['files'][number] {
  if (!fs.existsSync(p)) return { path: p, action: 'not-found' };
  fs.unlinkSync(p);
  return { path: p, action: 'removed' };
}

export const claudeTarget: AgentTarget = new ClaudeCodeTarget();
