/**
 * JIRA MCP tools (REQ-JIRA-002, REQ-JIRA-003, REQ-JIRA-004).
 *
 * `specship_jira_issues` lists the issues assigned to the authenticated user
 * (identity resolved from the token, never a typed name), optionally narrowed
 * to a project. `specship_jira_issue` fetches a single issue by key with its
 * full detail (description + subtasks). `specship_jira_pick` fetches an issue
 * and authors a well-formed SpecShip spec from it under `specs/` (idempotent on
 * the issue key). All read the user-level config, resolve credentials, and
 * drive `JiraClient`.
 *
 * SECURITY (REQ-JIRA-009): the token is never surfaced. Every error path
 * returns only the JiraError's own message — which by construction contains
 * no credential — and the "not configured" path returns a plain pointer to
 * `specship jira configure`, never a partial or fabricated result.
 */

import * as path from 'path';
import type { ToolDefinition, ToolResult } from './tools';
import { loadJiraConfig, resolveJiraCredentials } from '../jira/config';
import { JiraClient } from '../jira/client';
import { JiraError, type JiraIssue } from '../jira/types';
import { writeSpecFromIssue, findSpecForIssueKey } from '../jira/spec-writer';
import { reqIdForIssue } from '../jira/spec-generator';

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
  {
    name: 'specship_jira_pick',
    description:
      'Pick a JIRA issue by key (e.g., "PROJ-123") and author a SpecShip spec ' +
      'from it under specs/ — summary becomes the title, description the ' +
      'requirement body, subtasks the acceptance criteria. Re-picking the same ' +
      'issue updates its spec in place rather than creating a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'The issue key to pick, e.g., "PROJ-123". Required.',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'specship_jira_start',
    description:
      'Start implementing a picked JIRA issue: run the bundled spec-implement ' +
      'workflow on the spec that specship_jira_pick authored for the key, in an ' +
      'isolated worktree. Runs to the plan/approve gate and stops there — review ' +
      'the plan, then approve to proceed. Pick the issue first if no spec exists.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'The issue key to start, e.g., "PROJ-123". Required. A spec for it ' +
            'must already exist (run specship_jira_pick first).',
        },
      },
      required: ['key'],
    },
  },
];

/**
 * Dependencies for `handleSpecshipJiraStart`. The DB handle (`specQueries`) and
 * the project root are threaded in from the MCP session's open SpecShip
 * (DOM-SPECSHIP-004: the JIRA tools never `import` the SpecShip package
 * directly). The workflow loader + isolation/executor constructors are seams so
 * tests can stub them and never spawn a real nested spec-implement run.
 */
export interface JiraStartDeps {
  /** SpecQueries handle from the MCP session's open SpecShip. */
  specQueries: unknown;
  /** The SpecShip project root the spec + worktree live under. */
  projectRoot: string;
  /** Loader for the bundled workflow (default: ../workflows/discovery). */
  loadWorkflowByName?: (
    projectRoot: string,
    name: string,
  ) => { workflow: unknown } | null | undefined;
  /** Worktree-provider constructor (default: ../isolation/worktree). */
  WorktreeProvider?: new (specQueries: unknown) => unknown;
  /** Workflow-executor constructor (default: ../workflows/executor). */
  WorkflowExecutor?: new (
    specQueries: unknown,
    worktrees: unknown,
    projectRoot: string,
  ) => JiraStartExecutorLike;
  /** Resolver for the .specship dir (default: ../directory). */
  getSpecShipDir?: (projectRoot: string) => string;
}

/** Minimal shape of a workflow run the executor returns/persists. */
interface JiraStartRunLike {
  id: string;
  status: string;
  errorMessage?: string;
  metadata?: unknown;
}

/** Minimal shape of the executor's `start` result. */
interface JiraStartExecutorLike {
  start(
    workflow: unknown,
    opts: {
      projectRoot: string;
      inputs?: Record<string, string>;
      variables?: Record<string, string>;
    },
  ): Promise<{ run: JiraStartRunLike }>;
}

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

