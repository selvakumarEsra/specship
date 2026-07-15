import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  publishSpecToJira,
  writeBackJiraIdentity,
  publishedSpecFilename,
  buildIssueFields,
  subtaskSummary,
  issueContentFingerprint,
  readFrontmatterValue,
  advanceSubtaskForAcceptance,
  commentSpecDrift,
  commentDriftTransitionsOnJira,
  releaseIssues,
  type SpecPublishSource,
  type PublishJiraClient,
  type AdvanceJiraClient,
  type ReleaseJiraClient,
} from '../../src/jira/publish';
import { readSpecJiraKey, findSpecForIssueKey } from '../../src/jira/spec-writer';
import {
  jiraToolDefinitions,
  handleSpecshipJiraPublish,
  handleSpecshipJiraTrack,
} from '../../src/mcp/jira-tools';
import { getStaticTools } from '../../src/mcp/tools';
import { JiraConfigError } from '../../src/jira/types';

/**
 * JIRAPUB-DOC — spec→JIRA publishing and tracking. Every network-facing path
 * runs against structural fakes; no real JIRA host, no credential, is ever
 * touched (REQ-JIRA-009).
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SOURCE: SpecPublishSource = {
  specId: 'REQ-FOO-001',
  title: 'Login MUST be rate-limited',
  body: 'The login endpoint MUST reject more than 5 attempts per minute.',
  specRelPath: 'specs/foo.md',
  acceptance: [
    { id: 'REQ-FOO-001.A1', text: 'A 6th attempt returns 429.' },
    { id: 'REQ-FOO-001.A2', text: 'A success resets the counter.' },
    { id: 'REQ-FOO-001.A3', text: 'The limit is per IP.' },
  ],
};

/** A fake PublishJiraClient recording calls; issues get PROJ-N keys.
 * @verifies REQ-JIRAPUB-001 */
function makePublishFake(opts?: {
  existingSubtasks?: Array<{ key: string; summary: string; status: string }>;
  failCreate?: boolean;
  projects?: Array<{ key: string; name: string }>;
}) {
  let next = 100;
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ key: string; fields: Record<string, unknown> }> = [];
  const client: PublishJiraClient = {
    async createIssue(fields) {
      if (opts?.failCreate) {
        throw new JiraConfigError('JIRA at jira.test returned HTTP 503.');
      }
      created.push({ ...fields });
      return { key: `PROJ-${next++}`, id: String(next) };
    },
    async updateIssue(key, fields) {
      updated.push({ key, fields: { ...fields } });
    },
    async getIssue(key) {
      return {
        ok: true,
        issue: {
          key,
          id: '1',
          summary: 'x',
          status: 'To Do',
          issueType: 'Story',
          subtasks: opts?.existingSubtasks ?? [],
        },
      };
    },
    async listProjects() {
      return opts?.projects ?? [];
    },
  };
  return { client, created, updated };
}

/** Write a spec fixture file. @verifies REQ-JIRAPUB-002 */
function writeSpecFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

const SPEC_MD = [
  '---',
  'format: markdown',
  '---',
  '<!-- id: REQ-FOO-001 -->',
  '# Login MUST be rate-limited',
  '',
  'The login endpoint MUST reject more than 5 attempts per minute.',
  '',
  '## Acceptance',
  '<!-- id: REQ-FOO-001.A1 -->',
  '- A 6th attempt returns 429.',
  '<!-- id: REQ-FOO-001.A2 -->',
  '- A success resets the counter.',
  '',
].join('\n');

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-publish-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-001 — Story + Sub-tasks
// ---------------------------------------------------------------------------

