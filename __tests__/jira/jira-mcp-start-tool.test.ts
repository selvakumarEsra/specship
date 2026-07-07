import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  jiraToolDefinitions,
  handleSpecshipJiraStart,
  handleSpecshipJiraPick,
  type JiraStartDeps,
} from '../../src/mcp/jira-tools';
import { getStaticTools } from '../../src/mcp/tools';
import { reqIdForIssue } from '../../src/jira/spec-generator';

/**
 * REQ-JIRA-005 — the specship_jira_start MCP tool drives spec-implement on the
 * spec that specship_jira_pick authored:
 *   - registered in the static tool surface with a required `key`,
 *   - A1: runs the workflow to the plan/approve gate, calling executor.start
 *     with inputs.SPEC_ID = reqIdForIssue(key) (the exact spec pick wrote), and
 *     surfaces the approval message + runId; it does NOT block for the full run,
 *   - A2: a run that fails → tool error saying no PR was raised; the issue is
 *     NOT transitioned (no transition call exists yet — REQ-JIRA-007),
 *   - a missing spec → a pointer to specship_jira_pick, executor.start never
 *     called,
 *   - not-configured / blank-key guards.
 * The WorktreeProvider + WorkflowExecutor are STUBBED — the suite NEVER runs a
 * real nested spec-implement (which would spawn claude recursively). No network.
 */

const JIRA_ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_DEPLOYMENT',
];

let saved: Record<string, string | undefined>;
let tmpDir: string;
let projectDir: string;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of JIRA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-start-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-start-proj-'));
  process.env.SPECSHIP_JIRA_CONFIG = path.join(tmpDir, 'absent.json');
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of JIRA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function configureCloud(): void {
  process.env.SPECSHIP_JIRA_BASE_URL = 'https://acme.atlassian.net';
  process.env.SPECSHIP_JIRA_EMAIL = 'jane@acme.com';
  process.env.SPECSHIP_JIRA_API_TOKEN = 'tok-secret-123';
  process.env.SPECSHIP_JIRA_DEPLOYMENT = 'cloud';
}

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

const FIELDS = {
  summary: 'Add a logout button',
  description: 'Users MUST be able to log out from the header menu.',
  status: { name: 'To Do' },
  issuetype: { name: 'Story' },
};

/** Author the spec pick would write for PROJ-1, via the real pick handler. */
async function authorSpecFor(key: string): Promise<void> {
  configureCloud();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    type: 'default',
    headers: new Headers(),
    json: async () => ({ key, id: '1', fields: FIELDS }),
  } as Partial<Response>);
  const r = await handleSpecshipJiraPick({ key, projectPath: projectDir });
  expect(r.isError).toBeFalsy();
  fetchMock.mockReset();
}

/** A record of every executor.start call, for assertions. */
interface StartCall {
  workflow: unknown;
  opts: {
    projectRoot: string;
    runId?: string;
    branchName?: string;
    inputs?: Record<string, string>;
    variables?: Record<string, string>;
    runMetadata?: Record<string, unknown>;
  };
}

/**
 * Build stub deps whose executor returns `run` from start(). The stub records
 * each start() call so tests can assert inputs.SPEC_ID. No real WorktreeProvider
 * / WorkflowExecutor / worktree / claude spawn.
 */
function stubDeps(
  run: { id: string; status: string; errorMessage?: string; metadata?: unknown },
  calls: StartCall[],
  opts: { workflowFound?: boolean } = {},
): JiraStartDeps {
  const workflowFound = opts.workflowFound ?? true;
  return {
    specQueries: {},
    projectRoot: projectDir,
    loadWorkflowByName: () =>
      workflowFound ? { workflow: { name: 'spec-implement' } } : null,
    WorktreeProvider: class {
      constructor(_sq: unknown) {}
    },
    WorkflowExecutor: class {
      constructor(
        _sq: unknown,
        _wt: unknown,
        _root: string,
      ) {}
      async start(workflow: unknown, o: StartCall['opts']) {
        calls.push({ workflow, opts: o });
        return { run };
      }
    },
    getSpecShipDir: (root: string) => path.join(root, '.specship'),
  };
}