/**
 * Handle `specship_jira_pick` (REQ-JIRA-004). Fetches a single issue by key
 * (reusing the REQ-JIRA-003 path) and authors a well-formed SpecShip spec from
 * it under `specs/`, idempotent on the issue key (A3). Independent of the code
 * graph — talks only to the configured JIRA host. A missing/no-access key
 * surfaces as a `JiraNotFoundError` → tool error, never a written empty spec.
 *
 * SECURITY: the issue summary/description/subtasks are untrusted content; the
 * generator neutralizes any injected spec structure before embedding. No token
 * appears in any output or error (REQ-JIRA-009).
 */
export async function handleSpecshipJiraPick(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  // Not configured → a clear pointer, never an error stack or a written spec.
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  // A missing/blank key is a user mistake, not an internal fault.
  const key =
    typeof args.key === 'string' && args.key.trim() ? args.key.trim() : undefined;
  if (!key) {
    return textResult(
      'An issue key is required (e.g., "PROJ-123"). Pass it as the "key" argument.',
    );
  }

  // The project whose specs/ directory receives the spec. Threaded through the
  // handler args like the other tools' context, falling back to the cwd.
  const projectRoot =
    typeof args.projectPath === 'string' && args.projectPath.trim()
      ? args.projectPath.trim()
      : process.cwd();

  try {
    const creds = resolveJiraCredentials();
    const client = new JiraClient(creds);
    const result = await client.getIssue(key);
    const written = writeSpecFromIssue(result.issue, projectRoot);
    const verb = written.created ? 'Created' : 'Updated';
    return textResult(
      `${verb} spec for ${result.issue.key} at ${written.path}. ` +
        'Run "specship sync" (or let the watcher pick it up) to index it, then ' +
        `run specship_jira_start for ${result.issue.key} to implement it.`,
    );
  } catch (err) {
    // JiraError messages (incl. JiraNotFoundError for a missing/no-access key)
    // are credential-free by construction (REQ-JIRA-009).
    if (err instanceof JiraError) {
      return errorResult(err.message);
    }
    // Defensive: never let an unexpected error leak internals.
    return errorResult('Failed to pick the JIRA issue.');
  }
}

/** Read `metadata.approval.message` off a run, tolerating any metadata shape. */
function approvalMessageOf(run: JiraStartRunLike): string | undefined {
  const approval = (run.metadata as { approval?: { message?: string } } | undefined)
    ?.approval;
  return typeof approval?.message === 'string' ? approval.message : undefined;
}

/**
 * Re-read the persisted run so we see the settled status + approval metadata.
 * `executor.start` returns the pre-finalize in-memory run whose status still
 * reads "running" even after it paused at the approval gate; the DB row carries
 * the real "paused" status + the approval message. Falls back to the returned
 * run when the handle can't look it up (e.g. a stubbed executor in tests).
 */
function reloadRun(specQueries: unknown, run: JiraStartRunLike): JiraStartRunLike {
  const getById = (specQueries as {
    getWorkflowRunById?: (id: string) => JiraStartRunLike | undefined | null;
  } | undefined)?.getWorkflowRunById;
  if (typeof getById !== 'function') return run;
  try {
    return getById.call(specQueries, run.id) ?? run;
  } catch {
    return run;
  }
}

/**
 * Handle `specship_jira_start` (REQ-JIRA-005). Drives the bundled
 * `spec-implement` workflow on the spec `specship_jira_pick` authored for the
 * issue key, in an isolated worktree, and runs it to the first pause — the
 * plan/approve gate (A1). It does NOT block for the full implementation.
 *
 * A2 (failed/rejected → no PR, not past "in progress") falls out for free: this
 * handler never transitions the JIRA issue, and PR-raise (REQ-JIRA-006) + the
 * "in review" transition (REQ-JIRA-007) only fire once the run reaches
 * `completed`. REQ-JIRA-007's "in progress" start-transition is a separate,
 * later dependency and is intentionally NOT built here.
 *
 * SECURITY: no credential is handled or echoed (REQ-JIRA-009). This handler
 * talks to no JIRA host — the spec is already on disk.
 */
