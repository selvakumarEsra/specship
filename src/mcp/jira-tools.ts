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

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolResult } from './tools';
import { loadJiraConfig, resolveJiraCredentials } from '../jira/config';
import { JiraClient, MAX_ISSUE_RESULTS } from '../jira/client';
import {
  JiraError,
  type JiraIssue,
  type JiraIssueListResult,
  type JiraIssueResult,
  type JiraConnectionResult,
  type JiraTransitionNames,
  type JiraTransitionResult,
} from '../jira/types';
import { writeSpecFromIssue, findSpecForIssueKey, readSpecJiraKey } from '../jira/spec-writer';
import { reqIdForIssue } from '../jira/spec-generator';
import {
  publishSpecToJira,
  writeBackJiraIdentity,
  publishedSpecFilename,
  readFrontmatterValue,
  issueContentFingerprint,
  type PublishJiraClient,
  type SpecPublishSource,
} from '../jira/publish';
import {
  raisePullRequest as defaultRaisePullRequest,
  buildPrTitle,
  buildPrBody,
  type PullRequestOutcome,
} from '../jira/pull-request';

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}
function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The subset of `JiraClient` the status-push paths (REQ-JIRA-007) use. A
 * seam interface so tests inject a fake client and the suite NEVER hits a real
 * JIRA host (and no token is handled in tests).
 */
export interface JiraStatusClient {
  testConnection(): Promise<JiraConnectionResult>;
  assignIssue(key: string, accountId: string): Promise<void>;
  transitionIssue(key: string, nameOrId: string): Promise<JiraTransitionResult>;
  addComment(key: string, body: string): Promise<void>;
}

/** A built status client paired with the resolved transition names. */
export interface JiraStatusContext {
  client: JiraStatusClient;
  transitions: JiraTransitionNames;
}

/**
 * Factory seam that resolves credentials and builds a live `JiraClient` for the
 * status-push paths. The default resolves the user-level config; tests pass a
 * `makeJiraClient` dep returning a fake so no host is contacted. Throws only if
 * credentials are unresolvable — callers wrap it and degrade to a note, never a
 * blocked workflow (REQ-JIRA-007, degrade-gracefully).
 */
function defaultMakeJiraClient(): JiraStatusContext {
  const creds = resolveJiraCredentials();
  return {
    client: new JiraClient(creds),
    transitions: creds.transitions ?? {},
  };
}

/**
 * Push the "start" status to JIRA (REQ-JIRA-007.A1): assign the issue to the
 * authenticated user and transition it toward "in progress". Returns a short
 * human note describing what happened (assigned, moved, or skipped) — or `null`
 * when there's nothing to say. NEVER throws: a JIRA hiccup (auth, network, a
 * missing transition) must not block the local workflow from starting — the
 * note simply reports the skip (reinforcement 4).
 */
async function pushJiraStartStatus(
  key: string,
  make: () => JiraStatusContext,
): Promise<string | null> {
  let ctx: JiraStatusContext;
  try {
    ctx = make();
  } catch (err) {
    return `Note: couldn't push start status to JIRA — ${errMsg(err)}`;
  }
  const notes: string[] = [];

  // Assign to the authenticated user (identity resolved from the token).
  try {
    const conn = await ctx.client.testConnection();
    if (conn.accountId) {
      await ctx.client.assignIssue(key, conn.accountId);
      notes.push(`assigned ${key} to you`);
    }
  } catch (err) {
    notes.push(`couldn't assign ${key} (${errMsg(err)})`);
  }

  // Transition toward "in progress" — a missing transition is a skip, not a
  // failure (A3), and never blocks the run.
  try {
    const target = ctx.transitions.inProgress ?? 'In Progress';
    const res = await ctx.client.transitionIssue(key, target);
    if ('transitioned' in res) {
      notes.push(`moved ${key} to "${res.transitioned}"`);
    } else {
      notes.push(`didn't transition ${key} — ${res.reason}`);
    }
  } catch (err) {
    notes.push(`couldn't transition ${key} (${errMsg(err)})`);
  }

  return notes.length ? `JIRA: ${notes.join('; ')}.` : null;
}

/**
 * Push the "PR raised" status to JIRA (REQ-JIRA-007.A2): transition the issue
 * toward "in review" and comment the PR link on it. When the configured
 * transition doesn't exist for this workflow, it still comments the PR link and
 * reports the skip (A3) rather than erroring. Returns a human note. NEVER
 * throws — a JIRA-side failure must not undo the raised PR.
 *
 * SECURITY: only the public PR URL + issue key are sent (REQ-JIRA-009).
 */
async function pushJiraReviewStatus(
  key: string,
  prUrl: string,
  make: () => JiraStatusContext,
): Promise<string | null> {
  let ctx: JiraStatusContext;
  try {
    ctx = make();
  } catch (err) {
    return `Note: couldn't push review status to JIRA — ${errMsg(err)}`;
  }
  const notes: string[] = [];

  try {
    const target = ctx.transitions.inReview ?? 'In Review';
    const res = await ctx.client.transitionIssue(key, target);
    if ('transitioned' in res) {
      notes.push(`moved ${key} to "${res.transitioned}"`);
    } else {
      // A3: the transition is unavailable — still comment, report the skip.
      notes.push(`didn't transition ${key} — ${res.reason}`);
    }
  } catch (err) {
    notes.push(`couldn't transition ${key} (${errMsg(err)})`);
  }

  // The PR-link comment is posted regardless of the transition outcome (A3).
  try {
    await ctx.client.addComment(key, `SpecShip raised a pull request: ${prUrl}`);
    notes.push(`commented the PR link on ${key}`);
  } catch (err) {
    notes.push(`couldn't comment the PR link on ${key} (${errMsg(err)})`);
  }

  return notes.length ? `JIRA: ${notes.join('; ')}.` : null;
}

