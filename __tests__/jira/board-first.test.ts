import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENFORCE_CONFIG_FILE } from '../../src/enforce/enforce';
import {
  resolveWorkAnchor,
  formatRefusal,
  type AnchorRefused,
} from '../../src/jira/board-first';
import type { JiraIssue } from '../../src/jira/types';

/**
 * REQ-JIRATEAM-007 — the anchor-resolution gate. Every case uses an
 * injectable JIRA client stub; no real host is touched.
 */

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-anchor-'));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeBinding(binding: Record<string, unknown> | null): void {
  const cfg = binding === null ? {} : { jira: binding };
  fs.writeFileSync(
    path.join(repoRoot, ENFORCE_CONFIG_FILE),
    JSON.stringify(cfg, null, 2),
  );
}

function issue(key: string, summary: string): JiraIssue {
  return {
    key,
    id: '1',
    summary,
    status: 'To Do',
    issueType: 'Story',
  };
}

function fakeClient(opts?: {
  issues?: JiraIssue[];
  getIssue?: (key: string) => JiraIssue | null;
}) {
  return {
    async listMyIssues(_args: unknown) {
      return { ok: true as const, issues: opts?.issues ?? [] };
    },
    async getIssue(key: string) {
      const found = opts?.getIssue ? opts.getIssue(key) : null;
      if (!found) throw new Error('not found');
      return { ok: true as const, issue: found };
    },
  };
}

describe('resolveWorkAnchor', () => {
  it('unbound repo returns unbound so callers no-op', async () => {
    // No specship.config.json at all → status:'unbound'.
    const res = await resolveWorkAnchor({
      cwd: repoRoot,
      makeClient: () => fakeClient(),
    });
    expect(res.status).toBe('unbound');
  });

  it('bound + explicit issueKey resolves via getIssue with source=explicit', async () => {
    writeBinding({ projectKey: 'PROJ', epicKey: 'PROJ-1' });
    const res = await resolveWorkAnchor({
      cwd: repoRoot,
      explicitIssueKey: 'PROJ-42',
      makeClient: () =>
        fakeClient({
          getIssue: (k) => (k === 'PROJ-42' ? issue('PROJ-42', 'Do a thing') : null),
        }),
    });
    expect(res.status).toBe('anchored');
    if (res.status === 'anchored') {
      expect(res.anchor.issueKey).toBe('PROJ-42');
      expect(res.anchor.source).toBe('explicit');
      expect(res.anchor.summary).toBe('Do a thing');
    }
  });

  it('bound + picked issueKey resolves with source=picked', async () => {
    writeBinding({ projectKey: 'PROJ', epicKey: 'PROJ-1' });
    const res = await resolveWorkAnchor({
      cwd: repoRoot,
      pickedIssueKey: 'PROJ-77',
      makeClient: () =>
        fakeClient({
          getIssue: (k) => (k === 'PROJ-77' ? issue('PROJ-77', 'picked one') : null),
        }),
    });
    expect(res.status).toBe('anchored');
    if (res.status === 'anchored') expect(res.anchor.source).toBe('picked');
  });

  it('bound + epic + no pick REFUSES and LISTS the pickable work (A1)', async () => {
    writeBinding({ projectKey: 'PROJ', epicKey: 'PROJ-1' });
    const pickable = [issue('PROJ-10', 'Open story A'), issue('PROJ-11', 'Open task B')];
    const res = await resolveWorkAnchor({
      cwd: repoRoot,
      makeClient: () => fakeClient({ issues: pickable }),
    });
    expect(res.status).toBe('refused');
    if (res.status === 'refused') {
      expect(res.reason).toBe('no-pick');
      expect(res.pickable).toHaveLength(2);
      expect(res.pickable![0].key).toBe('PROJ-10');
      expect(res.fixHint).toMatch(/specship_jira_pick/);
    }
  });

  it('bound + no epic + no pick REFUSES with fix naming jira.epicKey in specship.config.json (A2)', async () => {
    writeBinding({ projectKey: 'PROJ' });
    const res = await resolveWorkAnchor({
      cwd: repoRoot,
      makeClient: () => fakeClient(),
    });
    expect(res.status).toBe('refused');
    if (res.status === 'refused') {
      expect(res.reason).toBe('no-epic-no-pick');
      expect(res.fixHint).toMatch(/jira\.epicKey/);
      expect(res.fixHint).toMatch(/specship\.config\.json/);
    }
  });

  it('formatRefusal produces a canonical human message including the fixHint', () => {
    const refusal: AnchorRefused = {
      status: 'refused',
      reason: 'no-epic-no-pick',
      fixHint: 'Set jira.epicKey in specship.config.json',
    };
    const msg = formatRefusal(refusal);
    expect(msg).toMatch(/refused/i);
    expect(msg).toContain('Set jira.epicKey in specship.config.json');
  });
});