export async function handleSpecshipJiraStart(
  args: Record<string, unknown>,
  deps: JiraStartDeps,
): Promise<ToolResult> {
  // Not configured → a clear pointer, never an error stack or a started run.
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  // A missing/blank key is a user mistake, not an internal fault.
  const key =
    typeof args.key === 'string' && args.key.trim() ? args.key.trim() : undefined;
  if (!key) {
    return textResult(
      'An issue key is required (e.g., "PROJ-123"). Pass it as the "key" argument.',
    );
  }

  const projectRoot = deps.projectRoot;
  const specId = reqIdForIssue(key);

  // The spec must already exist — start never silently authors one. If it's
  // absent, point the caller at specship_jira_pick (which writes the spec keyed
  // on this exact issue key, so start then targets the same SPEC_ID).
  if (!findSpecForIssueKey(key, projectRoot)) {
    return textResult(
      `No spec for ${key} was found under specs/. Run specship_jira_pick for ` +
        `${key} first to author it, then run specship_jira_start again.`,
    );
  }

  try {
    const loadWorkflowByName =
      deps.loadWorkflowByName ??
      (await import('../workflows/discovery')).loadWorkflowByName;
    const WorktreeProvider =
      deps.WorktreeProvider ??
      ((await import('../isolation/worktree')).WorktreeProvider as unknown as
        NonNullable<JiraStartDeps['WorktreeProvider']>);
    const WorkflowExecutor =
      deps.WorkflowExecutor ??
      ((await import('../workflows/executor')).WorkflowExecutor as unknown as
        NonNullable<JiraStartDeps['WorkflowExecutor']>);
    const getSpecShipDir =
      deps.getSpecShipDir ?? (await import('../directory')).getSpecShipDir;

    const loaded = loadWorkflowByName(projectRoot, 'spec-implement');
    if (!loaded) {
      return errorResult(
        'The bundled "spec-implement" workflow was not found. Reinstall ' +
          'SpecShip or check `specship workflow list`.',
      );
    }

    const worktrees = new WorktreeProvider(deps.specQueries);
    const executor = new WorkflowExecutor(deps.specQueries, worktrees, projectRoot);
    const started = await executor.start(loaded.workflow, {
      projectRoot,
      inputs: { SPEC_ID: specId },
      variables: {
        ARTIFACTS_DIR: path.join(getSpecShipDir(projectRoot), 'artifacts'),
        CONTEXT: projectRoot,
      },
    });

    const run = reloadRun(deps.specQueries, started.run);

    if (run.status === 'failed') {
      // A2: a failed run raises no PR and never advances the issue past
      // "in progress" — the issue is not transitioned by this handler.
      const why = run.errorMessage ? ` ${run.errorMessage}` : '';
      return errorResult(
        `Implementation run for ${key} (${specId}) failed and no pull request ` +
          `was raised.${why}`,
      );
    }

    // A1: the run reached the plan/approve gate and paused. Surface the
    // approval message + runId; the caller approves (or rejects) to continue.
    const gate = approvalMessageOf(run);
    return textResult(
      `Started spec-implement for ${key} (${specId}). Run ${run.id} is paused ` +
        `at the plan/approve gate — review the plan and approve to proceed.` +
        (gate ? `\n\n${gate}` : '') +
        `\n\nApprove with: specship workflow approve ${run.id}` +
        `\nOr reject with feedback: specship workflow reject ${run.id} --comment "…"`,
    );
  } catch (err) {
    // Defensive: never let an unexpected error leak internals.
    return errorResult(
      `Failed to start implementation for ${key}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
