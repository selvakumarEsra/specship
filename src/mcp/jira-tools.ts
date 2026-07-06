/**
 * JIRA MCP tools (REQ-JIRA-002).
 *
 * `specship_jira_issues` lists the issues assigned to the authenticated user
 * (identity resolved from the token, never a typed name), optionally narrowed
 * to a project. It reads the user-level config, resolves credentials, and
 * drives `JiraClient.listMyIssues`.
 *
 * SECURITY (REQ-JIRA-009): the token is never surfaced. Every error path
 * returns only the JiraError's own message — which by construction contains
 * no credential — and the "not configured" path returns a plain pointer to
 * `specship jira configure`, never a partial or fabricated list.
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

/**
 * Handle `specship_jira_issues`. Independent of the code graph — talks only
 * to the configured JIRA host through the stored credentials.
 */
export async function handleSpecshipJiraIssues(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  // Not configured → a clear pointer, never an error stack or a fabricated list.
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
