/**
 * Repo-committed JIRA project binding (REQ-JIRATEAM-001).
 *
 * The binding lives under `jira` inside `specship.config.json` — the same
 * file `src/enforce/enforce.ts` uses for gate configuration (single repo
 * config, `ENFORCE_CONFIG_FILE`). Credentials NEVER live here: a
 * credential-shaped field triggers a hard error naming the file and field,
 * pointing the user at `~/.specship/jira.json`.
 *
 * Precedence (per spec): repo binding wins for project identity even over
 * env, but credentials always come from the user-level config/env. See
 * `resolveJiraCredentials`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ENFORCE_CONFIG_FILE } from '../enforce/enforce';
import { JiraConfigError, JiraRepoBinding } from './types';

/**
 * Field names that must never appear under `jira` in the repo config —
 * these are credential-adjacent (secrets or host URLs that pair with
 * secrets) and belong in the user-level config only.
 */
const FORBIDDEN_FIELDS = [
  'email',
  'apiToken',
  'token',
  'password',
  'username',
  'host',
  'baseUrl',
  'pat',
] as const;

/**
 * Walk up from `cwd` to find a `specship.config.json`. Falls back to the
 * git root (nearest `.git` directory) so bindings work in fresh clones
 * before the file is authored. Returns null if neither is found.
 */
export function findRepoRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  let gitRoot: string | null = null;
  while (true) {
    if (fs.existsSync(path.join(dir, ENFORCE_CONFIG_FILE))) return dir;
    if (gitRoot === null && fs.existsSync(path.join(dir, '.git'))) gitRoot = dir;
    const parent = path.dirname(dir);
    if (parent === dir) return gitRoot;
    dir = parent;
  }
}

/**
 * Reject a repo config whose `jira` block contains a credential-shaped
 * field. The error names the file path and the offending field — the user
 * should see WHY it was rejected and WHERE to put the value instead.
 */
export function assertNoCredentialsInRepoConfig(
  raw: unknown,
  configPath: string,
): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const jira = (raw as { jira?: unknown }).jira;
  if (!jira || typeof jira !== 'object' || Array.isArray(jira)) return;
  const jiraObj = jira as Record<string, unknown>;
  for (const field of FORBIDDEN_FIELDS) {
    if (field in jiraObj) {
      throw new JiraConfigError(
        `Repo config ${configPath} has "jira.${field}" — credentials must ` +
          `live in ~/.specship/jira.json (or SPECSHIP_JIRA_* env), never in the ` +
          `repo. Remove "jira.${field}" and run "specship jira configure".`,
      );
    }
  }
}

/**
 * Load the repo-committed JIRA binding from `specship.config.json` at (or
 * above) `cwd`. Returns `{ binding: null, path: null }` when no file is
 * present or the file has no `jira` block — a repo without a binding falls
 * through to the solo-lane user-level behavior (REQ-JIRATEAM-001.A3).
 */
export function loadRepoJiraBinding(
  cwd: string,
): { binding: JiraRepoBinding | null; path: string | null } {
  const root = findRepoRoot(cwd);
  if (!root) return { binding: null, path: null };
  const configPath = path.join(root, ENFORCE_CONFIG_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return { binding: null, path: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JiraConfigError(
      `Repo config ${configPath} is not valid JSON.`,
    );
  }
  assertNoCredentialsInRepoConfig(parsed, configPath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { binding: null, path: configPath };
  }
  const jira = (parsed as { jira?: unknown }).jira;
  if (!jira || typeof jira !== 'object' || Array.isArray(jira)) {
    return { binding: null, path: configPath };
  }
  const j = jira as Record<string, unknown>;
  const projectKey = typeof j.projectKey === 'string' ? j.projectKey.trim() : '';
  if (!projectKey) {
    throw new JiraConfigError(
      `Repo config ${configPath} has a "jira" block but no "projectKey".`,
    );
  }
  const binding: JiraRepoBinding = { projectKey };
  if (typeof j.storyIssueType === 'string')
    binding.storyIssueType = j.storyIssueType;
  if (typeof j.subtaskIssueType === 'string')
    binding.subtaskIssueType = j.subtaskIssueType;
  if (typeof j.board === 'string' || typeof j.board === 'number')
    binding.board = j.board;
  if (typeof j.sprint === 'string' || typeof j.sprint === 'number')
    binding.sprint = j.sprint;
  if (typeof j.epicKey === 'string' && j.epicKey.trim())
    binding.epicKey = j.epicKey.trim();
  return { binding, path: configPath };
}

/**
 * Merge a partial `jira` binding patch into the committed
 * `specship.config.json` (REQ-JIRATEAM-006 — used when the intake gate
 * accepts a new default `epicKey`). Preserves every other top-level key
 * (`enforce` and any unknown blocks) — same merge discipline as
 * `enableGateChecks` in `src/enforce/enforce.ts`. Creates the file if
 * absent. Never writes credential-adjacent fields.
 */
export function updateRepoJiraBinding(
  projectRoot: string,
  patch: Partial<JiraRepoBinding>,
): { path: string; binding: JiraRepoBinding } {
  const file = path.join(projectRoot, ENFORCE_CONFIG_FILE);
  let cfg: { jira?: unknown; [k: string]: unknown } = {};
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cfg = parsed as { jira?: unknown; [k: string]: unknown };
    }
  } catch {
    // missing / unparseable → start fresh, preserving nothing
  }
  assertNoCredentialsInRepoConfig(cfg, file);
  const existing =
    cfg.jira && typeof cfg.jira === 'object' && !Array.isArray(cfg.jira)
      ? (cfg.jira as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    merged[k] = v;
  }
  if (typeof merged.projectKey !== 'string' || !merged.projectKey.trim()) {
    throw new JiraConfigError(
      `Cannot update ${file}: a "jira.projectKey" is required.`,
    );
  }
  cfg.jira = merged;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  const binding: JiraRepoBinding = { projectKey: String(merged.projectKey).trim() };
  if (typeof merged.storyIssueType === 'string')
    binding.storyIssueType = merged.storyIssueType;
  if (typeof merged.subtaskIssueType === 'string')
    binding.subtaskIssueType = merged.subtaskIssueType;
  if (typeof merged.board === 'string' || typeof merged.board === 'number')
    binding.board = merged.board;
  if (typeof merged.sprint === 'string' || typeof merged.sprint === 'number')
    binding.sprint = merged.sprint;
  if (typeof merged.epicKey === 'string' && merged.epicKey.trim())
    binding.epicKey = merged.epicKey.trim();
  return { path: file, binding };
}

/**
 * Wrap an auth/access failure that occurred against a repo-bound project
 * (REQ-JIRATEAM-001.A4) so the message names the project, host, and the
 * file that bound them — never a silent fallback to another project.
 */
export function wrapRepoBindingProjectError(
  err: Error,
  info: { projectKey: string; host: string; bindingPath: string },
): JiraConfigError {
  return new JiraConfigError(
    `Cannot access JIRA project "${info.projectKey}" on ${info.host} ` +
      `(bound via ${info.bindingPath}). Check your credentials or the binding. ` +
      `Cause: ${err.message}`,
  );
}
