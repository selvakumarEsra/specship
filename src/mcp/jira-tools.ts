/**
 * JIRA MCP tools (REQ-JIRA-002, REQ-JIRA-003).
 *
 * `specship_jira_issues` lists the issues assigned to the authenticated user
 * (identity resolved from the token, never a typed name), optionally narrowed
 * to a project. `specship_jira_issue` fetches a single issue by key with its
 * full detail (description + subtasks). Both read the user-level config,
 * resolve credentials, and drive `JiraClient`.
 *
 * SECURITY (REQ-JIRA-009): the token is never surfaced. Every error path
 * returns only the JiraError's own message — which by construction contains
 * no credential — and the "not configured" path returns a plain pointer to
 * `specship jira configure`, never a partial or fabricated result.
 */

import type { ToolDefinition, ToolResult } from './tools';
import { loadJiraConfig, resolveJiraCredentials } from '../jira/config';
import { JiraClient } from '../jira/client';
import { JiraError, type JiraIssue } from '../jira/types';

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}
function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export const jiraToolDefinitions: ToolDefinition[] = [
  {
    name: 'specship_jira_issues',
    description:
      'List the JIRA issues assigned to you (resolved from your configured ' +
      'token — you never type your own name). Optionally narrow to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Optional project key to narrow the list (e.g., "PROJ"). Omit to list all your assigned issues.',
        },
      },
    },
  },
  {
    name: 'specship_jira_issue',
    description:
      'Fetch a single JIRA issue by key (e.g., "PROJ-123") with its full ' +
      'detail — summary, status, type, description, and any subtasks.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'The issue key to fetch, e.g., "PROJ-123". Required.',
        },
      },
      required: ['key'],
    },
  },
];

/** Render the issue list as compact markdown, or an explicit empty line. */
function formatIssues(issues: JiraIssue[]): string {
  if (issues.length === 0) {
    return 'No issues assigned to you.';
  }
  const lines = issues.map(
    i => `- **${i.key}** — ${i.summary} — ${i.status} — ${i.issueType}`,
  );
  return `Issues assigned to you (${issues.length}):\n\n${lines.join('\n')}`;
}

/** Render a single issue's full detail as markdown. */
function formatIssue(issue: JiraIssue): string {
  const parts = [
    `## ${issue.key} — ${issue.summary}`,
    '',
    `- **Status:** ${issue.status}`,
    `- **Type:** ${issue.issueType}`,
  ];
  const description = issue.description?.trim();
  parts.push('', '### Description', '', description || '_No description._');
  if (issue.subtasks && issue.subtasks.length > 0) {
    parts.push('', `### Subtasks (${issue.subtasks.length})`, '');
    for (const st of issue.subtasks) {
      parts.push(`- **${st.key}** — ${st.summary} — ${st.status}`);
    }
  }
  return parts.join('\n');
}

/**
 * The shared "not configured → clear pointer" gate for the JIRA tools. Returns
 * a pointer `ToolResult` when neither a config file nor env credentials are
 * present, or `null` when configured (the caller proceeds). Never an error
 * stack or a fabricated result.
 */
function notConfiguredResult(): ToolResult | null {
  let hasConfig = false;
  try {
    hasConfig = loadJiraConfig() !== null;
  } catch {
    // A malformed config file still means "configured but broken" — fall
    // through to resolveJiraCredentials, which surfaces the actionable message.
    hasConfig = true;
  }
  const hasEnv = Boolean(process.env.SPECSHIP_JIRA_BASE_URL);
  if (!hasConfig && !hasEnv) {
    return textResult(
      'JIRA is not configured. Run "specship jira configure" to connect a ' +
        'JIRA Cloud or Data Center instance, then try again.',
    );
  }
  return null;
}

/**
 * Handle `specship_jira_issues`. Independent of the code graph — talks only
 * to the configured JIRA host through the stored credentials.
 */
export async function handleSpecshipJiraIssues(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  // Not configured → a clear pointer, never an error stack or a fabricated list.
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const project =
    typeof args.project === 'string' && args.project.trim()
      ? args.project.trim()
      : undefined;

  try {
    const creds = resolveJiraCredentials();
    const client = new JiraClient(creds);
    const result = await client.listMyIssues({ project });
    return textResult(formatIssues(result.issues));
  } catch (err) {
    // JiraError messages are credential-free by construction (REQ-JIRA-009).
    if (err instanceof JiraError) {
      return errorResult(err.message);
    }
    // Defensive: never let an unexpected error leak internals.
    return errorResult('Failed to list JIRA issues.');
  }
}

/**
 * Handle `specship_jira_issue` (REQ-JIRA-003). Fetches a single issue by key
 * and renders its full detail. Independent of the code graph — talks only to
 * the configured JIRA host. A missing/no-access key surfaces as an explicit
 * tool error (A2), never a silent empty result.
 */
export async function handleSpecshipJiraIssue(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  // Not configured → a clear pointer, never an error stack or a fabricated issue.
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  // A missing/blank key is a user mistake, not an internal fault — a clear
  // message, not a stack.
  const key =
    typeof args.key === 'string' && args.key.trim() ? args.key.trim() : undefined;
  if (!key) {
    return textResult(
      'An issue key is required (e.g., "PROJ-123"). Pass it as the "key" argument.',
    );
  }

  try {
    const creds = resolveJiraCredentials();
    const client = new JiraClient(creds);
    const result = await client.getIssue(key);
    return textResult(formatIssue(result.issue));
  } catch (err) {
    // JiraError messages (incl. JiraNotFoundError for a missing/no-access key)
    // are credential-free by construction (REQ-JIRA-009).
    if (err instanceof JiraError) {
      return errorResult(err.message);
    }
    // Defensive: never let an unexpected error leak internals.
    return errorResult('Failed to fetch the JIRA issue.');
  }
}
