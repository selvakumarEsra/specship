import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  publishSpecToJira,
  type PublishJiraClient,
  type SpecPublishSource,
} from '../../src/jira/publish';
import {
  autoPublishSpecsOnSync,
  type AutoPublishSpecQueries,
} from '../../src/jira/auto-publish';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';
import { JiraEpicRequiredError } from '../../src/jira/types';

/**
 * REQ-JIRATEAM-006 — board-first intake, outbound half. A bound repo MUST
 * create every new spec's JIRA Story under an epic anchor at authoring
 * time. Every path uses a structural fake; no real JIRA host is touched.
 */

const SOURCE: SpecPublishSource = {
  specId: 'REQ-FOO-001',
  title: 'A thing MUST happen',
  body: 'The system MUST do the thing.',
  specRelPath: 'specs/foo.md',
  acceptance: [{ id: 'REQ-FOO-001.A1', text: 'It happens.' }],
};

interface FakeState {
  created: Array<Record<string, unknown>>;
  updated: Array<{ key: string; fields: Record<string, unknown> }>;
  getIssueCalls: string[];
}

function makeFake(opts?: { liveParentKey?: string }): {
  client: PublishJiraClient;
  state: FakeState;
} {
  const state: FakeState = { created: [], updated: [], getIssueCalls: [] };
  let next = 100;
  const client: PublishJiraClient = {
    async createIssue(fields) {
      state.created.push({ ...fields });
      return { key: `PROJ-${next++}`, id: String(next) };
    },
    async updateIssue(key, fields) {
      state.updated.push({ key, fields: { ...fields } });
    },
    async getIssue(key) {
      state.getIssueCalls.push(key);
      return {
        ok: true,
        issue: {
          key,
          id: '1',
          summary: 'x',
          status: 'To Do',
          issueType: 'Story',
          subtasks: [],
          ...(opts?.liveParentKey ? { parentKey: opts.liveParentKey } : {}),
        },
      };
    },
    async listProjects() {
      return [];
    },
  };
  return { client, state };
}