describe('specship_jira_start tool registration', () => {
  it('is registered in the static tool surface', () => {
    const names = getStaticTools().map((t) => t.name);
    expect(names).toContain('specship_jira_start');
  });

  it('requires a key string', () => {
    const def = jiraToolDefinitions.find((t) => t.name === 'specship_jira_start');
    expect(def).toBeDefined();
    expect(def!.inputSchema.properties.key.type).toBe('string');
    expect(def!.inputSchema.required ?? []).toContain('key');
  });
});

describe('handleSpecshipJiraStart', () => {
  it('A1: starts spec-implement with inputs.SPEC_ID and pauses at the plan gate', async () => {
    await authorSpecFor('PROJ-1');
    const calls: StartCall[] = [];
    const deps = stubDeps(
      {
        id: 'run-abc',
        status: 'paused',
        metadata: { approval: { message: 'Plan ready for REQ-PROJ-1. Approve?' } },
      },
      calls,
    );

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    expect(result.isError).toBeFalsy();
    // executor.start called exactly once, with the SPEC_ID pick wrote.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.opts.inputs).toEqual({ SPEC_ID: reqIdForIssue('PROJ-1') });
    expect(calls[0]!.opts.projectRoot).toBe(projectDir);
    expect(calls[0]!.opts.variables?.CONTEXT).toBe(projectDir);
    // REQ-JIRA-006: the issue key rides the branch name (JIRA dev-panel match),
    // and the run is stamped with jira metadata so completion can raise the PR.
    expect(calls[0]!.opts.branchName).toMatch(/^specship\/PROJ-1-/);
    expect(
      (calls[0]!.opts.runMetadata as { jira?: { issueKey?: string } })?.jira?.issueKey,
    ).toBe('PROJ-1');
    // The gate message tells the user a PR is raised on approval + verify.
    expect(text(result)).toMatch(/pull request for PROJ-1 is raised/i);
    // A1: the run id + plan/approve gate are surfaced; not blocked to completion.
    const out = text(result);
    expect(out).toContain('run-abc');
    expect(out).toMatch(/plan\/approve gate|approve to proceed/i);
    expect(out).toContain('Plan ready for REQ-PROJ-1');
  });

  it('A2: a failed run reports no PR raised and does not transition the issue', async () => {
    await authorSpecFor('PROJ-1');
    const calls: StartCall[] = [];
    const deps = stubDeps(
      { id: 'run-fail', status: 'failed', errorMessage: 'plan step crashed' },
      calls,
    );

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    const out = text(result);
    expect(out).toMatch(/no pull request|no pr/i);
    // A failed run pushes no status (REQ-JIRA-005.A2 / REQ-JIRA-007) — the
    // issue is never transitioned, so nothing hits JIRA. (Status-push wiring
    // itself is covered in jira-mcp-status-tool.test.ts with a stubbed client.)
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing spec → pointer to specship_jira_pick, executor.start never called', async () => {
    configureCloud();
    const calls: StartCall[] = [];
    const deps = stubDeps({ id: 'x', status: 'paused' }, calls);

    const result = await handleSpecshipJiraStart({ key: 'PROJ-404' }, deps);

    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/specship_jira_pick/);
    expect(calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a clear message for a missing key arg, executor.start never called', async () => {
    configureCloud();
    const calls: StartCall[] = [];
    const deps = stubDeps({ id: 'x', status: 'paused' }, calls);

    const result = await handleSpecshipJiraStart({}, deps);

    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/issue key is required/i);
    expect(calls).toHaveLength(0);
  });

  it('points to "specship jira configure" when unconfigured', async () => {
    const calls: StartCall[] = [];
    const deps = stubDeps({ id: 'x', status: 'paused' }, calls);

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('specship jira configure');
    expect(calls).toHaveLength(0);
  });

  it('reports a clear error when the spec-implement workflow is missing', async () => {
    await authorSpecFor('PROJ-1');
    const calls: StartCall[] = [];
    const deps = stubDeps({ id: 'x', status: 'paused' }, calls, {
      workflowFound: false,
    });

    const result = await handleSpecshipJiraStart({ key: 'PROJ-1' }, deps);

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/spec-implement.*not found/i);
    expect(calls).toHaveLength(0);
  });
});
