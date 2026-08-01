/**
 * REQ-JIRATEAM-004 — sprint coverage report builder.
 *
 * A1: every sprint issue appears with a rolled-up state, including unspecced
 *     issues, plus rollup totals.
 * A2: drifted / broken / verified are distinguishable, reusing the existing
 *     spec-link state machine (SpecLinkState) — not a new one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildCoverageReport,
  formatCoverageMarkdown,
  rollupCoverageState,
  COVERAGE_COMMENT_WATERMARK,
  type CoverageJiraClient,
  type CoverageSpecQueries,
} from '../../src/jira/coverage';
import type { JiraIssue, JiraIssueListResult, SpecLinkState } from '../../src/jira/types';

function issue(key: string, summary: string, status: string): JiraIssue {
  return { key, id: key, summary, status, issueType: 'Story' };
}

/** Fake JIRA read client — sprint issues only. */
function fakeClient(sprint: JiraIssue[]): CoverageJiraClient {
  return {
    async listSprintIssues(): Promise<JiraIssueListResult> {
      return { ok: true, issues: sprint };
    },
  };
}

/**
 * Fake spec-queries: one requirement per JIRA key, each carrying the given
 * spec-link states. The sourcePath is what the coverage builder joins on.
 */
function fakeSpecQueries(map: Record<string, { relPath: string; states: SpecLinkState[] }>): CoverageSpecQueries {
  const specs = Object.entries(map).map(([key, v]) => ({
    id: `REQ-${key}`,
    kind: 'requirement',
    sourcePath: v.relPath,
    states: v.states,
  }));
  const byId = new Map(specs.map((s) => [s.id, s]));
  return {
    getAllSpecs: () => specs.map((s) => ({ id: s.id, kind: s.kind, sourcePath: s.sourcePath })),
    getLinksBySpec: (id: string) =>
      (byId.get(id)?.states ?? []).map((state) => ({ state })),
    getSpecsByParent: () => [],
    getSpecById: (id: string) => {
      const s = byId.get(id);
      return s ? { id: s.id, kind: s.kind, sourcePath: s.sourcePath } : null;
    },
  };
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-coverage-'));
  fs.mkdirSync(path.join(tmp, 'specs'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a published spec file whose frontmatter carries `jira_issue`. */
function writePublishedSpec(name: string, jiraKey: string, title: string): string {
  const rel = path.join('specs', name);
  const full = path.join(tmp, rel);
  fs.writeFileSync(
    full,
    `---\njira_issue: ${jiraKey}\njira_fingerprint: abc\n---\n\n# ${title}\n\nBody.\n`,
    'utf8',
  );
  return rel;
}

describe('rollupCoverageState', () => {
  it('A2: distinguishes verified / implemented / drifted / broken', () => {
    expect(rollupCoverageState(['verified', 'verified'])).toBe('verified');
    expect(rollupCoverageState(['implemented', 'verified'])).toBe('implemented');
    expect(rollupCoverageState(['drifted'])).toBe('drifted');
    expect(rollupCoverageState(['broken'])).toBe('broken');
    // broken outranks drifted — never overstate progress.
    expect(rollupCoverageState(['drifted', 'broken'])).toBe('broken');
    // orphaned rolls into drifted.
    expect(rollupCoverageState(['orphaned'])).toBe('drifted');
    // zero links but the spec exists → specced.
    expect(rollupCoverageState([])).toBe('specced');
    // A drafted/implementing link keeps the state at 'specced' — not
    // implemented — so the report never overstates.
    expect(rollupCoverageState(['drafted'])).toBe('specced');
  });
});

describe('buildCoverageReport (REQ-JIRATEAM-004)', () => {
  it('A1: lists every sprint issue with a rolled-up state (unspecced included) + rollup totals', async () => {
    const specced = writePublishedSpec('req-a-001.md', 'PROJ-1', 'Alpha');
    const verifiedSpec = writePublishedSpec('req-b-001.md', 'PROJ-2', 'Beta');
    const driftedSpec = writePublishedSpec('req-c-001.md', 'PROJ-3', 'Gamma');
    // PROJ-99 has no spec file → unspecced.

    const client = fakeClient([
      issue('PROJ-1', 'A summary', 'To Do'),
      issue('PROJ-2', 'B summary', 'Done'),
      issue('PROJ-3', 'C summary', 'In Progress'),
      issue('PROJ-99', 'Untracked', 'To Do'),
    ]);
    const sq = fakeSpecQueries({
      'PROJ-1': { relPath: specced, states: [] },
      'PROJ-2': { relPath: verifiedSpec, states: ['verified'] },
      'PROJ-3': { relPath: driftedSpec, states: ['drifted'] },
    });

    const report = await buildCoverageReport({
      client,
      projectRoot: tmp,
      specQueries: sq,
      project: 'PROJ',
    });

    expect(report.rows).toHaveLength(4);
    const byKey = Object.fromEntries(report.rows.map((r) => [r.issueKey, r]));
    expect(byKey['PROJ-1'].state).toBe('specced');
    expect(byKey['PROJ-2'].state).toBe('verified');
    expect(byKey['PROJ-3'].state).toBe('drifted');
    expect(byKey['PROJ-99'].state).toBe('unspecced');

    expect(report.rollup).toEqual({
      total: 4,
      unspecced: 1,
      specced: 1,
      implemented: 0,
      verified: 1,
      drifted: 1,
      broken: 0,
    });
  });

  it('formatCoverageMarkdown emits the watermark + rollup line', async () => {
    const relPath = writePublishedSpec('req-x-001.md', 'PROJ-1', 'X');
    const client = fakeClient([issue('PROJ-1', 'X sum', 'To Do')]);
    const sq = fakeSpecQueries({ 'PROJ-1': { relPath, states: ['verified'] } });
    const report = await buildCoverageReport({
      client,
      projectRoot: tmp,
      specQueries: sq,
      project: 'PROJ',
    });
    const md = formatCoverageMarkdown(report);
    expect(md.startsWith(COVERAGE_COMMENT_WATERMARK)).toBe(true);
    expect(md).toContain('PROJ-1');
    expect(md).toContain('verified');
    expect(md).toMatch(/\*\*Rollup:\*\*/);
  });

  it('passes the sprint arg through to the client', async () => {
    let seen: { project?: string; sprint?: string } = {};
    const client: CoverageJiraClient = {
      async listSprintIssues(o): Promise<JiraIssueListResult> {
        seen = o;
        return { ok: true, issues: [] };
      },
    };
    await buildCoverageReport({
      client,
      projectRoot: tmp,
      specQueries: fakeSpecQueries({}),
      project: 'PROJ',
      sprint: 'Sprint 42',
    });
    expect(seen).toEqual({ project: 'PROJ', sprint: 'Sprint 42' });
  });
});