describe('publishSpecToJira (REQ-JIRAPUB-001)', () => {
  it('A1: creates one Story and one Sub-task per acceptance criterion, parented', async () => {
    const { client, created } = makePublishFake();
    const result = await publishSpecToJira(client, SOURCE, { projectKey: 'PROJ' }, null);

    expect(result.created).toBe(true);
    expect(result.subtasksCreated).toBe(3);
    expect(created).toHaveLength(4);

    const story = created[0]!;
    expect(story.issueType).toBe('Story');
    expect(story.summary).toBe('Login MUST be rate-limited');
    expect(String(story.description)).toContain('Acceptance criteria:');
    expect(String(story.description)).toContain('specs/foo.md');
    expect(story.parentKey).toBeUndefined();

    for (const [i, sub] of created.slice(1).entries()) {
      expect(sub.issueType).toBe('Sub-task');
      expect(sub.parentKey).toBe(result.key);
      expect(sub.summary).toBe(subtaskSummary(SOURCE.acceptance[i]!.text));
    }
  });

  it('A2: re-publish with an existing key updates the Story and creates no second Story', async () => {
    const { client, created, updated } = makePublishFake({
      existingSubtasks: SOURCE.acceptance.map((a, i) => ({
        key: `PROJ-${i + 1}`,
        summary: subtaskSummary(a.text),
        status: 'To Do',
      })),
    });
    const result = await publishSpecToJira(client, SOURCE, { projectKey: 'PROJ' }, 'PROJ-9');

    expect(result.created).toBe(false);
    expect(result.key).toBe('PROJ-9');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.key).toBe('PROJ-9');
    // All three Sub-tasks already exist → nothing created at all.
    expect(created).toHaveLength(0);
    expect(result.subtasksCreated).toBe(0);
  });

  it('A3: re-publish after adding a fourth criterion creates exactly one new Sub-task', async () => {
    const { client, created } = makePublishFake({
      existingSubtasks: SOURCE.acceptance.map((a, i) => ({
        key: `PROJ-${i + 1}`,
        summary: subtaskSummary(a.text),
        status: 'To Do',
      })),
    });
    const grown: SpecPublishSource = {
      ...SOURCE,
      acceptance: [...SOURCE.acceptance, { id: 'REQ-FOO-001.A4', text: 'Brand new bullet.' }],
    };
    const result = await publishSpecToJira(client, grown, { projectKey: 'PROJ' }, 'PROJ-9');

    expect(result.subtasksCreated).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]!.summary).toBe('Brand new bullet.');
    expect(created[0]!.parentKey).toBe('PROJ-9');
  });

  it('A4: a failing create surfaces the credential-free error', async () => {
    const { client } = makePublishFake({ failCreate: true });
    await expect(
      publishSpecToJira(client, SOURCE, { projectKey: 'PROJ' }, null),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('bounds Sub-task summaries to a JIRA-safe length', () => {
    const long = 'x'.repeat(500);
    expect(subtaskSummary(long).length).toBeLessThanOrEqual(240);
    const fields = buildIssueFields({ ...SOURCE, title: long });
    expect(fields.summary.length).toBeLessThanOrEqual(240);
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-002 — frontmatter write-back, re-id, rename
// ---------------------------------------------------------------------------

describe('writeBackJiraIdentity (REQ-JIRAPUB-002)', () => {
  it('A1: first publish of a link-less spec re-ids, renames, and records the key', () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const out = writeBackJiraIdentity(specPath, 'PROJ-42', {
      fingerprint: 'abc123',
      reId: { from: 'REQ-FOO-001' },
      renameTo: publishedSpecFilename('PROJ-42', 'Login MUST be rate-limited'),
    });

    expect(path.basename(out.path)).toBe('proj-42-login-must-be-rate-limited.md');
    expect(fs.existsSync(specPath)).toBe(false);

    const content = fs.readFileSync(out.path, 'utf8');
    expect(readFrontmatterValue(content, 'jira_issue')).toBe('PROJ-42');
    expect(readFrontmatterValue(content, 'jira_fingerprint')).toBe('abc123');
    expect(content).toContain('<!-- id: REQ-PROJ-42 -->');
    expect(content).toContain('<!-- id: REQ-PROJ-42.A1 -->');
    expect(content).toContain('<!-- id: REQ-PROJ-42.A2 -->');
    expect(content).not.toContain('REQ-FOO-001');
  });

  it('A2: publish of a linked spec keeps the id and filename', () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const out = writeBackJiraIdentity(specPath, 'PROJ-42', {
      fingerprint: 'abc123',
      reId: null,
      renameTo: null,
    });

    expect(out.path).toBe(specPath);
    const content = fs.readFileSync(specPath, 'utf8');
    expect(content).toContain('<!-- id: REQ-FOO-001 -->');
    expect(readFrontmatterValue(content, 'jira_issue')).toBe('PROJ-42');
  });

  it('A3: the pick machinery finds the published spec by its key', () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    writeBackJiraIdentity(specPath, 'PROJ-42', {
      fingerprint: 'f',
      reId: null,
      renameTo: null,
    });
    expect(findSpecForIssueKey('PROJ-42', tmp)).toBe(specPath);
  });

  it('re-publish updates the existing fingerprint in place (no duplicate keys)', () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    writeBackJiraIdentity(specPath, 'PROJ-42', { fingerprint: 'one', reId: null, renameTo: null });
    writeBackJiraIdentity(specPath, 'PROJ-42', { fingerprint: 'two', reId: null, renameTo: null });
    const content = fs.readFileSync(specPath, 'utf8');
    expect(readFrontmatterValue(content, 'jira_fingerprint')).toBe('two');
    expect(content.match(/jira_issue:/g)).toHaveLength(1);
  });

  it('creates a frontmatter block when the spec has none', () => {
    const specPath = writeSpecFile(tmp, 'specs/bare.md', '<!-- id: REQ-B-1 -->\n# Bare\n');
    writeBackJiraIdentity(specPath, 'PROJ-7', { fingerprint: 'f', reId: null, renameTo: null });
    const content = fs.readFileSync(specPath, 'utf8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(readFrontmatterValue(content, 'jira_issue')).toBe('PROJ-7');
  });
});


// ---------------------------------------------------------------------------
// REQ-JIRAPUB-003 — the authoring flow offers publishing
// ---------------------------------------------------------------------------

/** Read the spec door's command doc. @verifies REQ-JIRAPUB-003 */
function specDoorText(): string {
  return fs.readFileSync(path.join(__dirname, '../../commands/specship/spec.md'), 'utf8');
}

describe('spec door JIRA offer (REQ-JIRAPUB-003)', () => {
  it('A1: the post-write offer exists and is gated on the integration being configured', () => {
    const text = specDoorText();
    expect(text).toContain('Create a JIRA Story for this spec?');
    expect(text).toMatch(/when the JIRA integration is\s+configured/i);
    expect(text).toMatch(/not configured.*skip this section/is);
  });

  it('A2: the offer names the tool so accepting needs no manual JIRA work', () => {
    expect(specDoorText()).toContain('specship_jira_publish');
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-004 — commit prefix plumbing
// ---------------------------------------------------------------------------

describe('readSpecJiraKey (REQ-JIRAPUB-004.A1)', () => {
  it('returns the frontmatter key and null otherwise', () => {
    const withKey = writeSpecFile(
      tmp,
      'specs/a.md',
      '---\njira_issue: PROJ-5\n---\n# T\n',
    );
    const without = writeSpecFile(tmp, 'specs/b.md', '# T\n\nMention of PROJ-5 in prose.\n');
    expect(readSpecJiraKey(withKey)).toBe('PROJ-5');
    expect(readSpecJiraKey(without)).toBeNull();
    expect(readSpecJiraKey(path.join(tmp, 'missing.md'))).toBeNull();
  });
});

/** Read the bundled implement workflow. @verifies REQ-JIRAPUB-004 */
function specImplementYamlText(): string {
  return fs.readFileSync(
    path.join(__dirname, '../../src/workflows/defaults/spec-implement.yaml'),
    'utf8',
  );
}

describe('spec-implement workflow (REQ-JIRAPUB-004.A2)', () => {
  it('instructs commit-message prefixing for jira_issue-keyed specs', () => {
    const yaml = specImplementYamlText();
    expect(yaml).toContain('jira_issue');
    expect(yaml).toMatch(/prefixed with that key/i);
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-005 — verified evidence advances the Sub-task
// ---------------------------------------------------------------------------

/** Fake advance client with mutable subtask state. @verifies REQ-JIRAPUB-005 */
function makeAdvanceFake(opts: {
  subtasks: Array<{ key: string; summary: string; status: string }>;
  offerTransition?: boolean;
  markDoneOnTransition?: boolean;
}) {
  const transitions: Array<{ key: string; name: string }> = [];
  const state = opts.subtasks.map((s) => ({ ...s }));
  const client: AdvanceJiraClient = {
    async getIssue(key) {
      return {
        ok: true,
        issue: {
          key,
          id: '1',
          summary: 's',
          status: 'In Progress',
          issueType: 'Story',
          subtasks: state.map((s) => ({ ...s })),
        },
      };
    },
    async transitionIssue(key, name) {
      transitions.push({ key, name });
      if (opts.offerTransition === false) {
        return { ok: true, skipped: name, reason: `no "${name}" transition on this issue's workflow (available: none)` };
      }
      if (opts.markDoneOnTransition !== false) {
        const sub = state.find((s) => s.key === key);
        if (sub) sub.status = 'Done';
      }
      return { ok: true, transitioned: name };
    },
  };
  return { client, transitions };
}

describe('advanceSubtaskForAcceptance (REQ-JIRAPUB-005)', () => {
  it('A1: transitions the Sub-task matching the acceptance text', async () => {
    const { client, transitions } = makeAdvanceFake({
      subtasks: [
        { key: 'PROJ-2', summary: 'A 6th attempt returns 429.', status: 'To Do' },
        { key: 'PROJ-3', summary: 'A success resets the counter.', status: 'To Do' },
      ],
    });
    const out = await advanceSubtaskForAcceptance(client, 'PROJ-1', 'A 6th attempt returns 429.', 'Done');
    expect(transitions[0]).toEqual({ key: 'PROJ-2', name: 'Done' });
    expect('key' in out.subtask && out.subtask.key).toBe('PROJ-2');
    // The sibling is still To Do → no Story transition.
    expect(out.story).toBeUndefined();
  });

  it('A2: a workflow without the transition records a skip, never throws', async () => {
    const { client } = makeAdvanceFake({
      subtasks: [{ key: 'PROJ-2', summary: 'A 6th attempt returns 429.', status: 'To Do' }],
      offerTransition: false,
    });
    const out = await advanceSubtaskForAcceptance(client, 'PROJ-1', 'A 6th attempt returns 429.', 'Done');
    expect('key' in out.subtask && 'skipped' in out.subtask.result).toBe(true);
  });

  it('reports a skip when no Sub-task matches the text', async () => {
    const { client, transitions } = makeAdvanceFake({ subtasks: [] });
    const out = await advanceSubtaskForAcceptance(client, 'PROJ-1', 'unmatched', 'Done');
    expect('skipped' in out.subtask).toBe(true);
    expect(transitions).toHaveLength(0);
  });

  it('advances the Story once the last Sub-task is done', async () => {
    const { client, transitions } = makeAdvanceFake({
      subtasks: [
        { key: 'PROJ-2', summary: 'A 6th attempt returns 429.', status: 'Done' },
        { key: 'PROJ-3', summary: 'A success resets the counter.', status: 'To Do' },
      ],
    });
    const out = await advanceSubtaskForAcceptance(client, 'PROJ-1', 'A success resets the counter.', 'Done');
    expect(transitions).toEqual([
      { key: 'PROJ-3', name: 'Done' },
      { key: 'PROJ-1', name: 'Done' },
    ]);
    expect(out.story && 'transitioned' in out.story.result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-006 — drift comments
// ---------------------------------------------------------------------------

/** Recording comment client. @verifies REQ-JIRAPUB-006 */
function makeCommentRecorder() {
  const comments: Array<{ key: string; body: string }> = [];
  return {
    comments,
    client: {
      async addComment(key: string, body: string) {
        comments.push({ key, body });
      },
    },
  };
}

describe('drift comments (REQ-JIRAPUB-006)', () => {
  it('A1: a drift transition on a JIRA-backed spec produces one comment naming symbol + axis', async () => {
    const comments: Array<{ key: string; body: string }> = [];
    const specPath = writeSpecFile(tmp, 'specs/a.md', '---\njira_issue: PROJ-5\n---\n# T\n');
    const makeClient = vi.fn(() => ({
      async addComment(key: string, body: string) {
        comments.push({ key, body });
      },
    }));

    const notes = await commentDriftTransitionsOnJira({
      transitions: [{ specId: 'REQ-A-1', axis: 'code', symbol: 'doThing' }],
      specPathFor: () => specPath,
      readKey: readSpecJiraKey,
      makeClient,
    });

    expect(comments).toHaveLength(1);
    expect(comments[0]!.key).toBe('PROJ-5');
    expect(comments[0]!.body).toContain('doThing');
    expect(comments[0]!.body).toContain('code');
    expect(notes[0]).toContain('PROJ-5');
  });

  it('A2: duplicate transitions in one batch collapse to a single comment', async () => {
    const comments: string[] = [];
    const specPath = writeSpecFile(tmp, 'specs/a.md', '---\njira_issue: PROJ-5\n---\n# T\n');
    await commentDriftTransitionsOnJira({
      transitions: [
        { specId: 'REQ-A-1', axis: 'code', symbol: 'doThing' },
        { specId: 'REQ-A-1', axis: 'code', symbol: 'doThing' },
      ],
      specPathFor: () => specPath,
      readKey: readSpecJiraKey,
      makeClient: () => ({
        async addComment(_key: string, body: string) {
          comments.push(body);
        },
      }),
    });
    expect(comments).toHaveLength(1);
  });

  it('A3: a spec without jira_issue makes no JIRA call at all', async () => {
    const specPath = writeSpecFile(tmp, 'specs/a.md', '# No frontmatter\n');
    const makeClient = vi.fn();
    const notes = await commentDriftTransitionsOnJira({
      transitions: [{ specId: 'REQ-A-1', axis: 'code', symbol: 'doThing' }],
      specPathFor: () => specPath,
      readKey: readSpecJiraKey,
      makeClient,
    });
    expect(makeClient).not.toHaveBeenCalled();
    expect(notes).toHaveLength(0);
  });

  it('commentSpecDrift includes the spec id in the body', async () => {
    const rec = makeCommentRecorder();
    await commentSpecDrift(rec.client, 'PROJ-5', 'REQ-A-1', 'doThing', 'spec');
    expect(rec.comments[0]!.body).toContain('REQ-A-1');
    expect(rec.comments[0]!.body).toContain('axis: spec');
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-007 — release fixVersion
// ---------------------------------------------------------------------------

/** Fake release client. @verifies REQ-JIRAPUB-007 */
function makeReleaseFake(opts?: { versionExists?: boolean; alreadyShipped?: boolean }) {
  const calls = {
    ensured: [] as string[],
    fixed: [] as string[],
    comments: [] as Array<{ key: string; body: string }>,
  };
  const client: ReleaseJiraClient = {
    async ensureProjectVersion(_project, name) {
      calls.ensured.push(name);
      return { created: !opts?.versionExists };
    },
    async setFixVersion(key, _version) {
      calls.fixed.push(key);
      return { added: !opts?.alreadyShipped };
    },
    async listComments(_key) {
      return opts?.alreadyShipped ? ['SpecShip: shipped in v1.2.3'] : [];
    },
    async addComment(key, body) {
      calls.comments.push({ key, body });
    },
  };
  return { client, calls };
}

describe('releaseIssues (REQ-JIRAPUB-007)', () => {
  it('A1: creates the version once and stamps both issues', async () => {
    const { client, calls } = makeReleaseFake();
    const result = await releaseIssues(client, 'PROJ', 'v1.2.3', ['PROJ-1', 'PROJ-2']);
    expect(result.versionCreated).toBe(true);
    expect(calls.ensured).toEqual(['v1.2.3']);
    expect(calls.fixed).toEqual(['PROJ-1', 'PROJ-2']);
    expect(calls.comments).toHaveLength(2);
    expect(calls.comments[0]!.body).toContain('shipped in v1.2.3');
  });

  it('A2: a re-run adds no duplicate version, fixVersion, or comment', async () => {
    const { client, calls } = makeReleaseFake({ versionExists: true, alreadyShipped: true });
    const result = await releaseIssues(client, 'PROJ', 'v1.2.3', ['PROJ-1']);
    expect(result.versionCreated).toBe(false);
    expect(result.issues[0]).toEqual({ key: 'PROJ-1', fixVersionAdded: false, commented: false });
    expect(calls.comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAPUB-008 — JIRA-side edit detection
// ---------------------------------------------------------------------------

/** Fake track client serving a fixed live issue. @verifies REQ-JIRAPUB-008 */
function trackClient(summary: string, description: string) {
  return {
    async listMyIssues() {
      return { ok: true as const, issues: [] };
    },
    async getIssue(key: string) {
      return {
        ok: true as const,
        issue: { key, id: '1', summary, status: 'In Progress', issueType: 'Story', description, subtasks: [] },
      };
    },
  };
}

describe('fingerprint + track divergence (REQ-JIRAPUB-008)', () => {
  const JIRA_ENV = ['SPECSHIP_JIRA_CONFIG'];
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = {};
    for (const k of JIRA_ENV) {
      savedEnv[k] = process.env[k];
    }
    // Point at a real (configured) file so notConfiguredResult passes.
    const cfg = path.join(tmp, 'jira.json');
    fs.writeFileSync(
      cfg,
      JSON.stringify({ baseUrl: 'https://jira.test', pat: 'pat-x', deployment: 'datacenter', project: 'PROJ' }),
    );
    process.env.SPECSHIP_JIRA_CONFIG = cfg;
  });
  afterEach(() => {
    for (const k of JIRA_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function publishedSpec(fingerprint: string): void {
    writeSpecFile(
      tmp,
      'specs/pub.md',
      `---\njira_issue: PROJ-9\njira_fingerprint: ${fingerprint}\n---\n<!-- id: REQ-PROJ-9 -->\n# Published title\n`,
    );
  }

  it('A1: an unedited issue reports no divergence', async () => {
    const fp = issueContentFingerprint('Published title', 'the body');
    publishedSpec(fp);
    const result = await handleSpecshipJiraTrack(
      {},
      {
        specQueries: { getAllWorkflowRuns: () => [] },
        projectRoot: tmp,
        makeJiraClient: () => trackClient('Published title', 'the body'),
      },
    );
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toContain('PROJ-9');
    expect(text).not.toContain('edited in JIRA');
  });

  it('A2: an edited issue is reported as a divergence naming the key', async () => {
    const fp = issueContentFingerprint('Published title', 'the body');
    publishedSpec(fp);
    const result = await handleSpecshipJiraTrack(
      {},
      {
        specQueries: { getAllWorkflowRuns: () => [] },
        projectRoot: tmp,
        makeJiraClient: () => trackClient('Edited in JIRA', 'someone changed me'),
      },
    );
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toContain('⚠ PROJ-9');
    expect(text).toContain('edited in JIRA');
  });

  it('A3: refreshing the fingerprint clears the divergence', async () => {
    const fp = issueContentFingerprint('Edited in JIRA', 'someone changed me');
    publishedSpec(fp);
    const result = await handleSpecshipJiraTrack(
      {},
      {
        specQueries: { getAllWorkflowRuns: () => [] },
        projectRoot: tmp,
        makeJiraClient: () => trackClient('Edited in JIRA', 'someone changed me'),
      },
    );
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).not.toContain('edited in JIRA after publish');
  });

  it('fingerprints are stable and content-sensitive', () => {
    expect(issueContentFingerprint('a', 'b')).toBe(issueContentFingerprint('a', 'b'));
    expect(issueContentFingerprint('a', 'b')).not.toBe(issueContentFingerprint('a', 'c'));
  });
});

// ---------------------------------------------------------------------------
// specship_jira_publish handler (REQ-JIRAPUB-001/-002 wiring)
// ---------------------------------------------------------------------------

describe('handleSpecshipJiraPublish', () => {
  let savedCfg: string | undefined;
  beforeEach(() => {
    savedCfg = process.env.SPECSHIP_JIRA_CONFIG;
    const cfg = path.join(tmp, 'jira.json');
    fs.writeFileSync(
      cfg,
      JSON.stringify({ baseUrl: 'https://jira.test', pat: 'pat-x', deployment: 'datacenter', project: 'PROJ' }),
    );
    process.env.SPECSHIP_JIRA_CONFIG = cfg;
  });
  afterEach(() => {
    if (savedCfg === undefined) delete process.env.SPECSHIP_JIRA_CONFIG;
    else process.env.SPECSHIP_JIRA_CONFIG = savedCfg;
  });

  function specQueriesFor(specPath: string, opts?: { links?: unknown[]; extraReqInFile?: boolean }) {
    const rel = path.relative(tmp, specPath);
    return {
      getSpecById: (id: string) =>
        id === 'REQ-FOO-001'
          ? { id, kind: 'requirement', title: 'Login MUST be rate-limited', body: 'MUST reject.', sourcePath: rel }
          : null,
      getSpecsByParent: () => [
        { id: 'REQ-FOO-001.A1', kind: 'acceptance', title: 'A 6th attempt returns 429.', body: '' },
        { id: 'REQ-FOO-001.A2', kind: 'acceptance', title: 'A success resets the counter.', body: '' },
      ],
      getLinksBySpec: () => opts?.links ?? [],
      getAllSpecs: () => [
        { id: 'REQ-FOO-001', kind: 'requirement', sourcePath: rel },
        ...(opts?.extraReqInFile
          ? [{ id: 'REQ-FOO-002', kind: 'requirement', sourcePath: rel }]
          : []),
      ],
    };
  }

  it('publishes, writes back, re-ids, and renames a fresh link-less spec', async () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const { client } = makePublishFake();
    const result = await handleSpecshipJiraPublish(
      { spec_id: 'REQ-FOO-001' },
      { specQueries: specQueriesFor(specPath), projectRoot: tmp, makeJiraClient: () => client },
    );
    const text = result.content.map((c) => c.text).join('\n');
    expect(result.isError).toBeUndefined();
    expect(text).toContain('Created PROJ-100');
    expect(text).toContain('2 Sub-tasks');
    expect(fs.existsSync(specPath)).toBe(false);
    const renamed = path.join(tmp, 'specs', 'proj-100-login-must-be-rate-limited.md');
    expect(fs.existsSync(renamed)).toBe(true);
    expect(readSpecJiraKey(renamed)).toBe('PROJ-100');
  });

  it('keeps id + filename when the spec already has links', async () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const { client } = makePublishFake();
    await handleSpecshipJiraPublish(
      { spec_id: 'REQ-FOO-001' },
      {
        specQueries: specQueriesFor(specPath, { links: [{ id: 1 }] }),
        projectRoot: tmp,
        makeJiraClient: () => client,
      },
    );
    expect(fs.existsSync(specPath)).toBe(true);
    expect(fs.readFileSync(specPath, 'utf8')).toContain('<!-- id: REQ-FOO-001 -->');
    expect(readSpecJiraKey(specPath)).toBe('PROJ-100');
  });

  it('keeps id + filename for a multi-requirement file', async () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const { client } = makePublishFake();
    await handleSpecshipJiraPublish(
      { spec_id: 'REQ-FOO-001' },
      {
        specQueries: specQueriesFor(specPath, { extraReqInFile: true }),
        projectRoot: tmp,
        makeJiraClient: () => client,
      },
    );
    expect(fs.existsSync(specPath)).toBe(true);
  });

  it('A4: a JIRA failure writes nothing to the spec file', async () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const { client } = makePublishFake({ failCreate: true });
    const before = fs.readFileSync(specPath, 'utf8');
    const result = await handleSpecshipJiraPublish(
      { spec_id: 'REQ-FOO-001' },
      { specQueries: specQueriesFor(specPath), projectRoot: tmp, makeJiraClient: () => client },
    );
    expect(result.isError).toBe(true);
    expect(fs.readFileSync(specPath, 'utf8')).toBe(before);
  });

  it('errors clearly on an unknown spec id and a non-requirement id', async () => {
    const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
    const { client } = makePublishFake();
    const missing = await handleSpecshipJiraPublish(
      { spec_id: 'REQ-NOPE-1' },
      { specQueries: specQueriesFor(specPath), projectRoot: tmp, makeJiraClient: () => client },
    );
    expect(missing.isError).toBe(true);

    const doc = await handleSpecshipJiraPublish(
      { spec_id: 'REQ-FOO-001' },
      {
        specQueries: {
          ...specQueriesFor(specPath),
          getSpecById: (id: string) => ({ id, kind: 'document', title: 't', body: '', sourcePath: 'specs/foo.md' }),
        },
        projectRoot: tmp,
        makeJiraClient: () => client,
      },
    );
    expect(doc.isError).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// REQ-JIRAPUB-009 — project picker
// ---------------------------------------------------------------------------

/** Response-shaped stub for the real client's fetch path. @verifies REQ-JIRAPUB-009 */
function fetchResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    type: 'basic',
    json: async () => body,
  };
}

describe('project picker (REQ-JIRAPUB-009)', () => {
  it('A1: listProjects returns key + name for accessible projects', async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () =>
        fetchResponse([
          { key: 'PROJ', name: 'Project One', id: '1' },
          { key: 'OPS', name: 'Operations', id: '2' },
        ]),
      ) as unknown as typeof fetch;
      const { JiraClient } = await import('../../src/jira/client');
      const client = new JiraClient({
        baseUrl: 'https://jira.test',
        deployment: 'datacenter',
        pat: 'pat-x',
      });
      const projects = await client.listProjects();
      expect(projects).toEqual([
        { key: 'PROJ', name: 'Project One' },
        { key: 'OPS', name: 'Operations' },
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('A1: an auth fault surfaces the existing credential-free error', async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => fetchResponse({}, 401)) as unknown as typeof fetch;
      const { JiraClient } = await import('../../src/jira/client');
      const client = new JiraClient({
        baseUrl: 'https://jira.test',
        deployment: 'datacenter',
        pat: 'pat-super-secret',
      });
      await expect(client.listProjects()).rejects.toThrow(/(?!.*pat-super-secret)/);
      await expect(client.listProjects()).rejects.not.toThrow(/pat-super-secret/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  function noProjectConfig(): void {
    const cfg = path.join(tmp, 'jira-noproj.json');
    fs.writeFileSync(
      cfg,
      JSON.stringify({ baseUrl: 'https://jira.test', pat: 'pat-x', deployment: 'datacenter' }),
    );
    process.env.SPECSHIP_JIRA_CONFIG = cfg;
  }

  function pickerSpecQueries(specPath: string) {
    const rel = path.relative(tmp, specPath);
    return {
      getSpecById: (id: string) =>
        id === 'REQ-FOO-001'
          ? { id, kind: 'requirement', title: 'T', body: 'MUST.', sourcePath: rel }
          : null,
      getSpecsByParent: () => [],
      getLinksBySpec: () => [],
      getAllSpecs: () => [{ id: 'REQ-FOO-001', kind: 'requirement', sourcePath: rel }],
    };
  }

  it('A2: publish with no project returns the accessible list and creates no issue', async () => {
    const saved = process.env.SPECSHIP_JIRA_CONFIG;
    try {
      noProjectConfig();
      const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
      const { client, created } = makePublishFake({
        projects: [
          { key: 'PROJ', name: 'Project One' },
          { key: 'OPS', name: 'Operations' },
        ],
      });
      const result = await handleSpecshipJiraPublish(
        { spec_id: 'REQ-FOO-001' },
        { specQueries: pickerSpecQueries(specPath), projectRoot: tmp, makeJiraClient: () => client },
      );
      const text = result.content.map((c) => c.text).join('\n');
      expect(result.isError).toBeUndefined();
      expect(text).toContain('| PROJ | Project One |');
      expect(text).toContain('| OPS | Operations |');
      expect(text).toContain('project: "<Key>"');
      expect(created).toHaveLength(0);
      expect(fs.readFileSync(specPath, 'utf8')).toBe(SPEC_MD);
    } finally {
      if (saved === undefined) delete process.env.SPECSHIP_JIRA_CONFIG;
      else process.env.SPECSHIP_JIRA_CONFIG = saved;
    }
  });

  it('A4: an empty accessible list is a clear message, not an error', async () => {
    const saved = process.env.SPECSHIP_JIRA_CONFIG;
    try {
      noProjectConfig();
      const specPath = writeSpecFile(tmp, 'specs/foo.md', SPEC_MD);
      const { client, created } = makePublishFake({ projects: [] });
      const result = await handleSpecshipJiraPublish(
        { spec_id: 'REQ-FOO-001' },
        { specQueries: pickerSpecQueries(specPath), projectRoot: tmp, makeJiraClient: () => client },
      );
      const text = result.content.map((c) => c.text).join('\n');
      expect(result.isError).toBeUndefined();
      expect(text).toContain('no browseable projects');
      expect(created).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.SPECSHIP_JIRA_CONFIG;
      else process.env.SPECSHIP_JIRA_CONFIG = saved;
    }
  });

  it('A3: the configure command exposes a --project flag and the interactive picker', () => {
    const cli = fs.readFileSync(path.join(__dirname, '../../src/bin/specship.ts'), 'utf8');
    expect(cli).toContain("--project <key>");
    expect(cli).toContain('listProjects');
    expect(cli).toMatch(/Default project for spec→JIRA publishing/);
  });
});

// ---------------------------------------------------------------------------
// Tool registration (REQ-JIRAPUB-001 surface)
// ---------------------------------------------------------------------------

describe('specship_jira_publish registration', () => {
  it('is defined with a required spec_id and gated by the jira integration tier', () => {
    const def = jiraToolDefinitions.find((t) => t.name === 'specship_jira_publish');
    expect(def).toBeDefined();
    expect(def!.inputSchema.required).toContain('spec_id');

    // Integration tier (INTEG-TIER-DOC): absent from the default surface,
    // present once SPECSHIP_INTEGRATIONS enables jira.
    const prev = process.env.SPECSHIP_INTEGRATIONS;
    try {
      delete process.env.SPECSHIP_INTEGRATIONS;
      expect(getStaticTools().map((t) => t.name)).not.toContain('specship_jira_publish');
      process.env.SPECSHIP_INTEGRATIONS = 'jira';
      expect(getStaticTools().map((t) => t.name)).toContain('specship_jira_publish');
    } finally {
      if (prev === undefined) delete process.env.SPECSHIP_INTEGRATIONS;
      else process.env.SPECSHIP_INTEGRATIONS = prev;
    }
  });
});
