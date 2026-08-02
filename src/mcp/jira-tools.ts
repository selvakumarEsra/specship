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
import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult } from './tools';
import { detectTaskship, defaultTaskshipProbes, type TaskshipAvailability } from '../taskship/detect';
import { loadJiraConfig, resolveJiraCredentials } from '../jira/config';
import { loadRepoJiraBinding } from '../jira/repo-config';
import { JiraClient, MAX_ISSUE_RESULTS } from '../jira/client';
import { resolveWorkAnchor, formatRefusal } from '../jira/board-first';
import {
  JiraError,
  type JiraIssue,
  type JiraIssueListResult,
  type JiraIssueResult,
  type JiraConnectionResult,
  type JiraTransitionNames,
  type JiraTransitionResult,
} from '../jira/types';
import { writeSpecFromIssue, findSpecForIssueKey, readSpecJiraKey, writeRegressionCaseKeys } from '../jira/spec-writer';
import {
  buildRegressionPack,
  upsertRegressionPack,
  type BuilderSpecQueries,
  type RegressionPackJiraClient,
  type UpsertContext,
} from '../jira/regression-pack';
import { reqIdForIssue } from '../jira/spec-generator';
import {
  publishSpecToJira,
  writeBackJiraIdentity,
  publishedSpecFilename,
  issueContentFingerprint,
  type PublishJiraClient,
  type SpecPublishSource,
} from '../jira/publish';
import { enumeratePublishedSpecs } from '../jira/published-specs';
import {
  postMilestoneComment,
  type MilestoneJiraClient,
} from '../jira/milestone-comment';
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
  specId?: string,
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
  // Milestone: pr_raised (REQ-JIRATEAM-003.A1/A2). The dispatcher itself is
  // idempotent (single comment per issue+specId), watermarked, and
  // soft-fails to a local note — so a JIRA hiccup here never undoes the
  // raised PR. Fall back to a plain addComment only for fake clients that
  // don't implement the milestone shape.
  const maybe = ctx.client as unknown as Partial<MilestoneJiraClient>;
  const canMilestone =
    typeof maybe.listCommentsDetailed === 'function' &&
    typeof maybe.updateComment === 'function' &&
    typeof maybe.addComment === 'function';
  try {
    if (canMilestone) {
      const r = await postMilestoneComment(
        maybe as MilestoneJiraClient,
        key,
        'pr_raised',
        { specId: specId ?? key, prUrl },
      );
      if (r.status === 'soft_failed') {
        notes.push(`couldn't comment the PR link on ${key} (${r.reason ?? 'unknown'})`);
      } else {
        notes.push(`commented the PR link on ${key}`);
      }
    } else {
      await ctx.client.addComment(key, `SpecShip raised a pull request: ${prUrl}`);
      notes.push(`commented the PR link on ${key}`);
    }
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
      'token — you never type your own name). Optionally narrow to a project, ' +
      'or to your active sprint ("my tasks for today") with sprint:"active".',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Optional project key to narrow the list (e.g., "PROJ"). Omit to list all your assigned issues.',
        },
        sprint: {
          type: 'string',
          enum: ['active'],
          description:
            'Set to "active" to return only issues on an open sprint — your board for the day. Omit for all your assigned issues.',
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
    name: 'specship_jira_coverage',
    description:
      'Show a sprint coverage report joining the bound JIRA project\'s active ' +
      '(or named) sprint to spec truth — every issue in the sprint with its ' +
      'repo-side state (unspecced / specced / implemented / verified / drifted / ' +
      'broken) and rollup totals. Read-only over JIRA by default; pass ' +
      '`post: true` with `issue_key` to upsert the report as a single ' +
      'watermarked comment on that issue (edited in place on re-post).',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'JIRA project key to scope the sprint read (e.g., "PROJ"). Optional when a default project is configured.',
        },
        sprint: {
          type: 'string',
          description:
            'Optional named sprint. Omit to use the project\'s currently open sprint(s).',
        },
        post: {
          type: 'boolean',
          description:
            'Post the report as a single watermarked JIRA comment (edit-in-place). Defaults to false — never posts unless explicitly requested.',
        },
        issue_key: {
          type: 'string',
          description:
            'When `post` is true, the anchor issue (e.g., an epic key) the coverage comment lands on. Required with `post`.',
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
    name: 'specship_jira_reconcile',
    description:
      "Detect JIRA-side edits to published specs and (only with explicit user " +
      'confirmation) fold them back into the spec (REQ-JIRATEAM-005). Two modes: ' +
      '`mode: "preview"` (default) — read-only; enumerates every published spec ' +
      "whose LIVE JIRA issue diverges from what publish wrote (edited summary/" +
      'description, or a Sub-task added in JIRA with no matching acceptance ' +
      'criterion) and returns a proposed spec amendment. `mode: "apply"` — ' +
      'writes the previewed amendment to the spec file and re-publishes so the ' +
      'fingerprint refreshes. **Preview first, then apply only after the user ' +
      'has explicitly confirmed the exact diff in conversation.** Apply refuses ' +
      "unless `expected_live_fingerprint` matches the issue's current live " +
      'fingerprint — a value the caller MUST have just seen returned by a ' +
      'preview call. No preview → no apply.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['preview', 'apply'],
          description:
            'preview (default) returns divergences without touching any file; apply writes ' +
            'the amendment after preview + explicit user confirmation.',
        },
        issue_key: {
          type: 'string',
          description:
            'Optional: narrow preview to a single issue key (e.g., "PROJ-123"). Required for apply.',
        },
        accept_content: {
          type: 'boolean',
          description:
            'apply only: fold the edited summary/description back into the spec.',
        },
        accept_subtasks: {
          type: 'array',
          items: { type: 'string' },
          description:
            'apply only: JIRA Sub-task keys whose proposed acceptance criteria the user has confirmed.',
        },
        expected_live_fingerprint: {
          type: 'string',
          description:
            "apply only: the issue's live fingerprint from the preview the user just approved. " +
            'apply refuses when this does not match the current live fingerprint (preview-first gate).',
        },
      },
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
  {
    name: 'specship_jira_anchor',
    description:
      'Resolve the board-first work anchor for the current repo (REQ-JIRATEAM-007). ' +
      'Returns "unbound" when the repo has no JIRA binding (callers proceed unchanged), ' +
      'the anchored issue when one is explicit/picked, or refuses (with the epic-scoped ' +
      'pickable list) when a bound repo has no anchor yet. Read-only: never writes.',
    inputSchema: {
      type: 'object',
      properties: {
        issue_key: {
          type: 'string',
          description:
            'Optional: an explicit issue key to anchor on (e.g., "PROJ-123"). Skips the pick step.',
        },
        picked_issue_key: {
          type: 'string',
          description:
            'Optional: the key just picked from a specship_jira_issues list — routed as the anchor.',
        },
      },
    },
  },
  {
    name: 'specship_jira_epics',
    description:
      'List the open epics for a JIRA project — powers the /specship:jira menu ' +
      "epic-picker (REQ-JIRATEAM-008). With no `project`, uses the repo's bound " +
      'project (specship.config.json → jira.projectKey); errors clearly if neither ' +
      'is set. Read-only: never writes; ordered most-recently-updated first.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            "Optional project key (e.g., \"PROJ\"). Omit to use the repo's bound project.",
        },
      },
    },
  },
  {
    name: 'specship_jira_add_task',
    description:
      'Add a task you identified mid-implementation under its epic/story. If ' +
      'the taskship PM tool is installed, this routes through it (so its ' +
      'plan.yaml stays the source of truth and it cascades to JIRA); otherwise ' +
      'it creates the JIRA issue directly — a Sub-task under a Story, a Task ' +
      'under an Epic — watermarked so taskship can adopt it later.',
    inputSchema: {
      type: 'object',
      properties: {
        parent: {
          type: 'string',
          description:
            "The parent's id: a JIRA key (e.g., \"PROJ-45\") when creating in JIRA, " +
            "or taskship's story/epic id when taskship is installed. Required.",
        },
        title: {
          type: 'string',
          description: 'Short title of the new task. Required.',
        },
        parent_kind: {
          type: 'string',
          enum: ['story', 'epic'],
          description:
            'Whether the parent is a story or an epic (decides the JIRA issue type: ' +
            'Sub-task under a story, Task under an epic). Defaults to "story".',
        },
        type: {
          type: 'string',
          description:
            'taskship subtype tag for the task (e.g., "code", "test", "defect"). ' +
            'Defaults to "task". Recorded as a taskship:type:* label on the JIRA fallback.',
        },
        description: {
          type: 'string',
          description: 'Optional longer description for the task.',
        },
      },
      required: ['parent', 'title'],
    },
  },
  {
    name: 'specship_jira_regression_pack',
    description:
      'Generate or refresh the SpecShip Regression Pack in the bound JIRA ' +
      'project (REQ-JIRAREG-001): one watermarked epic → one domain-area ' +
      'Story → one Sub-task per acceptance criterion of every implemented ' +
      '(or verified) requirement. Idempotent — a re-run with nothing changed ' +
      'performs zero JIRA writes; a criterion added, removed, or edited yields ' +
      'exactly the matching create / update. Pass dry_run: true to preview the ' +
      'plan without touching JIRA.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Optional JIRA project key (e.g., "PROJ"). Defaults to the ' +
            'configured publish project when omitted.',
        },
        dry_run: {
          type: 'boolean',
          description:
            'When true, build the plan and report counts without creating or ' +
            'updating any JIRA issue. Default: false.',
        },
      },
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
function formatIssues(issues: JiraIssue[], opts?: { project?: string; epicKey?: string }): string {
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
  if (opts?.epicKey) notes.push(`Scoped to epic ${cell(opts.epicKey)}.`);
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

  const explicitProject =
    typeof args.project === 'string' && args.project.trim()
      ? args.project.trim()
      : undefined;
  // Sprint filter (TASKSHIP-BRIDGE-DOC, REQ-TASKSHIP-001): only "active" is a
  // recognized value; anything else is ignored (falls back to all issues).
  const sprint = args.sprint === 'active' ? 'active' as const : undefined;

  // Board-first (REQ-JIRATEAM-007.A1): with a repo binding and no explicit
  // overrides, scope to the bound project's epic so the same tool that
  // powers the pick flow surfaces the anchor-eligible open work.
  let epicKey: string | undefined;
  let project = explicitProject;
  if (!explicitProject) {
    try {
      const { binding } = loadRepoJiraBinding(process.cwd());
      if (binding) {
        project = binding.projectKey;
        if (binding.epicKey) epicKey = binding.epicKey;
      }
    } catch {
      // A malformed repo config already surfaces via other paths; here we
      // just skip the scoping rather than blocking a listing call.
    }
  }

  try {
    const creds = resolveJiraCredentials();
    const client = new JiraClient(creds);
    const result = await client.listMyIssues({ project, sprint, epicKey });
    return textResult(formatIssues(result.issues, { project, epicKey }));
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
 * Handle `specship_jira_anchor` (REQ-JIRATEAM-007). Thin wrapper over
 * `resolveWorkAnchor` so slash-commands and external agents can query the
 * board-first gate without duplicating logic. Always returns a plain-text
 * result — anchored → an `Anchor:` line naming the key; refused → the
 * canonical human refusal (with the pickable list when available); unbound
 * → a one-liner so callers no-op cleanly.
 */
export async function handleSpecshipJiraAnchor(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const explicitIssueKey =
    typeof args.issue_key === 'string' && args.issue_key.trim()
      ? args.issue_key.trim()
      : undefined;
  const pickedIssueKey =
    typeof args.picked_issue_key === 'string' && args.picked_issue_key.trim()
      ? args.picked_issue_key.trim()
      : undefined;

  try {
    // A resolve that needs to call JIRA (explicit/picked key, or the pickable
    // list on refusal) will hit `resolveJiraCredentials` inside the default
    // makeClient — gate up-front so an unconfigured caller still gets the
    // canonical pointer, not a stack.
    if (explicitIssueKey || pickedIssueKey) {
      const notConfigured = notConfiguredResult();
      if (notConfigured) return notConfigured;
    }
    const res = await resolveWorkAnchor({
      cwd: process.cwd(),
      explicitIssueKey,
      pickedIssueKey,
    });
    if (res.status === 'unbound') {
      return textResult(
        'Anchor: unbound — repo has no JIRA binding; work-creating flows proceed unchanged.',
      );
    }
    if (res.status === 'anchored') {
      return textResult(
        `Anchor: ${res.anchor.issueKey} — ${res.anchor.summary} (source: ${res.anchor.source})`,
      );
    }
    return errorResult(formatRefusal(res));
  } catch (err) {
    if (err instanceof JiraError) return errorResult(err.message);
    return errorResult('Failed to resolve JIRA anchor.');
  }
}

/**
 * Handle `specship_jira_epics` (REQ-JIRATEAM-008). Lists open epics for a
 * project — the picker source for the `/specship:jira` menu's "choose epic"
 * step. With no `project`, falls back to the repo binding's `projectKey` so
 * on a bound repo the caller doesn't have to duplicate the lookup.
 */
export async function handleSpecshipJiraEpics(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  let project =
    typeof args.project === 'string' && args.project.trim()
      ? args.project.trim()
      : undefined;
  if (!project) {
    try {
      const { binding } = loadRepoJiraBinding(process.cwd());
      if (binding) project = binding.projectKey;
    } catch (err) {
      if (err instanceof JiraError) return errorResult(err.message);
    }
  }
  if (!project) {
    return errorResult(
      'No JIRA project. Pass `project`, or bind one with ' +
        '`specship jira bind --project <KEY>` (writes specship.config.json).',
    );
  }

  try {
    const creds = resolveJiraCredentials();
    const client = new JiraClient(creds);
    const epics = await client.listEpics(project);
    return textResult(formatEpics(epics, project));
  } catch (err) {
    if (err instanceof JiraError) return errorResult(err.message);
    return errorResult('Failed to list JIRA epics.');
  }
}

function formatEpics(
  epics: { key: string; summary: string; status: string }[],
  project: string,
): string {
  if (epics.length === 0) {
    return (
      `No open epics in project ${cell(project)}.\n\n` +
      '> Note: only epics whose status category is not "Done" are listed.'
    );
  }
  const table = [
    '| Key | Summary | Status |',
    '| --- | --- | --- |',
    ...epics.map(
      (e) => `| ${cell(e.key)} | ${cell(e.summary)} | ${cell(e.status)} |`,
    ),
  ].join('\n');
  const notes = [`Project ${cell(project)}, ordered most-recently-updated first.`];
  if (epics.length >= MAX_ISSUE_RESULTS) {
    notes.push(`Showing the ${MAX_ISSUE_RESULTS} most recently updated.`);
  }
  return `${table}\n\n> Note: ${notes.join(' ')}`;
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
    const note = await pushJiraReviewStatus(issueKey, outcome.url, make, jira.specId);
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
        // Delegate the divergence judgement to the reconcile module so the
        // track view + the reconcile tool never disagree about "what counts as
        // an edit". Sub-task diffs need the spec's acceptance criteria, which
        // this row doesn't have — track only reports the content flag; a full
        // preview lives in `specship_jira_reconcile`.
        const { diffIssueVsSpec } = await import('../jira/reconcile');
        const specView = {
          specRelPath: pub.specRelPath,
          requirementId: pub.issueKey,
          title: pub.title,
          body: '',
          acceptance: [] as Array<{ id: string; text: string }>,
        };
        const report = diffIssueVsSpec(live, specView, pub.fingerprint);
        if (report.content) {
          divergences.push(
            `⚠ ${pub.issueKey} was edited in JIRA after publish (spec: ${pub.specRelPath}) — ` +
              'run specship_jira_reconcile to preview the JIRA-side changes, or ' +
              're-publish with specship_jira_publish to refresh the fingerprint.',
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

// `enumeratePublishedSpecs` / `PublishedSpecRef` moved to
// `../jira/published-specs` so REQ-JIRATEAM-004's coverage report can share
// the same source. Imported at the top of this file.

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

// ---------------------------------------------------------------------------
// Add-task under an epic/story (TASKSHIP-BRIDGE-DOC, REQ-TASKSHIP-003)
// ---------------------------------------------------------------------------

/** Outcome of routing a discovered task through taskship. */
export type TaskshipAddResult = { ok: true; detail: string } | { ok: false; error: string };

/** Injected deps so the routing/label logic is testable without live services. */
export interface JiraAddTaskDeps {
  projectRoot: string;
  /** taskship availability — defaults to the real probes bound to projectRoot. */
  detect?: () => TaskshipAvailability;
  /** Route a task through taskship — defaults to spawning `taskship raise`. */
  runTaskshipAdd?: (input: {
    parent: string;
    parentKind: 'story' | 'epic';
    title: string;
    type: string;
  }) => Promise<TaskshipAddResult>;
  /** JIRA client factory — defaults to the configured credentials. */
  makeJiraClient?: () => JiraClient;
  /** External-id generator for the fallback watermark — defaults to a uuid. */
  genExternalId?: () => string;
}

/** taskship watermark + type labels the fallback stamps (REQ-TASKSHIP-003.A4). */
function taskshipLabels(externalId: string, type: string): string[] {
  const tag = type.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'task';
  return [`taskship:${externalId}`, `taskship:type:${tag}`, 'taskship:source:specship'];
}

/** Default taskship route: `taskship raise --{story|epic} <parent> --title <title>`. */
function defaultRunTaskshipAdd(projectRoot: string) {
  return (input: { parent: string; parentKind: 'story' | 'epic'; title: string; type: string }): Promise<TaskshipAddResult> =>
    new Promise((resolve) => {
      const args = ['raise', `--${input.parentKind}`, input.parent, '--title', input.title];
      let stderr = '';
      try {
        const child = spawn('taskship', args, { cwd: projectRoot, stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr?.on('data', (d) => { stderr += String(d); });
        child.on('error', (err) => resolve({ ok: false, error: err.message }));
        child.on('exit', (code) =>
          code === 0
            ? resolve({ ok: true, detail: `taskship raise --${input.parentKind} ${input.parent}` })
            : resolve({ ok: false, error: stderr.trim() || `taskship raise exited with code ${code ?? 'null'}` }),
        );
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
}

/**
 * Handle `specship_jira_add_task` (REQ-TASKSHIP-003). Create a task a developer
 * identified mid-implementation under its epic/story, routed by taskship
 * availability:
 *  - taskship present → route through it (canonical); on its failure, surface
 *    the error and DO NOT also write JIRA (no orphan issue).
 *  - taskship absent → create the JIRA issue directly: Sub-task under a Story,
 *    Task under an Epic, watermarked so taskship can adopt it later.
 */
export async function handleSpecshipJiraAddTask(
  args: Record<string, unknown>,
  deps: JiraAddTaskDeps,
): Promise<ToolResult> {
  const parent = typeof args.parent === 'string' && args.parent.trim() ? args.parent.trim() : undefined;
  if (!parent) {
    return textResult('A parent id is required (a JIRA key like "PROJ-45", or a taskship story/epic id). Pass it as "parent".');
  }
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
  if (!title) {
    return textResult('A task title is required. Pass it as "title".');
  }
  const parentKind: 'story' | 'epic' = args.parent_kind === 'epic' ? 'epic' : 'story';
  const type = typeof args.type === 'string' && args.type.trim() ? args.type.trim() : 'task';
  const description = typeof args.description === 'string' && args.description.trim() ? args.description.trim() : undefined;

  const detect = deps.detect ?? (() => detectTaskship(defaultTaskshipProbes(deps.projectRoot)));
  const availability = detect();

  // --- taskship route (canonical when present) ---------------------------
  if (availability.available) {
    const run = deps.runTaskshipAdd ?? defaultRunTaskshipAdd(deps.projectRoot);
    let res: TaskshipAddResult;
    try {
      res = await run({ parent, parentKind, title, type });
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (res.ok) {
      return textResult(
        `Added "${title}" under ${parentKind} ${parent} via taskship (${res.detail}). ` +
          'taskship owns the plan and will cascade it to JIRA — no JIRA issue was created directly.',
      );
    }
    // Canonical-owner rule: surface the failure, never silently write JIRA
    // (that would orphan an issue taskship can't reconcile).
    return errorResult(
      `taskship is installed but adding the task through it failed: ${res.error}. ` +
        'No JIRA issue was created. Fix taskship (or add the task in taskship directly) and retry.',
    );
  }

  // --- JIRA fallback (taskship absent) -----------------------------------
  try {
    const client = deps.makeJiraClient ? deps.makeJiraClient() : new JiraClient(resolveJiraCredentials());
    const issueType = parentKind === 'epic' ? 'Task' : 'Sub-task';
    // Derive the project key from the parent JIRA key prefix (PROJ-45 → PROJ),
    // falling back to the configured default project.
    const projectFromParent = /^([A-Za-z][A-Za-z0-9_]+)-\d+$/.exec(parent)?.[1];
    const projectKey = projectFromParent ?? resolveJiraCredentials().project ?? '';
    const externalId = (deps.genExternalId ?? randomUUID)();
    const created = await client.createIssue({
      projectKey,
      issueType,
      summary: title,
      description,
      parentKey: parent,
      labels: taskshipLabels(externalId, type),
    });
    return textResult(
      `Created ${created.key} (${issueType}) under ${parentKind} ${parent}, ` +
        `watermarked \`taskship:${externalId}\` so \`taskship onboard ${created.key}\` can adopt it later. ` +
        '(taskship is not installed, so this was created directly in JIRA.)',
    );
  } catch (err) {
    if (err instanceof JiraError) {
      return errorResult(err.message);
    }
    return errorResult('Failed to create the task in JIRA.');
  }
}

// ---------------------------------------------------------------------------
// Regression pack (REQ-JIRAREG-001)
// ---------------------------------------------------------------------------

/** Dependencies for `handleSpecshipJiraRegressionPack` — threaded like publish. */
export interface JiraRegressionPackDeps {
  specQueries: unknown;
  projectRoot: string;
  /** Client factory seam (default: resolve creds + new JiraClient). */
  makeJiraClient?: () => RegressionPackJiraClient;
}

/**
 * Handle `specship_jira_regression_pack` (REQ-JIRAREG-001). Builds the model
 * from the loaded spec set, then upserts it against JIRA idempotently. A
 * dry-run planning path returns the counts without any JIRA write.
 */
export async function handleSpecshipJiraRegressionPack(
  args: Record<string, unknown>,
  deps: JiraRegressionPackDeps,
): Promise<ToolResult> {
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const dryRun = args.dry_run === true;
  const sq = deps.specQueries as BuilderSpecQueries;
  const model = buildRegressionPack(sq);
  if (model.cases.length === 0) {
    return textResult(
      'No implemented (or verified) requirements found — the regression pack ' +
        'has zero cases. Implement a spec and link its code before generating.',
    );
  }

  try {
    const creds = resolveJiraCredentials();
    const projectKey =
      (typeof args.project === 'string' && args.project.trim()
        ? args.project.trim()
        : undefined) ?? creds.project;
    if (!projectKey) {
      return textResult(
        'No JIRA project is configured. Pass `project: "PROJ"` or save a ' +
          'default with `specship jira configure --project <Key>`.',
      );
    }

    const client: RegressionPackJiraClient = deps.makeJiraClient
      ? deps.makeJiraClient()
      : (new JiraClient(creds) as unknown as RegressionPackJiraClient);
    const ctx: UpsertContext = { projectKey, dryRun };
    const result = await upsertRegressionPack(client, model, ctx);

    // Back-link written cases into their spec files (REQ-JIRAREG-001.A3) —
    // spec-side traceability. Best-effort per case; a failure notes and
    // moves on so a partial back-link never blocks the pack write itself.
    const backlinkNotes: string[] = [];
    if (!dryRun) {
      const specPathById: Record<string, string> = {};
      for (const c of model.cases) specPathById[c.criterionId] = c.specPath;
      for (const [criterionId, issueKey] of Object.entries(result.caseKeysByCriterion)) {
        const rel = specPathById[criterionId];
        if (!rel) continue;
        const absPath = path.isAbsolute(rel) ? rel : path.join(deps.projectRoot, rel);
        const out = writeRegressionCaseKeys(absPath, criterionId, issueKey);
        if (!out.ok && out.detail) backlinkNotes.push(`  · ${criterionId}: ${out.detail}`);
      }
    }

    const lines: string[] = [];
    lines.push(
      `${dryRun ? 'Dry-run plan for' : 'Regression Pack upserted in'} ${projectKey}:`,
    );
    lines.push(
      `- Epic: ${result.epicKey ?? '(none)'}${result.epicCreated ? ' (created)' : ''}`,
    );
    lines.push(
      `- Stories: ${result.storiesCreated} created, ${result.storiesUpdated} updated, ${result.storiesSkipped} skipped`,
    );
    lines.push(
      `- Cases: ${result.casesCreated} created, ${result.casesUpdated} updated, ${result.casesSkipped} skipped (of ${model.cases.length})`,
    );
    if (result.orphanedEpicKeys.length > 0) {
      lines.push(
        `- Extra pack-epics found (single-epic invariant): ${result.orphanedEpicKeys.join(', ')} — merge or delete them manually.`,
      );
    }
    if (backlinkNotes.length > 0) {
      lines.push('- Back-link notes:');
      lines.push(...backlinkNotes);
    }
    return textResult(lines.join('\n'));
  } catch (err) {
    if (err instanceof JiraError) return errorResult(err.message);
    return errorResult(
      `Regression pack failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sprint coverage (REQ-JIRATEAM-004)
// ---------------------------------------------------------------------------

/**
 * Dependencies for `handleSpecshipJiraCoverage`. Threaded from the tool
 * dispatcher — the DB handle enumerates specs + link states, `projectRoot`
 * anchors the published-specs scan, and `makeJiraClient` is the injectable
 * live-read seam (default resolves creds + a real `JiraClient`).
 */
export interface JiraCoverageDeps {
  specQueries: unknown;
  projectRoot: string;
  makeJiraClient?: () => import('../jira/coverage').CoverageJiraClient & {
    listCommentsDetailed?: (key: string) => Promise<Array<{ id: string; body: string }>>;
    addComment?: (key: string, body: string) => Promise<{ id: string } | void>;
    updateComment?: (key: string, id: string, body: string) => Promise<void>;
  };
}

/**
 * Handle `specship_jira_coverage` (REQ-JIRATEAM-004). Builds the sprint
 * coverage report, renders markdown, and optionally upserts a single
 * watermarked JIRA comment (A3) — never transitions or edits any issue (A4).
 *
 * SECURITY: no credential is echoed (REQ-JIRA-009); only public issue keys,
 * titles, and statuses appear in output.
 */
export async function handleSpecshipJiraCoverage(
  args: Record<string, unknown>,
  deps: JiraCoverageDeps,
): Promise<ToolResult> {
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const { buildCoverageReport, formatCoverageMarkdown, COVERAGE_COMMENT_WATERMARK } =
    await import('../jira/coverage');
  const { upsertWatermarkedComment } = await import('../jira/publish');

  const post = args.post === true;
  const issueKeyArg =
    typeof args.issue_key === 'string' && args.issue_key.trim()
      ? args.issue_key.trim()
      : undefined;
  if (post && !issueKeyArg) {
    return textResult(
      'Posting the coverage report needs an anchor issue — pass "issue_key" (e.g., the epic key) alongside "post": true.',
    );
  }

  const sprint =
    typeof args.sprint === 'string' && args.sprint.trim()
      ? args.sprint.trim()
      : undefined;

  let creds: ReturnType<typeof resolveJiraCredentials>;
  try {
    creds = resolveJiraCredentials();
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
  const project =
    (typeof args.project === 'string' && args.project.trim()
      ? args.project.trim()
      : undefined) ?? creds.project;
  if (!project) {
    return textResult(
      'No JIRA project configured. Pass "project", or configure a default with `specship jira configure --project <KEY>`.',
    );
  }

  const client = deps.makeJiraClient
    ? deps.makeJiraClient()
    : new JiraClient(creds);

  try {
    const report = await buildCoverageReport({
      client,
      projectRoot: deps.projectRoot,
      specQueries: deps.specQueries as import('../jira/coverage').CoverageSpecQueries,
      project,
      sprint,
    });
    const markdown = formatCoverageMarkdown(report);

    if (!post) return textResult(markdown);

    // Post path (A3): the only write this handler makes — a single watermarked
    // comment, upserted in place on re-post. Never a transition/edit (A4).
    const commentClient = client as unknown as {
      listCommentsDetailed: (key: string) => Promise<Array<{ id: string; body: string }>>;
      addComment: (key: string, body: string) => Promise<{ id: string } | void>;
      updateComment: (key: string, id: string, body: string) => Promise<void>;
    };
    const result = await upsertWatermarkedComment(
      commentClient,
      issueKeyArg!,
      COVERAGE_COMMENT_WATERMARK,
      markdown,
    );
    const verb = result.action === 'updated' ? 'Updated existing' : 'Posted new';
    return textResult(
      `${markdown}\n\n> ${verb} coverage comment on ${issueKeyArg}.`,
    );
  } catch (err) {
    if (err instanceof JiraError) return errorResult(err.message);
    return errorResult(
      `Failed to build the coverage report: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reconcile (REQ-JIRATEAM-005)
// ---------------------------------------------------------------------------

/** The read-only client slice `specship_jira_reconcile` needs. */
export interface JiraReconcileClient {
  getIssue(key: string): Promise<JiraIssueResult>;
}

/** Dependencies for `handleSpecshipJiraReconcile`. */
export interface JiraReconcileDeps {
  specQueries: unknown;
  projectRoot: string;
  /** Read-side factory (default: resolve creds + new JiraClient). */
  makeJiraClient?: () => JiraReconcileClient;
  /**
   * Write-side factory used only in apply mode to re-publish and refresh the
   * fingerprint. Defaults to the full `JiraClient` — tests stub this out so
   * the suite never contacts a real host.
   */
  makePublishClient?: () => PublishJiraClient;
}

/** The subset of SpecQueries the reconcile handler reads. */
interface ReconcileSpecQueries {
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
}

/**
 * Load the requirement view a diff needs — id, title, body, acceptance — from
 * the SpecQueries handle. `requirementId` is the frontmatter/heading id (which
 * for a published spec is `reqIdForIssue(issueKey)`).
 */
function loadSpecView(
  sq: ReconcileSpecQueries,
  requirementId: string,
  specRelPath: string,
): import('../jira/reconcile').SpecViewForDiff | null {
  const spec = sq.getSpecById?.(requirementId);
  if (!spec || spec.kind !== 'requirement') return null;
  const acceptance = (sq.getSpecsByParent?.(requirementId) ?? [])
    .filter((c) => c.kind === 'acceptance')
    .map((c) => ({ id: c.id, text: (c.title || c.body || '').trim() }))
    .filter((c) => c.text.length > 0);
  return {
    specRelPath,
    requirementId,
    title: spec.title,
    body: spec.body ?? '',
    acceptance,
  };
}

/** Format one report as a human-readable diff block. */
function formatReconcileReport(report: import('../jira/reconcile').ReconcileReport): string {
  const lines: string[] = [];
  lines.push(`### ${report.issueKey} — ${report.specRelPath}`);
  if (report.content) {
    lines.push('');
    lines.push('**Content divergence (edited in JIRA after publish)**');
    lines.push('');
    lines.push(`- Live summary: ${report.content.liveSummary}`);
    lines.push(`- Live fingerprint: \`${report.content.liveFingerprint}\``);
    lines.push(`- Stored fingerprint: \`${report.content.storedFingerprint}\``);
    lines.push('');
    lines.push('_Live description:_');
    lines.push('');
    lines.push(report.content.liveDescription || '_(empty)_');
  }
  if (report.subtasks.length > 0) {
    lines.push('');
    lines.push('**Sub-tasks added in JIRA (proposed new acceptance criteria)**');
    lines.push('');
    lines.push('| Sub-task | Proposed id | Proposed criterion |');
    lines.push('| --- | --- | --- |');
    for (const d of report.subtasks) {
      lines.push(
        `| ${cell(d.subtaskKey)} | ${cell(d.proposedCriterionId)} | ${cell(d.proposedCriterionText)} |`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Handle `specship_jira_reconcile` (REQ-JIRATEAM-005).
 *
 * Two modes:
 *   - preview (default, A3): enumerate every published spec, live-read the
 *     issue, diff, and return the proposed spec amendment. NO writes.
 *   - apply (A4): fold the previewed diff into the spec file and re-publish so
 *     the fingerprint refreshes. Preview-gated: apply refuses unless
 *     `expected_live_fingerprint` matches the issue's current live fingerprint,
 *     which the caller MUST have just received from a preview call. This
 *     encodes the "preview first, then explicit user confirmation" discipline.
 */
export async function handleSpecshipJiraReconcile(
  args: Record<string, unknown>,
  deps: JiraReconcileDeps,
): Promise<ToolResult> {
  const notConfigured = notConfiguredResult();
  if (notConfigured) return notConfigured;

  const { diffIssueVsSpec, reportHasDivergence } = await import('../jira/reconcile');
  const {
    appendAcceptanceCriterion,
    applyContentAmendment,
    amendSpecFile,
  } = await import('../jira/spec-amend');

  const mode = args.mode === 'apply' ? 'apply' : 'preview';
  const issueKeyArg =
    typeof args.issue_key === 'string' && args.issue_key.trim()
      ? args.issue_key.trim()
      : undefined;

  const published = enumeratePublishedSpecs(deps.projectRoot);
  const scope = issueKeyArg
    ? published.filter((p) => p.issueKey === issueKeyArg)
    : published;
  if (scope.length === 0) {
    return textResult(
      issueKeyArg
        ? `No published spec found for ${issueKeyArg} — reconcile only applies to specs with a jira_issue: key.`
        : 'No published specs found — nothing to reconcile.',
    );
  }

  let client: JiraReconcileClient;
  try {
    client = deps.makeJiraClient
      ? deps.makeJiraClient()
      : (new JiraClient(resolveJiraCredentials()) as unknown as JiraReconcileClient);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }

  const sq = deps.specQueries as ReconcileSpecQueries;

  if (mode === 'apply') {
    if (!issueKeyArg) {
      return errorResult(
        'apply mode needs "issue_key". Run preview first, then apply the confirmed diff for one issue.',
      );
    }
    const pub = scope[0]!;
    let live: JiraIssue;
    try {
      live = (await client.getIssue(issueKeyArg)).issue;
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    // Preview-first gate (A3): apply refuses unless the caller-supplied
    // `expected_live_fingerprint` matches the issue's current live
    // fingerprint. That value only exists if the caller just saw it in a
    // preview and the user confirmed it — no preview → no apply.
    const expectedFp =
      typeof args.expected_live_fingerprint === 'string'
        ? args.expected_live_fingerprint.trim()
        : '';
    const liveFp = issueContentFingerprint(live.summary ?? '', live.description ?? '');
    if (!expectedFp || expectedFp !== liveFp) {
      return errorResult(
        'apply refused: no matching preview. Run mode:"preview" for ' +
          `${issueKeyArg}, show the user the diff, and re-call apply with the ` +
          `expected_live_fingerprint from that preview (live fingerprint: ${liveFp}).`,
      );
    }

    const requirementId = reqIdForIssue(issueKeyArg);
    const specView = loadSpecView(sq, requirementId, pub.specRelPath);
    if (!specView) {
      return errorResult(
        `Spec ${requirementId} not found in the index — run specship sync first.`,
      );
    }
    const report = diffIssueVsSpec(live, specView, pub.fingerprint);

    const acceptContent = args.accept_content === true;
    const acceptSubtasks = Array.isArray(args.accept_subtasks)
      ? (args.accept_subtasks as unknown[]).filter(
          (k): k is string => typeof k === 'string',
        )
      : [];
    if (!acceptContent && acceptSubtasks.length === 0) {
      return errorResult(
        'apply refused: nothing to accept. Pass accept_content: true and/or ' +
          'accept_subtasks: [<Sub-task keys>] with the confirmed proposals.',
      );
    }

    const notes: string[] = [];
    if (acceptContent) {
      if (!report.content) {
        notes.push('accept_content: true but no content divergence — skipped.');
      } else {
        const out = amendSpecFile(deps.projectRoot, pub.absPath, (src) =>
          applyContentAmendment(
            src,
            requirementId,
            live.summary ?? '',
            live.description ?? '',
          ),
        );
        notes.push(out.detail);
      }
    }
    for (const stKey of acceptSubtasks) {
      const div = report.subtasks.find((d) => d.subtaskKey === stKey);
      if (!div) {
        notes.push(`${stKey}: no matching Sub-task divergence — skipped.`);
        continue;
      }
      const out = amendSpecFile(deps.projectRoot, pub.absPath, (src) =>
        appendAcceptanceCriterion(
          src,
          requirementId,
          div.proposedCriterionId,
          div.proposedCriterionText,
        ),
      );
      notes.push(`${stKey} → ${div.proposedCriterionId}: ${out.detail}`);
    }

    // Re-publish so the fingerprint refreshes and the next preview reports
    // no divergence. The publish source is built from what we JUST ACCEPTED
    // — the live summary/description (when accepted) and the appended
    // criteria — NOT from the SpecQueries index, which lags the file
    // write until the caller runs `specship sync`.
    try {
      const publishClient = deps.makePublishClient
        ? deps.makePublishClient()
        : (client as unknown as PublishJiraClient);
      const effectiveTitle = acceptContent ? live.summary ?? '' : specView.title;
      const effectiveBody = acceptContent ? live.description ?? '' : specView.body;
      const effectiveAcceptance = [
        ...specView.acceptance,
        ...report.subtasks
          .filter((d) => acceptSubtasks.includes(d.subtaskKey))
          .map((d) => ({ id: d.proposedCriterionId, text: d.proposedCriterionText })),
      ];
      const creds = resolveJiraCredentials();
      const projectKey = creds.project;
      if (projectKey) {
        const result = await publishSpecToJira(
          publishClient,
          {
            specId: requirementId,
            title: effectiveTitle,
            body: effectiveBody,
            specRelPath: pub.specRelPath,
            acceptance: effectiveAcceptance,
          },
          { projectKey },
          issueKeyArg,
        );
        writeBackJiraIdentity(pub.absPath, issueKeyArg, {
          fingerprint: result.fingerprint,
          reId: null,
          renameTo: null,
        });
        notes.push(`re-published ${issueKeyArg} and refreshed the fingerprint.`);
      } else {
        notes.push(
          'skipped re-publish: no default JIRA project configured — pass project via specship_jira_publish to refresh the fingerprint.',
        );
      }
    } catch (err) {
      notes.push(
        `re-publish failed (spec amended on disk): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return textResult(
      [
        `Applied ${issueKeyArg} → ${pub.specRelPath}:`,
        ...notes.map((n) => `- ${n}`),
        '',
        'Run `specship sync` so the index reflects the spec edits.',
      ].join('\n'),
    );
  }

  // preview mode (default): read + diff every published spec in scope.
  const blocks: string[] = [];
  const clean: string[] = [];
  for (const pub of scope) {
    let live: JiraIssue;
    try {
      live = (await client.getIssue(pub.issueKey)).issue;
    } catch (err) {
      blocks.push(
        `### ${pub.issueKey} — ${pub.specRelPath}\n\n_JIRA read failed: ${
          err instanceof Error ? err.message : String(err)
        }_`,
      );
      continue;
    }
    const requirementId = reqIdForIssue(pub.issueKey);
    const specView = loadSpecView(sq, requirementId, pub.specRelPath);
    if (!specView) {
      blocks.push(
        `### ${pub.issueKey} — ${pub.specRelPath}\n\n_Spec ${requirementId} not in the index — run specship sync._`,
      );
      continue;
    }
    const report = diffIssueVsSpec(live, specView, pub.fingerprint);
    if (!reportHasDivergence(report)) {
      clean.push(pub.issueKey);
      continue;
    }
    const liveFp = issueContentFingerprint(live.summary ?? '', live.description ?? '');
    const machine =
      '```json\n' +
      JSON.stringify(
        {
          issue_key: pub.issueKey,
          spec_rel_path: pub.specRelPath,
          expected_live_fingerprint: liveFp,
          content: report.content
            ? { live_summary: report.content.liveSummary }
            : null,
          subtasks: report.subtasks.map((d) => ({
            subtask_key: d.subtaskKey,
            proposed_criterion_id: d.proposedCriterionId,
            proposed_criterion_text: d.proposedCriterionText,
          })),
        },
        null,
        2,
      ) +
      '\n```';
    blocks.push(`${formatReconcileReport(report)}\n\n${machine}`);
  }

  const header =
    blocks.length === 0
      ? 'No divergences — every published spec matches its JIRA issue.'
      : `${blocks.length} issue${blocks.length === 1 ? '' : 's'} diverged.`;
  const footer =
    blocks.length > 0
      ? '\n\n> Preview only — no file was modified. Show the diff to the user; only ' +
        'after they explicitly confirm, call again with mode:"apply", issue_key, the ' +
        'confirmed accept_content / accept_subtasks, and expected_live_fingerprint ' +
        'from the JSON block above.'
      : '';
  const cleanNote = clean.length > 0 ? `\n\nIn sync: ${clean.join(', ')}.` : '';
  return textResult(`${header}\n\n${blocks.join('\n\n')}${cleanNote}${footer}`);
}