describe('publishSpecToJira — epic anchoring (REQ-JIRATEAM-006)', () => {
  it('A1: create with epicKey parents the Story under the epic', async () => {
    const { client, state } = makeFake();
    const result = await publishSpecToJira(
      client,
      SOURCE,
      { projectKey: 'PROJ', epicKey: 'EPIC-1' },
      null,
    );
    const story = state.created[0]!;
    expect(story.parentKey).toBe('EPIC-1');
    expect(result.created).toBe(true);
    expect(result.epicKey).toBe('EPIC-1');
    expect(result.reparentSkipped).toBeUndefined();
  });

  it('A3: requireEpic without a resolvable epicKey throws EPIC_REQUIRED', async () => {
    const { client, state } = makeFake();
    let err: unknown;
    try {
      await publishSpecToJira(
        client,
        SOURCE,
        { projectKey: 'PROJ', requireEpic: true },
        null,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(JiraEpicRequiredError);
    const msg = (err as Error).message;
    // The message must name both fixes with the CORRECT file (the committed
    // binding, not the user credentials file).
    expect(msg).toContain('specship.config.json');
    expect(msg).toContain('jira.epicKey');
    expect(msg).toContain('pick an epic');
    expect(msg).not.toContain('.specship/jira.json');
    // No JIRA calls happened.
    expect(state.created).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });

  it('A4: re-publish with a changed frontmatter epic leaves the live parent alone', async () => {
    const { client, state } = makeFake({ liveParentKey: 'EPIC-OLD' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await publishSpecToJira(
        client,
        SOURCE,
        { projectKey: 'PROJ', epicKey: 'EPIC-NEW' },
        'PROJ-42',
      );
      expect(result.created).toBe(false);
      expect(result.reparentSkipped).toBe(true);
      // We updated summary/description, never touched the parent.
      expect(state.updated).toHaveLength(1);
      const patchedFields = state.updated[0]!.fields as Record<string, unknown>;
      expect(patchedFields.parent).toBeUndefined();
      expect(patchedFields.parentKey).toBeUndefined();
      // A directed warning was emitted mentioning both keys.
      const warning = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(warning).toContain('reparent_skipped');
      expect(warning).toContain('EPIC-OLD');
      expect(warning).toContain('EPIC-NEW');
      // On update we do NOT stamp epicKey back into the frontmatter — the
      // spec's intent is the source of truth (A4).
      expect(result.epicKey).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('re-publish without a frontmatter epic makes no re-parent noise', async () => {
    const { client, state } = makeFake({ liveParentKey: 'EPIC-OLD' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await publishSpecToJira(
        client,
        SOURCE,
        { projectKey: 'PROJ' },
        'PROJ-42',
      );
      expect(result.reparentSkipped).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      expect(state.updated).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// auto-publish forwarding + refusal (A2 / A5)
// ---------------------------------------------------------------------------

let userHome: string;
let userCfgPath: string;
let repoRoot: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'SPECSHIP_JIRA_CONFIG',
  'SPECSHIP_JIRA_BASE_URL',
  'SPECSHIP_JIRA_EMAIL',
  'SPECSHIP_JIRA_API_TOKEN',
  'SPECSHIP_JIRA_PAT',
  'SPECSHIP_JIRA_PROJECT',
];

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-user-'));
  userCfgPath = path.join(userHome, 'jira.json');
  process.env.SPECSHIP_JIRA_CONFIG = userCfgPath;
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-repo-'));
  fs.writeFileSync(
    userCfgPath,
    JSON.stringify({
      baseUrl: 'https://acme.atlassian.net',
      email: 'jane@acme.com',
      apiToken: 'tok',
    }),
  );
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeBinding(binding: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify({ jira: binding }, null, 2),
  );
}

function writeSpec(name: string, epicKey?: string): string {
  const specsDir = path.join(repoRoot, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const abs = path.join(specsDir, name);
  const fm: string[] = ['---', 'id: REQ-FOO-001'];
  if (epicKey) fm.push(`epicKey: ${epicKey}`);
  fm.push('---', '', '# A thing MUST happen', '', 'body', '');
  fs.writeFileSync(abs, fm.join('\n'));
  return abs;
}

function specQueries(): AutoPublishSpecQueries {
  return {
    getAllSpecs() {
      return [
        {
          id: 'REQ-FOO-001',
          kind: 'requirement',
          title: 'A thing MUST happen',
          body: 'body',
          sourcePath: 'specs/foo.md',
        },
      ];
    },
    getSpecsByParent() {
      return [
        {
          id: 'REQ-FOO-001.A1',
          kind: 'acceptance',
          title: 'It happens.',
          body: '',
        },
      ];
    },
  };
}

describe('autoPublishSpecsOnSync — epic forwarding (REQ-JIRATEAM-006)', () => {
  it('A2: frontmatter epicKey overrides the binding default on create', async () => {
    writeBinding({ projectKey: 'PROJ', epicKey: 'EPIC-DEFAULT' });
    writeSpec('foo.md', 'EPIC-OVERRIDE');
    const { client, state } = makeFake();
    const report = await autoPublishSpecsOnSync({
      specQueries: specQueries(),
      projectRoot: repoRoot,
      makeClient: () => client,
    });
    expect(report.results[0]!.status).toBe('published');
    const story = state.created[0]!;
    expect(story.parentKey).toBe('EPIC-OVERRIDE');
    // Frontmatter still names the override after the write-back.
    const after = fs.readFileSync(
      path.join(repoRoot, 'specs', 'foo.md'),
      'utf8',
    );
    expect(after).toMatch(/epicKey:\s*EPIC-OVERRIDE/);
  });

  it('A1: binding default epicKey is used when frontmatter has none', async () => {
    writeBinding({ projectKey: 'PROJ', epicKey: 'EPIC-DEFAULT' });
    writeSpec('foo.md');
    const { client, state } = makeFake();
    await autoPublishSpecsOnSync({
      specQueries: specQueries(),
      projectRoot: repoRoot,
      makeClient: () => client,
    });
    expect(state.created[0]!.parentKey).toBe('EPIC-DEFAULT');
    // The published epic is stamped back into the frontmatter.
    const after = fs.readFileSync(
      path.join(repoRoot, 'specs', 'foo.md'),
      'utf8',
    );
    expect(after).toMatch(/epicKey:\s*EPIC-DEFAULT/);
    expect(after).toMatch(/jira_issue:\s*PROJ-/);
  });

  it('A5: an unbound repo makes no JIRA call and no epic prompt', async () => {
    // No binding written at all.
    writeSpec('foo.md');
    const { client, state } = makeFake();
    const report = await autoPublishSpecsOnSync({
      specQueries: specQueries(),
      projectRoot: repoRoot,
      makeClient: () => client,
    });
    expect(report.skipped).toBe('unbound');
    expect(state.created).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });
});
