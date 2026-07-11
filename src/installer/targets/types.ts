/**
 * Agent target abstraction for the installer.
 *
 * Historically multi-target (Claude Code, Cursor, Codex, opencode, …); the
 * fork is Claude-only now. The interface is preserved so the Claude target's
 * structure (detect/install/uninstall/printConfig/describePaths) stays clean
 * and testable, and so re-adding another agent in the future is one new file
 * + one registry entry. See `targets/registry.ts`.
 */

export type Location = 'global' | 'local';

/** Stable string id for the lone supported target. */
export type TargetId = 'claude';

/**
 * Result of `target.detect(location)`.
 *
 * `installed` is a best-effort heuristic that the agent's CLI / app /
 * config dir is present on this system. `alreadyConfigured` reports
 * whether specship has already been wired in at this location —
 * drives the "Updated"-vs-"Added" log line.
 */
export interface DetectionResult {
  installed: boolean;
  alreadyConfigured: boolean;
  /** Path inspected; surfaced in diagnostic / dry-run output. */
  configPath?: string;
}

/**
 * What `target.install(location)` actually changed on disk. The
 * orchestrator renders one log line per file using `action`.
 *
 * `unchanged` means we touched the file but its contents were already
 * what we'd write — used for byte-identical idempotent re-runs.
 */
export interface WriteResult {
  files: Array<{
    path: string;
    action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept';
  }>;
  /** Optional one-line notes the orchestrator surfaces verbatim. */
  notes?: string[];
}

export interface InstallOptions {
  /**
   * Whether to write Claude's permissions / auto-allow surface
   * (`settings.json`). When false, only the MCP server entry is written.
   */
  autoAllow: boolean;
  /**
   * Whether to install the GOVERNANCE TIER — the spec / authoring / review /
   * design slash commands plus the spec-driven-development steering (a
   * marker-delimited "invoke spec-author first" rule in the project CLAUDE.md
   * and a UserPromptSubmit nudge hook). Opt-in (INSTALL-WEDGE-DOC, superseding
   * SDD-INSTALL-DOC's old on-by-default): off unless explicitly `true` (the
   * `--sdd` flag). A default install provisions only the retrieval tier so the
   * adoption wedge lands clean (REQ-WEDGE-001). Optional; absent/false means
   * retrieval-only.
   */
  sdd?: boolean;
  /**
   * Optional integrations tier (INTEG-TIER-DOC, REQ-INTEG-001). The core
   * install is local-only by construction; each integration that talks to an
   * external service is an explicit opt-in (`--with-jira`, `--with-designer`).
   * Enabling writes `SPECSHIP_INTEGRATIONS` into the MCP server entry's env.
   * An integration a previous install enabled is PRESERVED on upgrade
   * (REQ-INTEG-001.A3) — omitting the flag never disables it.
   */
  withJira?: boolean;
  withDesigner?: boolean;
  /**
   * Whether to wire SpecShip's status-line segment into Claude's `settings.json`
   * (SHIP-STATUSLINE-DOC, REQ-STATUSLINE-006). Opt-in — off unless the user
   * explicitly accepts the install prompt or passes `--statusline`. The writer
   * NEVER overwrites a status line the user already configured; it only writes
   * when none exists (or when re-asserting its own).
   */
  installStatusLine?: boolean;
}

export interface AgentTarget {
  /** Stable id; matches the `TargetId` union. */
  readonly id: TargetId;
  /** Human-readable name shown in prompts and log lines. */
  readonly displayName: string;
  /** Optional URL for "where do I learn more about this agent." */
  readonly docsUrl?: string;
  /** Whether this target supports the given install location. */
  supportsLocation(loc: Location): boolean;
  detect(loc: Location): DetectionResult;
  install(loc: Location, opts: InstallOptions): WriteResult;
  /**
   * Inverse of install. Removes only what install would have written;
   * preserves sibling MCP servers, sibling permissions, and unrelated
   * markdown sections. Must be safe to call when nothing was ever
   * installed (returns `not-found` actions).
   */
  uninstall(loc: Location): WriteResult;
  /**
   * Print the MCP-server snippet a user would paste manually. Used by
   * `specship install --print-config` and the README. Must NOT touch
   * the filesystem.
   */
  printConfig(loc: Location): string;
  /** Filesystem paths this target would write to at this location. */
  describePaths(loc: Location): string[];
}