/** Extract a credential-free message from an unknown error (REQ-JIRA-009). */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  {
    name: 'specship_jira_track',
    description:
      'Show a read-only tracking view of every JIRA issue you have brought into ' +
      "SpecShip: each row joins the issue's SpecShip work-state (spec authored → " +
      'implementing → PR raised → verified) with its LIVE JIRA status (a fresh ' +
      'read at track time, so an issue moved outside SpecShip reflects its current ' +
      'status). Read-only — it never re-picks or re-starts anything. Optionally ' +
      'narrow the JIRA read to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Optional project key to narrow the live JIRA read (e.g., "PROJ"). Omit to read all your assigned issues.',
        },
      },
    },
  },
  {
    name: 'specship_jira_publish',
    description:
      'Publish an authored spec to JIRA as a Story whose Sub-tasks mirror the ' +
      "spec's acceptance criteria, and write the created key back into the " +
      "spec's frontmatter so commits, branches, PRs, and tracking all carry " +
      'it. Idempotent: re-publishing a spec that already has a jira_issue key ' +
      'updates the existing Story and creates only missing Sub-tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_id: {
          type: 'string',
          description:
            'The requirement spec id to publish, e.g., "REQ-AUTH-001". Required.',
        },
        project: {
          type: 'string',
          description:
            'JIRA project key to create the Story in (e.g., "PROJ"). Optional when a default project is configured; omitted with no default, the tool returns the projects your account can access so the user can choose.',
        },
      },
      required: ['spec_id'],
    },
  },
  {
    name: 'specship_jira_transition',
    description:
      'Transition a JIRA issue to a target workflow state (e.g., "In Progress", ' +
      '"Done"). With no state, lists the transitions the issue currently offers. ' +
      "A state the issue's workflow doesn't offer is reported with the available " +
      'states and nothing is written — never applied, never an error.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The issue key to transition, e.g., "PROJ-123". Required.',
        },
        state: {
          type: 'string',
          description:
            'Target state name or transition id (e.g., "Done"). Omit to list the ' +
            "issue's currently available transitions.",
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
    onRunCompleted?: (run: JiraStartRunLike) => void | Promise<void>,
  ) => JiraStartExecutorLike;
  /** Resolver for the .specship dir (default: ../directory). */
  getSpecShipDir?: (projectRoot: string) => string;
  /**
   * PR-raise seam (default: ../jira/pull-request). Stubbed in tests so the
   * suite NEVER runs a real `git push` / `gh pr create` (REQ-JIRA-006).
   */
  raisePullRequest?: typeof defaultRaisePullRequest;
  /**
   * Isolation-env lookup seam (default: specQueries.getIsolationEnvById).
   * Resolves the run's worktree branch + path at completion.
   */
  getIsolationEnvById?: (id: string) => IsolationEnvLike | null | undefined;
  /**
   * JIRA status-client factory (default: resolve creds + new JiraClient).
   * Stubbed in tests so the start-status push (assign + in-progress
   * transition, REQ-JIRA-007.A1) never hits a real host. Threaded through to
   * the completion hook for the PR-raised status push too.
   */
  makeJiraClient?: () => JiraStatusContext;
}

/** Minimal shape of an isolation env the completion handler needs. */
export interface IsolationEnvLike {
  branchName: string;
  workingPath: string;
  metadata?: unknown;
}

/** Dependencies for `handleJiraRunCompletion` — all stubbable, no real shell. */
export interface JiraCompletionDeps {
  /** Resolve the run's worktree (branch + path) by isolation-env id. */
  getIsolationEnvById: (id: string) => IsolationEnvLike | null | undefined;
  /** PR-raise seam (default: ../jira/pull-request). */
  raisePullRequest?: typeof defaultRaisePullRequest;
  /** Repo root fallback when the env metadata omits it. */
  projectRoot?: string;
  /** Where to surface the outcome (default: console.log). */
  log?: (message: string) => void;
  /**
   * JIRA status-client factory (default: resolve creds + new JiraClient).
   * Stubbed in tests so the PR-raised status push (in-review transition + PR
   * comment, REQ-JIRA-007.A2) never hits a real host.
   */
  makeJiraClient?: () => JiraStatusContext;
}

/** Minimal shape of a workflow run the executor returns/persists. */
interface JiraStartRunLike {
  id: string;
  status: string;
  errorMessage?: string;
  isolationEnvId?: string;
  metadata?: unknown;
}

/** Minimal shape of the executor's `start` result. */
interface JiraStartExecutorLike {
  start(
    workflow: unknown,
    opts: {
      projectRoot: string;
      runId?: string;
      branchName?: string;
      inputs?: Record<string, string>;
      variables?: Record<string, string>;
      runMetadata?: Record<string, unknown>;
    },
  ): Promise<{ run: JiraStartRunLike }>;
}

