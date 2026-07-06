/**
 * JIRA config load / resolve / save (REQ-JIRA-001, A2).
 *
 * Config lives at `~/.specship/jira.json` — **user-level only, never in
 * the project tree** (not even a gitignored project file), because it
 * holds a secret. The path is overridable via `SPECSHIP_JIRA_CONFIG`
 * (mirrors `SPECSHIP_SERVER_CONFIG`) so tests never touch the real home.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeJsonFile } from '../installer/targets/shared';
import {
  JiraConfig,
  JiraCredentials,
  JiraConfigError,
  JiraDeployment,
} from './types';

/**
 * Absolute path to the user-level JIRA config. Overridable via
 * `SPECSHIP_JIRA_CONFIG` for tests. Never project-scoped.
 */
export function jiraConfigPath(): string {
  return (
    process.env.SPECSHIP_JIRA_CONFIG ??
    path.join(os.homedir(), '.specship', 'jira.json')
  );
}

/**
 * Read `~/.specship/jira.json`. Returns `null` when the file is absent.
 * Throws `JiraConfigError` when it exists but is malformed — a corrupt
 * secret file is a hard error, not a silent fall-through to `{}`.
 */
export function loadJiraConfig(): JiraConfig | null {
  const file = jiraConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return null; // absent → not configured
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new JiraConfigError(
        `JIRA config at ${file} is not a JSON object. Re-run "specship jira configure".`,
      );
    }
    return parsed as JiraConfig;
  } catch (err) {
    if (err instanceof JiraConfigError) throw err;
    throw new JiraConfigError(
      `JIRA config at ${file} is not valid JSON. Re-run "specship jira configure".`,
    );
  }
}

/**
 * Infer the deployment kind from which credentials are present. An
 * explicit `deployment` field always wins. Otherwise: a PAT (with no
 * email+token pair) ⇒ Data Center; an email+token pair ⇒ Cloud.
 */
export function inferDeployment(creds: {
  deployment?: JiraDeployment;
  email?: string;
  apiToken?: string;
  pat?: string;
}): JiraDeployment {
  if (creds.deployment) return creds.deployment;
  const hasBasic = Boolean(creds.email && creds.apiToken);
  const hasPat = Boolean(creds.pat);
  if (hasPat && !hasBasic) return 'datacenter';
  if (hasBasic) return 'cloud';
  if (hasPat) return 'datacenter';
  throw new JiraConfigError(
    'Cannot infer JIRA deployment: provide either an email + API token (Cloud) ' +
      'or a personal access token (Data Center).',
  );
}

/**
 * Resolve effective credentials from environment (highest precedence,
 * per-field) then the on-disk config. Throws `JiraConfigError` with an
 * actionable message when required fields are missing or malformed.
 *
 * SECURITY: the thrown messages never include a token or PAT value.
 */
export function resolveJiraCredentials(): JiraCredentials {
  const file = loadJiraConfig(); // may throw on malformed

  const baseUrl = process.env.SPECSHIP_JIRA_BASE_URL ?? file?.baseUrl;
  const email = process.env.SPECSHIP_JIRA_EMAIL ?? file?.email;
  const apiToken = process.env.SPECSHIP_JIRA_API_TOKEN ?? file?.apiToken;
  const pat = process.env.SPECSHIP_JIRA_PAT ?? file?.pat;
  const explicitDeployment = normalizeDeployment(
    process.env.SPECSHIP_JIRA_DEPLOYMENT ?? file?.deployment,
  );

  if (!baseUrl) {
    throw new JiraConfigError(
      'No JIRA base URL configured. Run "specship jira configure" or set ' +
        'SPECSHIP_JIRA_BASE_URL.',
    );
  }

  // Lifecycle transition names (REQ-JIRA-007): env overrides file, per field;
  // an unconfigured project keeps the defaults so status-push still works.
  const inProgress =
    process.env.SPECSHIP_JIRA_TRANSITION_IN_PROGRESS ??
    file?.transitions?.inProgress ??
    'In Progress';
  const inReview =
    process.env.SPECSHIP_JIRA_TRANSITION_IN_REVIEW ??
    file?.transitions?.inReview ??
    'In Review';

  const deployment = inferDeployment({
    deployment: explicitDeployment,
    email,
    apiToken,
    pat,
  });

  if (deployment === 'cloud' && !(email && apiToken)) {
    throw new JiraConfigError(
      'JIRA Cloud requires both an email and an API token. Run ' +
        '"specship jira configure".',
    );
  }
  if (deployment === 'datacenter' && !pat) {
    throw new JiraConfigError(
      'JIRA Data Center requires a personal access token. Run ' +
        '"specship jira configure".',
    );
  }

  return {
    baseUrl,
    deployment,
    email,
    apiToken,
    pat,
    transitions: { inProgress, inReview },
  };
}

/**
 * Persist config to `~/.specship/jira.json` with `0600` permissions —
 * it holds a secret, so it must not be group/world readable.
 */
export function saveJiraConfig(config: JiraConfig): void {
  const file = jiraConfigPath();
  writeJsonFile(file, config as unknown as Record<string, unknown>);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort on platforms without POSIX perms (Windows) */
  }
}

function normalizeDeployment(
  value: string | undefined,
): JiraDeployment | undefined {
  if (value === undefined) return undefined;
  if (value === 'cloud' || value === 'datacenter') return value;
  throw new JiraConfigError(
    `Unknown JIRA deployment "${value}". Use "cloud" or "datacenter".`,
  );
}