/** Escape a value so it can't break the markdown table layout. */
function cell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/**
 * Render the assigned-issue list professionally (REQ-JIRA-002.A6): a table
 * (key/summary/status/type) with NO conversational preamble, and a terse bottom
 * note ONLY when there's something to flag — a project filter is applied, or the
 * result hit the fetch cap. The caller relays this verbatim, so the output is
 * self-sufficient. Empty → one explicit line plus a short actionable note.
 */
function formatIssues(issues: JiraIssue[], opts?: { project?: string }): string {
  if (issues.length === 0) {
    return (
      'No issues assigned to you.\n\n' +
      '> Note: pass a project key to narrow the search, or confirm the ' +
      'configured token maps to the intended account.'
    );
  }
  const table = [
    '| Key | Summary | Status | Type |',
    '| --- | --- | --- | --- |',
    ...issues.map(
      i => `| ${cell(i.key)} | ${cell(i.summary)} | ${cell(i.status)} | ${cell(i.issueType)} |`,
    ),
  ].join('\n');

  const notes: string[] = [];
  if (opts?.project) notes.push(`Filtered to project ${cell(opts.project)}.`);
  if (issues.length >= MAX_ISSUE_RESULTS) {
    notes.push(`Showing the ${MAX_ISSUE_RESULTS} most recently updated.`);
  }
  return notes.length ? `${table}\n\n> Note: ${notes.join(' ')}` : table;
}

/**
 * Render a single issue's detail professionally (REQ-JIRA-003.A3): a title, a
 * property table (status, type), the description, and a subtasks table — no
 * conversational narration. The caller relays this verbatim.
 */
function formatIssue(issue: JiraIssue): string {
  const parts = [
    `### ${cell(issue.key)} — ${cell(issue.summary)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Status | ${cell(issue.status)} |`,
    `| Type | ${cell(issue.issueType)} |`,
  ];
  const description = issue.description?.trim();
  parts.push('', '**Description**', '', description || '_No description._');
  if (issue.subtasks && issue.subtasks.length > 0) {
    parts.push('', '**Subtasks**', '', '| Key | Summary | Status |', '| --- | --- | --- |');
    for (const st of issue.subtasks) {
      parts.push(`| ${cell(st.key)} | ${cell(st.summary)} | ${cell(st.status)} |`);
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
    return textResult(formatIssues(result.issues, { project }));
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
 * Handle `specship_jira_transition` (REQ-JIRATRANS-001). Move a tracked issue
 * to a target state, or — with no `state` — list the transitions the issue
 * currently offers. Reuses `JiraClient.transitionIssue`, so a target the
 * workflow doesn't offer returns a skip that names the available states and
 * writes nothing (REQ-JIRATRANS-001.A4); auth/host faults surface the client's
 * credential-free error (A5). Independent of the code graph.
 */
export async function handleSpecshipJiraTransition(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const key =
    typeof args.key === 'string' && args.key.trim() ? args.key.trim() : undefined;
  if (!key) {
    return textResult(
      'An issue key is required (e.g., "PROJ-123"). Pass it as the "key" argument.',
    );
  }
  const state =
    typeof args.state === 'string' && args.state.trim()
      ? args.state.trim()
      : undefined;

  try {
    const creds = resolveJiraCredentials();
    const client = new JiraClient(creds);

    // No target → list the currently available transitions (A3).
    if (!state) {
      const names = (await client.listTransitions(key)).map((t) => t.name);
      return textResult(
        names.length
          ? `${key} can transition to: ${names.join(', ')}.`
          : `${key} has no available transitions from its current state.`,
      );
    }

    const res = await client.transitionIssue(key, state);
    if ('transitioned' in res) {
      return textResult(`Moved ${key} to "${res.transitioned}".`);
    }
    // Skip (A4) — the reason already names the available states.
    return textResult(`Did not transition ${key} — ${res.reason}.`);
  } catch (err) {
    // JiraError messages are credential-free by construction (REQ-JIRA-009).
    if (err instanceof JiraError) {
      return errorResult(err.message);
    }
    return errorResult('Failed to transition the JIRA issue.');
  }
}

/** One configured lifecycle transition checked against a sampled issue's workflow. */
export interface TransitionCheck {
  role: 'inProgress' | 'inReview' | 'done';
  configured: string;
  /** Whether `configured` is among the sampled issue's currently available transitions. */
  found: boolean;
}

/** Result of {@link validateConfiguredTransitions} (REQ-JIRATRANS-002). */
export interface TransitionValidation {
  /** False when no issue could be sampled or its transitions couldn't be read (A4). */
  verified: boolean;
  /** The issue whose live transitions were sampled, or null when none was available. */
  sampleKey: string | null;
  /** The sampled issue's currently available transition names. */
  available: string[];
  /** Per-configured-transition presence. Empty when `verified` is false. */
  checks: TransitionCheck[];
}

/** Minimal client slice {@link validateConfiguredTransitions} needs (eases testing). */
export interface TransitionValidationClient {
  listMyIssues(opts?: { project?: string }): Promise<JiraIssueListResult>;
  listTransitions(key: string): Promise<Array<{ id: string; name: string }>>;
}

/**
 * Validate the configured lifecycle transition names against a live workflow
 * (REQ-JIRATRANS-002). Samples one issue (an explicit `sampleKey`, else the
 * first assigned issue) and reads the transitions it currently offers, then
 * reports whether each configured name (`inProgress`/`inReview`/`done`) is
 * among them. When no issue can be sampled or its transitions can't be read,
 * returns `verified: false` — a "couldn't verify", never a false "missing"
 * and never a throw (A4). Availability is state-scoped: it reflects the sampled
 * issue's CURRENT state, which the caller surfaces so the check isn't misread
 * as the whole workflow.
 */
export async function validateConfiguredTransitions(
  client: TransitionValidationClient,
  transitions: { inProgress?: string; inReview?: string; done?: string },
  opts: { project?: string; sampleKey?: string } = {},
): Promise<TransitionValidation> {
  let sampleKey = opts.sampleKey ?? null;
  if (!sampleKey) {
    try {
      const { issues } = await client.listMyIssues({ project: opts.project });
      sampleKey = issues[0]?.key ?? null;
    } catch {
      sampleKey = null;
    }
  }
  if (!sampleKey) {
    return { verified: false, sampleKey: null, available: [], checks: [] };
  }

  let available: string[];
  try {
    available = (await client.listTransitions(sampleKey)).map((t) => t.name);
  } catch {
    return { verified: false, sampleKey, available: [], checks: [] };
  }

  const lower = new Set(available.map((n) => n.toLowerCase()));
  const roles: Array<[TransitionCheck['role'], string]> = [
    ['inProgress', transitions.inProgress ?? 'In Progress'],
    ['inReview', transitions.inReview ?? 'In Review'],
    ['done', transitions.done ?? 'Done'],
  ];
  const checks: TransitionCheck[] = roles.map(([role, configured]) => ({
    role,
    configured,
    found: lower.has(configured.toLowerCase()),
  }));
  return { verified: true, sampleKey, available, checks };
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

/** Read the H1 title out of a spec file, falling back to `fallback`. */
function readSpecTitle(specPath: string | null, fallback: string): string {
  if (!specPath) return fallback;
  try {
    const content = fs.readFileSync(specPath, 'utf8');
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      const m = line.match(/^#\s+(.+)$/);
      if (m) return m[1]!.trim() || fallback;
    }
  } catch {
    /* fall through to the fallback */
  }
  return fallback;
}

/** The `jira` block a JIRA-started run carries in its metadata. */
interface JiraRunMeta {
  issueKey?: string;
  specId?: string;
  title?: string;
}

/** Recover the `jira` metadata block off a run, tolerating any metadata shape. */
function jiraMetaOf(run: { metadata?: unknown }): JiraRunMeta | undefined {
  const jira = (run.metadata as { jira?: JiraRunMeta } | undefined)?.jira;
  return jira && typeof jira === 'object' ? jira : undefined;
}

/**
 * True when the run's verify leg RAN AND PASSED — the only state that raises a
 * PR (REQ-JIRA-006.A1; aligns with REQ-JIRA-005.A2). A verify that FAILED halts
 * the run before completion (status `failed`), and a SKIPPED verify
 * (`VERIFY_RESULT=skipped`) completes the run but must NOT raise a PR — tests
 * that did not run are never treated as a pass.
 */
function verifyPassed(run: { metadata?: unknown }): boolean {
  const meta = (run.metadata as Record<string, unknown> | undefined) ?? {};
  const states = meta.nodeStates as Record<string, string> | undefined;
  if (states && states.verify && states.verify !== 'completed') return false;
  const outputs = meta.outputs as Record<string, { text?: string }> | undefined;
  const verifyText = outputs?.verify?.text ?? '';
  return /VERIFY_RESULT=ran-and-passed/.test(verifyText);
}

/**
 * Completion hook for a JIRA-started run (REQ-JIRA-006). Fires only once the
 * run has settled to `completed`. Raises a PR — traceable to the issue via the
 * key in the branch name, PR title, AND body — ONLY when the run's verify leg
 * ran and passed. On any PR-tooling failure it surfaces the reason and leaves
 * the branch + worktree fully intact for a manual PR (A3); it NEVER auto-merges
 * or closes the PR (the human owns "done"). A non-JIRA run is a silent no-op.
 *
 * SECURITY: no JIRA token/secret appears in the PR title/body/logs — only the
 * public issue key (REQ-JIRA-009).
 */
export async function handleJiraRunCompletion(
  run: JiraStartRunLike,
  deps: JiraCompletionDeps,
): Promise<PullRequestOutcome | null> {
  const jira = jiraMetaOf(run);
  const issueKey = jira?.issueKey;
  if (!issueKey) return null; // not a JIRA-started run — nothing to do.

  const log = deps.log ?? ((m: string) => {
    // eslint-disable-next-line no-console
    console.log(m);
  });

  // A1: a completed-but-unverified run (verify skipped) raises NO PR.
  if (!verifyPassed(run)) {
    log(
      `Run for ${issueKey} completed but its verification did not pass — no ` +
        'pull request was raised.',
    );
    return null;
  }

  if (!run.isolationEnvId) {
    log(
      `Run for ${issueKey} completed but has no worktree on record — no pull ` +
        'request was raised.',
    );
    return null;
  }

  const env = deps.getIsolationEnvById(run.isolationEnvId);
  if (!env) {
    log(
      `Run for ${issueKey} completed but its worktree could not be resolved — ` +
        'no pull request was raised.',
    );
    return null;
  }

  const meta = (env.metadata as Record<string, unknown> | undefined) ?? {};
  const repoRoot =
    (typeof meta.repoRoot === 'string' ? meta.repoRoot : undefined) ??
    deps.projectRoot ??
    process.cwd();

  const specTitle = jira.title ?? jira.specId ?? issueKey;
  const raise = deps.raisePullRequest ?? defaultRaisePullRequest;
  const outcome = await raise({
    repoRoot,
    branchName: env.branchName,
    worktreePath: env.workingPath,
    issueKey,
    title: buildPrTitle(issueKey, specTitle),
    body: buildPrBody(issueKey, specTitle),
  });

  if (outcome.ok) {
    log(`Raised pull request for ${issueKey}: ${outcome.url}`);
    // A2: PR raised → transition toward "in review" and comment the PR link.
    // Only on a raised PR — a failed raise never advances the issue (below),
    // matching REQ-JIRA-005.A2 (leave it in-progress). Never throws.
    const make = deps.makeJiraClient ?? defaultMakeJiraClient;
    const note = await pushJiraReviewStatus(issueKey, outcome.url, make);
    if (note) log(note);
  } else {
    // A3 (of REQ-JIRA-006) / A2 (of REQ-JIRA-005): report the reason; the
    // branch + worktree are left intact upstream and the issue is NOT
    // transitioned (it stays in-progress).
    log(outcome.message);
  }
  return outcome;
}

/**
 * Handle `specship_jira_start` (REQ-JIRA-005). Drives the bundled
 * `spec-implement` workflow on the spec `specship_jira_pick` authored for the
 * issue key, in an isolated worktree, and runs it to the first pause — the
 * plan/approve gate (A1). It does NOT block for the full implementation.
 *
 * On the non-failed path it pushes the "start" status back to JIRA
 * (REQ-JIRA-007.A1): assigns the issue and transitions it toward "in progress".
 * That push NEVER blocks the workflow — a JIRA hiccup (auth, network, a missing
 * transition) is surfaced as a note, not an error. A failed/rejected run
 * (REQ-JIRA-005.A2) raises no PR and is never advanced past "in progress"; the
 * "in review" transition + PR comment (REQ-JIRA-007.A2) fire only once the run
 * reaches `completed` with a verified, raised PR.
 *
 * SECURITY: the credential is handled only inside `JiraClient` and never
 * echoed (REQ-JIRA-009); only the public issue key / PR URL are surfaced.
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
  const specPath = findSpecForIssueKey(key, projectRoot);
  if (!specPath) {
    return textResult(
      `No spec for ${key} was found under specs/. Run specship_jira_pick for ` +
        `${key} first to author it, then run specship_jira_start again.`,
    );
  }
  const specTitle = readSpecTitle(specPath, specId);

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

    // Carry the issue key in the branch name too (specship/<key>-<shortRunId>)
    // so JIRA's dev panel matches on branch + PR title + PR body (REQ-JIRA-006).
    const runId = randomUUID();
    const shortRunId = runId.substring(0, 8);
    const branchSlug = key.replace(/[^A-Za-z0-9._/-]/g, '-').replace(/-+/g, '-');
    const branchName = `specship/${branchSlug}-${shortRunId}`;

    // Completion deps: the PR is raised only when the run later resumes to
    // `completed` with a passing verify. Non-JIRA runs no-op this hook.
    const completionDeps: JiraCompletionDeps = {
      getIsolationEnvById:
        deps.getIsolationEnvById ??
        ((id: string) =>
          (deps.specQueries as {
            getIsolationEnvById?: (id: string) => IsolationEnvLike | null;
          }).getIsolationEnvById?.(id)),
      raisePullRequest: deps.raisePullRequest,
      projectRoot,
      makeJiraClient: deps.makeJiraClient,
    };

    const worktrees = new WorktreeProvider(deps.specQueries);
    const executor = new WorkflowExecutor(
      deps.specQueries,
      worktrees,
      projectRoot,
      async (completedRun) => {
        await handleJiraRunCompletion(completedRun, completionDeps);
      },
    );
    const started = await executor.start(loaded.workflow, {
      runId,
      branchName,
      projectRoot,
      inputs: { SPEC_ID: specId },
      variables: {
        ARTIFACTS_DIR: path.join(getSpecShipDir(projectRoot), 'artifacts'),
        CONTEXT: projectRoot,
      },
      runMetadata: { jira: { issueKey: key, specId, title: specTitle } },
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

    // A1 (REQ-JIRA-007): the run started, so push the "start" status —
    // assign the issue + transition it toward "in progress". This runs only on
    // the non-failed path (the run reached the gate); a JIRA hiccup here NEVER
    // blocks the workflow — pushJiraStartStatus never throws and its note is
    // surfaced in the returned text (reinforcement 4).
    const startNote = await pushJiraStartStatus(
      key,
      deps.makeJiraClient ?? defaultMakeJiraClient,
    );

    // A1: the run reached the plan/approve gate and paused. Surface the
    // approval message + runId; the caller approves (or rejects) to continue.
    const gate = approvalMessageOf(run);
    return textResult(
      `Started spec-implement for ${key} (${specId}). Run ${run.id} is paused ` +
        `at the plan/approve gate — review the plan and approve to proceed.` +
        (startNote ? `\n\n${startNote}` : '') +
        (gate ? `\n\n${gate}` : '') +
        `\n\nApprove with: specship workflow approve ${run.id}` +
        `\nOr reject with feedback: specship workflow reject ${run.id} --comment "…"` +
        `\n\nOnce approved and the implementation completes and verifies, a pull ` +
        `request for ${key} is raised automatically (its key is carried on the ` +
        `branch, PR title, and body so JIRA links it back).`,
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

/**
 * The subset of `JiraClient` the tracking view (REQ-JIRA-008) reads through. A
 * seam so tests inject a fake and the suite NEVER hits a real host (and no token
 * is handled in tests). Both methods are the same live reads the list/detail
 * tools use.
 */
export interface JiraTrackClient {
  listMyIssues(opts?: { project?: string }): Promise<JiraIssueListResult>;
  getIssue(key: string): Promise<JiraIssueResult>;
}

/**
 * Dependencies for `handleSpecshipJiraTrack`. `specQueries` (the MCP session's
 * open SpecShip handle) enumerates the workflow runs that record which issues
 * entered the pipeline; `makeJiraClient` is the injectable live-read seam
 * (default resolves creds + a real `JiraClient`). `limit` bounds how many recent
 * runs are scanned.
 */
export interface JiraTrackDeps {
  /** SpecQueries handle from the MCP session's open SpecShip. */
  specQueries: unknown;
  /** Live-read client factory (default: resolve creds + new JiraClient). */
  makeJiraClient?: () => JiraTrackClient;
  /** How many recent runs to scan for JIRA-picked issues (default 200). */
  limit?: number;
  /**
   * Project root whose specs/ dir is scanned for published (jira_issue-keyed)
   * specs — enables the REQ-JIRAPUB-008 divergence check. Optional; omitted
   * (older callers / tests) skips the published-spec section entirely.
   */
  projectRoot?: string;
}

/** The SpecShip lifecycle work-state derived from a run (REQ-JIRA-008). */
export type JiraWorkState =
  | 'spec authored'
  | 'implementing'
  | 'PR raised'
  | 'verified';

/**
 * Map a workflow run to its SpecShip lifecycle work-state (REQ-JIRA-008). Pure
 * — reads only the run's status + metadata, most-advanced stage first:
 *   - verify ran and passed → `verified` (the terminal success),
 *   - a raised-PR marker on the run → `PR raised`,
 *   - running/paused → `implementing`,
 *   - anything else (pending/failed/cancelled/completed-without-markers) → the
 *     spec exists but no implementation has landed → `spec authored`.
 */
export function deriveWorkState(run: {
  status?: string;
  metadata?: unknown;
}): JiraWorkState {
  if (verifyPassed(run)) return 'verified';
  const jira = jiraMetaOf(run) as (JiraRunMeta & { prUrl?: unknown }) | undefined;
  if (jira && typeof jira.prUrl === 'string' && jira.prUrl.trim()) {
    return 'PR raised';
  }
  const status = run.status;
  if (status === 'running' || status === 'paused') return 'implementing';
  return 'spec authored';
}

/** Factory seam that builds a live track client from the resolved credentials. */
function defaultMakeTrackClient(): JiraTrackClient {
  const creds = resolveJiraCredentials();
  return new JiraClient(creds);
}

/** One row of the tracking view: an issue's SpecShip + live-JIRA state. */
interface JiraTrackRow {
  issueKey: string;
  title: string;
  workState: JiraWorkState;
  /** The live JIRA status, or a degraded marker when the read failed. */
  jiraStatus: string;
}

const JIRA_UNREACHABLE = '— (JIRA unreachable)';

/**
 * Render the tracking rows as a table (REQ-JIRA-008.A3) — key, title, SpecShip
 * work-state, live JIRA status — with no conversational preamble. An empty view
 * is a single actionable line. The caller relays this verbatim.
 */
function formatTrack(rows: JiraTrackRow[]): string {
  if (rows.length === 0) {
    return 'No picked issues yet — run specship_jira_pick first.';
  }
  return [
    '| Key | Title | SpecShip | JIRA |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (r) => `| ${cell(r.issueKey)} | ${cell(r.title)} | ${cell(r.workState)} | ${cell(r.jiraStatus)} |`,
    ),
  ].join('\n');
}

/**
 * Handle `specship_jira_track` (REQ-JIRA-008). A read-only view joining each
 * picked issue's SpecShip work-state (from its workflow run) with its LIVE JIRA
 * status (a fresh read at track time — never the pick-time cached metadata, so
 * an issue moved outside SpecShip shows its current status). It never re-picks
 * or re-starts anything.
 *
 * Runs are enumerated newest-first and deduped by issue key keeping the
 * most-recent run. A JIRA read failure degrades PER ROW to a clear "unreachable"
 * marker and never fails the whole view (degrade-gracefully, matching the
 * sibling status tools).
 *
 * SECURITY: no token appears in any output or error (REQ-JIRA-009) — only public
 * issue keys, titles, and statuses.
 */
export async function handleSpecshipJiraTrack(
  args: Record<string, unknown>,
  deps: JiraTrackDeps,
): Promise<ToolResult> {
  // Not configured → a clear pointer, never an error stack or a fabricated view.
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const project =
    typeof args.project === 'string' && args.project.trim()
      ? args.project.trim()
      : undefined;

  // Enumerate the runs that record which issues entered the SpecShip pipeline,
  // keeping only JIRA-started runs and deduping by key (newest-first, so the
  // first occurrence is the most-recent run — reinforcement 3).
  const limit = typeof deps.limit === 'number' && deps.limit > 0 ? deps.limit : 200;
  const getAll = (deps.specQueries as {
    getAllWorkflowRuns?: (n: number) => Array<{ status?: string; metadata?: unknown }>;
  }).getAllWorkflowRuns;
  const runs = typeof getAll === 'function' ? getAll.call(deps.specQueries, limit) ?? [] : [];

  const picked: Array<{ issueKey: string; title: string; workState: JiraWorkState }> = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const jira = jiraMetaOf(run);
    const issueKey = jira?.issueKey;
    if (!issueKey || seen.has(issueKey)) continue;
    seen.add(issueKey);
    picked.push({
      issueKey,
      title: jira?.title?.trim() || issueKey,
      workState: deriveWorkState(run),
    });
  }

  // Published specs are tracked too (REQ-JIRAPUB-008) — they may predate any
  // workflow run, so the empty-view short-circuit must consider both sources.
  const published = deps.projectRoot ? enumeratePublishedSpecs(deps.projectRoot) : [];
  if (picked.length === 0 && published.length === 0) {
    return textResult(formatTrack([]));
  }

  // Fresh JIRA read (reinforcement 1: the JIRA column is ALWAYS from this live
  // read, never the pick-time cached metadata). A whole-read failure degrades
  // every row; a per-key fallback failure degrades only that row.
  const make = deps.makeJiraClient ?? defaultMakeTrackClient;
  let client: JiraTrackClient | undefined;
  let listStatuses: Map<string, string> | undefined;
  try {
    client = make();
    const listed = await client.listMyIssues({ project });
    listStatuses = new Map(listed.issues.map((i: JiraIssue) => [i.key, i.status]));
  } catch {
    // The assigned-issues read failed entirely — every row degrades (per-row).
    listStatuses = undefined;
  }

  const rows: JiraTrackRow[] = [];
  for (const p of picked) {
    let jiraStatus = JIRA_UNREACHABLE;
    if (listStatuses) {
      const live = listStatuses.get(p.issueKey);
      if (live !== undefined) {
        jiraStatus = live;
      } else if (client) {
        // No longer in the assigned list — a single live read still tracks it.
        try {
          const single = await client.getIssue(p.issueKey);
          jiraStatus = single.issue.status;
        } catch {
          jiraStatus = JIRA_UNREACHABLE;
        }
      }
    }
    rows.push({ ...p, jiraStatus });
  }

  // Published specs (REQ-JIRAPUB-008): specs that carry a jira_issue key are
  // tracked too (they may predate any workflow run), and each one with a
  // recorded publish fingerprint is compared against the LIVE issue content —
  // an issue edited in JIRA after publish surfaces as a divergence instead of
  // silently drifting from the spec.
  const divergences: string[] = [];
  {
    for (const pub of published) {
      let live: JiraIssue | undefined;
      if (client) {
        try {
          live = (await client.getIssue(pub.issueKey)).issue;
        } catch {
          live = undefined;
        }
      }
      if (!seen.has(pub.issueKey)) {
        seen.add(pub.issueKey);
        rows.push({
          issueKey: pub.issueKey,
          title: pub.title,
          workState: 'spec authored',
          jiraStatus: live?.status ?? JIRA_UNREACHABLE,
        });
      }
      if (pub.fingerprint && live) {
        const liveFp = issueContentFingerprint(live.summary, live.description ?? '');
        if (liveFp !== pub.fingerprint) {
          divergences.push(
            `⚠ ${pub.issueKey} was edited in JIRA after publish (spec: ${pub.specRelPath}) — ` +
              're-publish with specship_jira_publish to refresh, or fold the JIRA edit back into the spec.',
          );
        }
      }
    }
  }

  const table = formatTrack(rows);
  return textResult(
    divergences.length > 0 ? `${table}\n\n${divergences.join('\n')}` : table,
  );
}

/** A spec under specs/ that carries a published JIRA identity. */
interface PublishedSpecRef {
  issueKey: string;
  title: string;
  specRelPath: string;
  fingerprint: string | null;
}

/**
 * Enumerate the specs under `<projectRoot>/specs/` whose frontmatter carries a
 * `jira_issue:` key (REQ-JIRAPUB-008). Best-effort filesystem scan — unreadable
 * files are skipped, and an absent specs/ dir yields an empty list.
 */
function enumeratePublishedSpecs(projectRoot: string): PublishedSpecRef[] {
  const specsDir = path.join(projectRoot, 'specs');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return [];
  }
  const out: PublishedSpecRef[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const full = path.join(specsDir, name);
    try {
      if (!fs.statSync(full).isFile()) continue;
      const content = fs.readFileSync(full, 'utf8');
      const issueKey = readFrontmatterValue(content, 'jira_issue');
      if (!issueKey) continue;
      out.push({
        issueKey,
        title: readSpecTitle(full, issueKey),
        specRelPath: path.join('specs', name),
        fingerprint: readFrontmatterValue(content, 'jira_fingerprint'),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Dependencies for `handleSpecshipJiraPublish` (REQ-JIRAPUB-001/-002). The DB
 * handle supplies the spec + acceptance children + link state; `projectRoot`
 * resolves the spec file for the frontmatter write-back; `makeJiraClient` is
 * the injectable seam so tests never contact a real host.
 */
export interface JiraPublishDeps {
  /** SpecQueries handle from the MCP session's open SpecShip. */
  specQueries: unknown;
  /** The SpecShip project root the spec file lives under. */
  projectRoot: string;
  /** Client factory seam (default: resolve creds + new JiraClient). */
  makeJiraClient?: () => PublishJiraClient;
}

/** The structural slice of SpecQueries the publish handler reads. */
interface PublishSpecQueries {
  getSpecById?: (id: string) => {
    id: string;
    kind: string;
    title: string;
    body: string;
    sourcePath: string;
  } | null;
  getSpecsByParent?: (id: string) => Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
  }>;
  getLinksBySpec?: (id: string) => unknown[];
  getAllSpecs?: () => Array<{ id: string; kind: string; sourcePath: string }>;
}

/**
 * Handle `specship_jira_publish` (REQ-JIRAPUB-001, REQ-JIRAPUB-002): publish a
 * requirement spec as a Story + Sub-tasks, then write the JIRA identity back
 * into the spec file. Re-iding + renaming to the key-derived form happens only
 * for a first publish of a link-less, single-requirement file — the safe case
 * where nothing references the old id yet.
 */
export async function handleSpecshipJiraPublish(
  args: Record<string, unknown>,
  deps: JiraPublishDeps,
): Promise<ToolResult> {
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const specId =
    typeof args.spec_id === 'string' && args.spec_id.trim()
      ? args.spec_id.trim()
      : undefined;
  if (!specId) {
    return textResult(
      'A spec id is required (e.g., "REQ-AUTH-001"). Pass it as the "spec_id" argument.',
    );
  }

  const sq = deps.specQueries as PublishSpecQueries;
  const spec = sq.getSpecById?.(specId);
  if (!spec) {
    return errorResult(`Spec ${specId} not found — run specship sync first?`);
  }
  if (spec.kind !== 'requirement') {
    return errorResult(
      `Spec ${specId} is a ${spec.kind}; publish targets a single requirement (pass a REQ-… id).`,
    );
  }

  const acceptance = (sq.getSpecsByParent?.(specId) ?? [])
    .filter((c) => c.kind === 'acceptance')
    .map((c) => ({ id: c.id, text: (c.title || c.body || '').trim() }))
    .filter((c) => c.text.length > 0);

  const source: SpecPublishSource = {
    specId,
    title: spec.title,
    body: spec.body ?? '',
    specRelPath: spec.sourcePath,
    acceptance,
  };

  try {
    const creds = resolveJiraCredentials();
    const client = deps.makeJiraClient
      ? deps.makeJiraClient()
      : new JiraClient(creds);

    const projectKey =
      (typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : undefined) ?? creds.project;
    if (!projectKey) {
      // No configured/passed project → offer the user's accessible list
      // instead of a dead end (REQ-JIRAPUB-009.A2); no issue is created.
      const projects = await client.listProjects();
      if (projects.length === 0) {
        return textResult(
          'Your JIRA account has no browseable projects, so there is nowhere ' +
            'to publish. Ask your JIRA admin for project access, then retry.',
        );
      }
      return textResult(
        [
          'No publish project is configured. Choose one of the projects your account can access:',
          '',
          '| Key | Name |',
          '| --- | --- |',
          ...projects.map((p) => `| ${p.key} | ${p.name} |`),
          '',
          `Then re-call specship_jira_publish with spec_id: "${specId}" and project: "<Key>" — ` +
            'or save a default with `specship jira configure --project <Key>`.',
        ].join('\n'),
      );
    }

    const absPath = path.isAbsolute(spec.sourcePath)
      ? spec.sourcePath
      : path.join(deps.projectRoot, spec.sourcePath);
    const existingKey = readSpecJiraKey(absPath);

    const result = await publishSpecToJira(
      client,
      source,
      { projectKey },
      existingKey,
    );

    // Write-back (REQ-JIRAPUB-002). Re-id + rename ONLY on first publish of a
    // link-less file whose only requirement is this one.
    const links = sq.getLinksBySpec?.(specId) ?? [];
    const sameFileReqs = (sq.getAllSpecs?.() ?? []).filter(
      (s) => s.kind === 'requirement' && s.sourcePath === spec.sourcePath,
    );
    const reIdSafe =
      !existingKey && links.length === 0 && sameFileReqs.length === 1;
    const written = writeBackJiraIdentity(absPath, result.key, {
      fingerprint: result.fingerprint,
      reId: reIdSafe ? { from: specId } : null,
      renameTo: reIdSafe ? publishedSpecFilename(result.key, spec.title) : null,
    });

    const verb = result.created ? 'Created' : 'Updated';
    const newId = reIdSafe ? ` The requirement is now ${reqIdForIssue(result.key)}.` : '';
    return textResult(
      `${verb} ${result.key} (${result.subtasksCreated} Sub-task${
        result.subtasksCreated === 1 ? '' : 's'
      } created) and recorded jira_issue in ${written.path}.${newId} ` +
        'Run "specship sync" (or let the watcher pick it up) so the index reflects the file change. ' +
        `Commits for this spec should be prefixed "${result.key}: ".`,
    );
  } catch (err) {
    if (err instanceof JiraError) {
      return errorResult(err.message);
    }
    return errorResult('Failed to publish the spec to JIRA.');
  }
}
